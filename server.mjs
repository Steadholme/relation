import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 8080;

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'self'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

function writeHeaders(response, extra = {}) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  for (const [name, value] of Object.entries(extra)) {
    response.setHeader(name, value);
  }
}

function sendText(response, status, body, method = "GET", extra = {}) {
  const bytes = Buffer.byteLength(body);
  writeHeaders(response, {
    "Cache-Control": "no-store",
    "Content-Length": String(bytes),
    "Content-Type": "text/plain; charset=utf-8",
    ...extra,
  });
  response.statusCode = status;
  response.end(method === "HEAD" ? undefined : body);
}

function parsePath(requestUrl) {
  const rawPath = (requestUrl || "/").split(/[?#]/, 1)[0] || "/";
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { error: "Malformed URL" };
  }

  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) {
    return { error: "Invalid path" };
  }

  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { error: "Invalid path" };
  }

  return { pathname: decoded };
}

function cacheControlFor(pathname) {
  if (pathname === "/" || pathname.endsWith(".html") || pathname.endsWith(".webmanifest")) {
    return "no-cache";
  }
  if (pathname.startsWith("/vendor/")) {
    return "public, max-age=31536000, immutable";
  }
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=86400, stale-while-revalidate=604800";
  }
  return "public, max-age=3600, must-revalidate";
}

async function resolveAsset(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const absolute = path.resolve(ROOT, relative);
  if (!absolute.startsWith(`${ROOT}${path.sep}`)) {
    return null;
  }

  const extension = path.extname(absolute).toLowerCase();
  if (!CONTENT_TYPES.has(extension)) {
    return null;
  }

  try {
    const info = await stat(absolute);
    if (!info.isFile()) {
      return null;
    }
    return { absolute, extension, info };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    const method = request.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      sendText(response, 405, "Method not allowed\n", method, { Allow: "GET, HEAD" });
      return;
    }

    const parsed = parsePath(request.url);
    if (parsed.error) {
      sendText(response, 400, `${parsed.error}\n`, method);
      return;
    }

    if (parsed.pathname === "/healthz") {
      sendText(response, 200, "ok\n", method);
      return;
    }

    try {
      const asset = await resolveAsset(parsed.pathname);
      if (!asset) {
        sendText(response, 404, "Not found\n", method);
        return;
      }

      const etag = `W/\"${asset.info.size.toString(16)}-${Math.trunc(asset.info.mtimeMs).toString(16)}\"`;
      const headers = {
        "Cache-Control": cacheControlFor(parsed.pathname),
        "Content-Length": String(asset.info.size),
        "Content-Type": CONTENT_TYPES.get(asset.extension),
        ETag: etag,
      };
      writeHeaders(response, headers);

      if (request.headers["if-none-match"] === etag) {
        response.statusCode = 304;
        response.removeHeader("Content-Length");
        response.end();
        return;
      }

      response.statusCode = 200;
      if (method === "HEAD") {
        response.end();
        return;
      }

      const stream = createReadStream(asset.absolute);
      stream.on("error", () => {
        if (!response.headersSent) {
          sendText(response, 500, "Internal server error\n", method);
        } else {
          response.destroy();
        }
      });
      stream.pipe(response);
    } catch {
      sendText(response, 500, "Internal server error\n", method);
    }
  });
}

async function healthcheck() {
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

function runServer() {
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const server = createAppServer();
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`heartlines listening on 0.0.0.0:${port}\n`);
  });

  const shutdown = () => {
    server.close((error) => process.exit(error ? 1 : 0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--healthcheck")) {
    await healthcheck();
  } else {
    runServer();
  }
}
