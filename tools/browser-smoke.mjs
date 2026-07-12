import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const targetUrl = process.argv.find((argument) => argument.startsWith("--url="))?.slice(6);
const outputDirectory = process.argv.find((argument) => argument.startsWith("--out="))?.slice(6);
const chromium = process.env.CHROMIUM_BIN || "/usr/bin/chromium";

if (!targetUrl) {
  throw new Error("usage: node tools/browser-smoke.mjs --url=<url> [--out=<directory>]");
}

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
];

async function waitFor(predicate, message, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(message);
}

async function connect(webSocketUrl, eventHandler) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    eventHandler(message);
  });

  return {
    close() {
      socket.close();
    },
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function smoke(viewport) {
  const profile = await mkdtemp(path.join(os.tmpdir(), `heartlines-${viewport.name}-`));
  const errors = [];
  const failedRequests = [];
  const responses = [];
  const chrome = spawn(
    chromium,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  let chromeStderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => {
    chromeStderr += chunk;
  });

  let cdp;
  try {
    const activePort = path.join(profile, "DevToolsActivePort");
    const port = await waitFor(async () => {
      try {
        const contents = await readFile(activePort, "utf8");
        return Number(contents.split("\n", 1)[0]);
      } catch {
        if (chrome.exitCode !== null) {
          throw new Error(`Chromium exited early: ${chromeStderr}`);
        }
        return null;
      }
    }, "Chromium did not expose a debugging port");

    const targets = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const body = await response.json();
      return body.find((target) => target.type === "page") ? body : null;
    }, "Chromium did not create a page target");
    const page = targets.find((target) => target.type === "page");

    cdp = await connect(page.webSocketDebuggerUrl, (message) => {
      if (message.method === "Runtime.exceptionThrown") {
        errors.push(message.params.exceptionDetails?.text || "Runtime exception");
      } else if (
        message.method === "Runtime.consoleAPICalled" &&
        ["assert", "error"].includes(message.params.type)
      ) {
        errors.push(
          message.params.args
            .map((argument) => argument.value ?? argument.description ?? "console error")
            .join(" "),
        );
      } else if (
        message.method === "Log.entryAdded" &&
        message.params.entry.level === "error"
      ) {
        errors.push(message.params.entry.text);
      } else if (message.method === "Network.loadingFailed") {
        failedRequests.push(`${message.params.errorText} ${message.params.blockedReason ?? ""}`.trim());
      } else if (message.method === "Network.responseReceived") {
        const { response } = message.params;
        if (response.status >= 400) responses.push(`${response.status} ${response.url}`);
      }
    });

    await Promise.all([
      cdp.send("Page.enable"),
      cdp.send("Runtime.enable"),
      cdp.send("Log.enable"),
      cdp.send("Network.enable"),
      cdp.send("Emulation.setDeviceMetricsOverride", {
        deviceScaleFactor: 1,
        height: viewport.height,
        mobile: viewport.width < 600,
        screenHeight: viewport.height,
        screenWidth: viewport.width,
        width: viewport.width,
      }),
    ]);

    await cdp.send("Page.navigate", { url: targetUrl });
    await waitFor(async () => {
      const result = await cdp.send("Runtime.evaluate", {
        expression: "document.readyState === 'complete' && document.getElementById('app')?.dataset.boot === 'ready'",
        returnByValue: true,
      });
      return result.result.value === true;
    }, `${viewport.name} app did not reach ready state`);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const evaluated = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const app = document.getElementById("app");
        const canvas = document.getElementById("relationCanvas");
        const graph = canvas.getBoundingClientRect();
        return {
          boot: app.dataset.boot,
          canvasBytes: canvas.toDataURL("image/png").length,
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          foundation: getComputedStyle(app).getPropertyValue("--ody-foundation-version").replaceAll('"', "").trim(),
          graphHeight: Math.round(graph.height),
          graphLoadingHidden: document.getElementById("graphLoading").hidden,
          graphWidth: Math.round(graph.width),
          people: Number(document.getElementById("peopleMetric").textContent),
          relations: Number(document.getElementById("relationsMetric").textContent),
          title: document.title,
        };
      })()`,
      returnByValue: true,
    });
    const result = evaluated.result.value;

    assert.equal(result.boot, "ready");
    assert.equal(result.foundation, "1.0.0");
    assert.equal(result.graphLoadingHidden, true);
    assert.ok(result.people >= 8);
    assert.ok(result.relations >= 1);
    assert.ok(result.graphWidth >= 280, `graph width ${result.graphWidth}`);
    assert.ok(result.graphHeight >= 280, `graph height ${result.graphHeight}`);
    assert.ok(result.canvasBytes > 1000);
    assert.ok(
      result.documentScrollWidth <= result.documentClientWidth,
      `horizontal overflow ${result.documentScrollWidth}/${result.documentClientWidth}`,
    );

    const interactions = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        document.querySelector('[data-layout="heart"]').click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        document.getElementById("listViewButton").click();
        const listVisible = !document.getElementById("a11yView").hidden
          && getComputedStyle(document.getElementById("a11yView")).display !== "none";
        document.getElementById("graphViewButton").click();
        document.getElementById("modeStudio").click();
        document.getElementById("addPersonButton").click();
        const dialogOpen = document.getElementById("personDialog").open;
        document.getElementById("closePersonDialog").click();
        return { dialogOpen, listVisible, mode: document.getElementById("app").dataset.mode };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(interactions.result.value.listVisible, true);
    assert.equal(interactions.result.value.dialogOpen, true);
    assert.equal(interactions.result.value.mode, "studio");

    if (outputDirectory) {
      const screenshot = await cdp.send("Page.captureScreenshot", {
        captureBeyondViewport: false,
        format: "png",
        fromSurface: true,
      });
      await writeFile(
        path.join(outputDirectory, `heartlines-${viewport.name}.png`),
        Buffer.from(screenshot.data, "base64"),
      );
    }

    assert.deepEqual(responses, [], `HTTP errors: ${responses.join(", ")}`);
    assert.deepEqual(failedRequests, [], `failed requests: ${failedRequests.join(", ")}`);
    assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
    return { ...result, interactions: interactions.result.value, viewport: viewport.name };
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    await new Promise((resolve) => {
      if (chrome.exitCode !== null) resolve();
      else chrome.once("exit", resolve);
      setTimeout(resolve, 1500);
    });
    await rm(profile, { force: true, recursive: true });
  }
}

if (outputDirectory) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(outputDirectory, { recursive: true }));
}

const results = [];
for (const viewport of viewports) {
  results.push(await smoke(viewport));
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
