import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { after, before, test } from "node:test";

import { createAppServer } from "../server.mjs";

let server;
let origin;

before(async () => {
  server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("serves the health endpoint without caching", async () => {
  const response = await fetch(`${origin}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok\n");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("serves a self-contained entrypoint with a strict policy", async () => {
  const response = await fetch(`${origin}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.match(html, /data-ody-foundation/);
  assert.doesNotMatch(
    html,
    /<(?:script|link|img|iframe|source|video|audio)\b[^>]*(?:src|href)=["']https?:\/\//i,
  );
  assert.match(
    html,
    /RelationWeb\/blob\/ea9b337492572b8cf63bb9c781fb2ecd70937346\/data\.js/,
  );
  assert.match(html, /rel="noopener noreferrer"/);
});

test("supports HEAD and validators", async () => {
  const first = await fetch(`${origin}/styles.css`);
  const etag = first.headers.get("etag");
  assert.ok(etag);
  assert.equal(first.headers.get("cache-control"), "no-cache");

  const head = await fetch(`${origin}/styles.css`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const cached = await fetch(`${origin}/styles.css`, {
    headers: { "If-None-Match": etag },
  });
  assert.equal(cached.status, 304);
});

test("pins the vendored Foundation snapshot as immutable", async () => {
  const response = await fetch(`${origin}/vendor/odyssey-foundation-1.0.css`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.match(await response.text(), /--ody-foundation-version:\"1\.0\.0\"/);
});

test("rejects traversal and unsupported methods", async () => {
  const traversal = await new Promise((resolve, reject) => {
    const url = new URL(origin);
    const request = httpRequest(
      {
        hostname: url.hostname,
        method: "GET",
        path: "/%2e%2e/%2e%2e/etc/passwd",
        port: url.port,
      },
      resolve,
    );
    request.once("error", reject);
    request.end();
  });
  assert.equal(traversal.statusCode, 400);
  traversal.resume();

  const post = await fetch(`${origin}/`, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});

test("returns a fixed 404 for unknown assets", async () => {
  const response = await fetch(`${origin}/missing.js`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not found\n");
});
