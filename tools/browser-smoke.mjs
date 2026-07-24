import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../server.mjs";

let targetUrl = process.argv.find((argument) => argument.startsWith("--url="))?.slice(6);
const outputDirectory = process.argv.find((argument) => argument.startsWith("--out="))?.slice(6);
const chromium = process.env.CHROMIUM_BIN || "/usr/bin/chromium";
let localServer;

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viewportMatrix = [
  { height: 720, name: "mobile-320", width: 320 },
  { height: 844, name: "mobile-390", reduceMotion: true, width: 390 },
  { height: 1024, name: "tablet-768", width: 768 },
  { height: 900, name: "laptop-1024", width: 1024 },
  { height: 1000, name: "desktop-1440", width: 1440 },
  { deviceScaleFactor: 2, height: 900, name: "reflow-640-dpr2", width: 640 },
];

async function runSourceGates() {
  const [html, css, app, graph] = await Promise.all([
    readFile(path.join(productRoot, "index.html"), "utf8"),
    readFile(path.join(productRoot, "styles.css"), "utf8"),
    readFile(path.join(productRoot, "src/app.mjs"), "utf8"),
    readFile(path.join(productRoot, "src/graph.mjs"), "utf8"),
  ]);
  const productSource = `${html}\n${css}\n${app}\n${graph}`;

  assert.doesNotMatch(
    productSource,
    /linear-gradient|radial-gradient|backdrop-filter|createLinearGradient|createRadialGradient|shadowBlur|shadowColor/,
    "the engraved atlas must not reintroduce glass, decorative gradients, or Canvas glow",
  );
  assert.doesNotMatch(
    productSource,
    /实时力场|力场温度|SCALE 1:∞|N 52|live-chip|temperatureMetric|[◎✦＋⌁]/,
    "fake telemetry and font-glyph controls must stay removed",
  );
  assert.match(html, /SOURCE \/ EA9B337/);
  assert.match(html, /id="zoomReadout"[^>]*>ZOOM \/ 100%/);
  assert.match(
    html,
    /id="relationshipIntensity"[^>]*min="1"[^>]*max="5"[^>]*value="3"[^>]*step="1"/,
  );
  assert.match(html, /class="nojs-boundary"[\s\S]*STATIC SOURCE BOUNDARY[\s\S]*116 人 \/ 108 条关系/);
  assert.match(graph, /0\.72 \+ edge\.intensity \* 0\.38/);
  assert.match(graph, /context\.setLineDash\(style\.dash\.map/);
  assert.match(app, /stats\.averageIntensity\.toFixed\(1\).*\/ 5/);
}

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

async function waitForExit(child, timeout = 1500) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    let timer;
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeout);
    child.once("exit", onExit);
  });
}

async function removeProfile(profile) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { force: true, recursive: true });
      return;
    } catch (error) {
      if (error?.code !== "ENOTEMPTY" || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}

async function smoke(viewport, options = {}) {
  const mode = options.javaScript === false ? "nojs" : options.forcedColors ? "forced" : "js";
  const profile = await mkdtemp(path.join(os.tmpdir(), `heartlines-${viewport.name}-${mode}-`));
  const errors = [];
  const failedRequests = [];
  const responses = [];
  const requestedUrls = [];
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
      } else if (message.method === "Network.requestWillBeSent") {
        requestedUrls.push(message.params.request.url);
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
        deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
        height: viewport.height,
        mobile: viewport.width < 600,
        screenHeight: viewport.height,
        screenWidth: viewport.width,
        width: viewport.width,
      }),
      cdp.send("Emulation.setEmulatedMedia", {
        features: [
          {
            name: "prefers-reduced-motion",
            value: viewport.reduceMotion ? "reduce" : "no-preference",
          },
        ],
      }),
    ]);

    if (options.javaScript === false) {
      await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
    }

    await cdp.send("Page.navigate", { url: targetUrl });

    if (options.javaScript === false) {
      await waitFor(async () => {
        const ready = await cdp.send("Runtime.evaluate", {
          expression: "document.readyState === 'complete'",
          returnByValue: true,
        });
        return ready.result.value === true;
      }, `${viewport.name} no-JavaScript document did not complete`);

      const noJavaScript = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const boundary = document.querySelector(".nojs-boundary");
          const boundaryStyle = boundary && getComputedStyle(boundary);
          const onScreen = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none"
              && style.visibility !== "hidden"
              && rect.width > 0
              && rect.height > 0
              && rect.bottom > 0
              && rect.right > 0
              && rect.top < innerHeight
              && rect.left < innerWidth;
          };
          const visibleInteractive = [...document.querySelectorAll(
            'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
          )].filter(onScreen).map((element) => element.id || element.className || element.tagName);
          return {
            boundaryDisplay: boundaryStyle?.display,
            boundaryText: boundary?.innerText ?? "",
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            visibleInteractive,
            workspaceDisplay: getComputedStyle(document.querySelector(".workspace")).display,
          };
        })()`,
        returnByValue: true,
      });
      const noJavaScriptResult = noJavaScript.result.value;
      assert.notEqual(noJavaScriptResult.boundaryDisplay, "none");
      assert.match(noJavaScriptResult.boundaryText, /ea9b337/i);
      assert.match(noJavaScriptResult.boundaryText, /116 人 \/ 108 条关系/);
      assert.match(noJavaScriptResult.boundaryText, /不会上传/);
      assert.equal(noJavaScriptResult.workspaceDisplay, "none");
      assert.deepEqual(
        noJavaScriptResult.visibleInteractive,
        [],
        "the no-JavaScript boundary must not expose inert graph/edit/export controls",
      );
      assert.ok(
        noJavaScriptResult.scrollWidth <= noJavaScriptResult.clientWidth,
        `no-JavaScript horizontal overflow ${noJavaScriptResult.scrollWidth}/${noJavaScriptResult.clientWidth}`,
      );

      if (outputDirectory) {
        const screenshot = await cdp.send("Page.captureScreenshot", {
          captureBeyondViewport: false,
          format: "png",
          fromSurface: true,
        });
        await writeFile(
          path.join(outputDirectory, `heartlines-${viewport.name}-nojs.png`),
          Buffer.from(screenshot.data, "base64"),
        );
      }

      const expectedOrigin = new URL(targetUrl).origin;
      const externalRequests = requestedUrls.filter((url) => {
        if (url === "about:blank" || url.startsWith("data:")) return false;
        return new URL(url).origin !== expectedOrigin;
      });
      assert.deepEqual(externalRequests, [], `external requests: ${externalRequests.join(", ")}`);
      assert.deepEqual(responses, [], `HTTP errors: ${responses.join(", ")}`);
      assert.deepEqual(failedRequests, [], `failed requests: ${failedRequests.join(", ")}`);
      assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
      return { ...noJavaScriptResult, javaScript: false, viewport: viewport.name };
    }

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
          inlineControlSvgCount: document.querySelectorAll("button svg").length,
          intensity: document.getElementById("intensityMetric").textContent.trim(),
          motion: app.dataset.motion,
          people: Number(document.getElementById("peopleMetric").textContent),
          relations: Number(document.getElementById("relationsMetric").textContent),
          title: document.title,
          zoom: document.getElementById("zoomReadout").textContent.trim(),
        };
      })()`,
      returnByValue: true,
    });
    const result = evaluated.result.value;

    assert.equal(result.boot, "ready");
    assert.equal(result.foundation, "1.0.0");
    assert.equal(result.graphLoadingHidden, true);
    assert.equal(
      result.motion,
      viewport.reduceMotion ? "reduced" : "full",
      "the initial motion setting should follow the emulated operating-system preference",
    );
    assert.equal(result.people, 116);
    assert.equal(result.relations, 108);
    assert.ok(result.graphWidth >= 280, `graph width ${result.graphWidth}`);
    assert.ok(result.graphHeight >= 280, `graph height ${result.graphHeight}`);
    assert.ok(result.canvasBytes > 1000);
    assert.ok(result.inlineControlSvgCount >= 10);
    assert.match(result.intensity, /^[0-5]\.\d \/ 5$/);
    assert.match(result.zoom, /^ZOOM \/ \d+%$/);
    assert.ok(
      result.documentScrollWidth <= result.documentClientWidth,
      `horizontal overflow ${result.documentScrollWidth}/${result.documentClientWidth}`,
    );

    if (options.forcedColors) {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [
          {
            name: "prefers-reduced-motion",
            value: viewport.reduceMotion ? "reduce" : "no-preference",
          },
          { name: "forced-colors", value: "active" },
        ],
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const forcedColorsState = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        a11yDisplay: getComputedStyle(document.getElementById("a11yView")).display,
        canvasDisplay: getComputedStyle(document.getElementById("relationCanvas")).display,
        forced: matchMedia("(forced-colors: active)").matches,
      }))()`,
      returnByValue: true,
    });
    assert.equal(forcedColorsState.result.value.forced, Boolean(options.forcedColors));
    if (options.forcedColors) {
      assert.notEqual(forcedColorsState.result.value.a11yDisplay, "none");
      assert.equal(forcedColorsState.result.value.canvasDisplay, "none");
    }

    const viewportTruth = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const canvas = document.getElementById("relationCanvas");
        const zoom = document.getElementById("zoomReadout");
        const beforeZoom = zoom.textContent;
        document.getElementById("zoomIn").click();
        await new Promise((resolve) => setTimeout(resolve, 180));
        const afterZoom = zoom.textContent;
        const beforeTheme = canvas.toDataURL("image/png");
        document.getElementById("themeToggle").click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const afterTheme = canvas.toDataURL("image/png");
        return {
          afterZoom,
          beforeZoom,
          canvasRedrawn: beforeTheme !== afterTheme,
          theme: document.getElementById("app").dataset.theme,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.notEqual(viewportTruth.result.value.afterZoom, viewportTruth.result.value.beforeZoom);
    assert.equal(viewportTruth.result.value.canvasRedrawn, true);
    assert.equal(viewportTruth.result.value.theme, "light");

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

    let mobileDock;
    if (viewport.width <= 820) {
      mobileDock = await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const rail = document.querySelector(".control-rail");
          const controls = document.querySelector('[data-mobile-action="controls"]');
          const search = document.querySelector('[data-mobile-action="search"]');
          const initiallyInert = rail.inert;
          const initiallyHidden = rail.getAttribute("aria-hidden") === "true";

          controls.click();
          await new Promise((resolve) => setTimeout(resolve, 320));
          const openedByControls = !rail.inert
            && rail.getAttribute("aria-hidden") !== "true"
            && (rail.classList.contains("is-mobile-open")
              || document.getElementById("app").classList.contains("is-rail-open"));

          controls.click();
          await new Promise((resolve) => setTimeout(resolve, 320));
          const closedAfterToggle = rail.inert && rail.getAttribute("aria-hidden") === "true";

          search.click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const openedBySearch = !rail.inert
            && rail.getAttribute("aria-hidden") !== "true"
            && document.activeElement === document.getElementById("searchInput");

          const inspector = document.querySelector(".inspector");
          const selection = document.querySelector('[data-mobile-action="selection"]');
          document.querySelector("#peopleList [data-person-id]").click();
          await new Promise((resolve) => setTimeout(resolve, 320));
          const inspectorOpenedForSelection = !inspector.inert
            && inspector.getAttribute("aria-hidden") !== "true"
            && inspector.classList.contains("is-mobile-open")
            && inspector.getBoundingClientRect().top < innerHeight;

          selection.click();
          await new Promise((resolve) => setTimeout(resolve, 320));
          const inspectorRect = inspector.getBoundingClientRect();
          const inspectorClosedAfterToggle = inspector.inert
            && inspector.getAttribute("aria-hidden") === "true"
            && !inspector.classList.contains("is-mobile-open")
            && inspectorRect.top >= innerHeight;

          return {
            closedAfterToggle,
            initiallyHidden,
            initiallyInert,
            inspectorClosedAfterToggle,
            inspectorOpenedForSelection,
            openedByControls,
            openedBySearch,
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      assert.deepEqual(mobileDock.result.value, {
        closedAfterToggle: true,
        initiallyHidden: true,
        initiallyInert: true,
        inspectorClosedAfterToggle: true,
        inspectorOpenedForSelection: true,
        openedByControls: true,
        openedBySearch: true,
      });
    }

    const targetAudit = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const violations = new Set();
        const isOnScreen = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity) !== 0
            && !element.closest("[inert]")
            && rect.width > 0
            && rect.height > 0
            && rect.bottom > 0
            && rect.right > 0
            && rect.top < innerHeight
            && rect.left < innerWidth;
        };
        const audit = (state) => {
          for (const element of document.querySelectorAll(
            'a[href], button, input:not([type="hidden"]), select, textarea, [role="option"]',
          )) {
            if (!isOnScreen(element) || element.disabled) continue;
            const rect = element.getBoundingClientRect();
            if (rect.width + .5 < 44 || rect.height + .5 < 44) {
              violations.add(
                [state, element.id || element.getAttribute("aria-label") || element.tagName,
                  Math.round(rect.width), Math.round(rect.height)].join(":"),
              );
            }
          }
        };

        audit("initial");
        document.getElementById("listViewButton").click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        audit("list");
        document.getElementById("graphViewButton").click();

        if (innerWidth <= 820) {
          document.querySelector('[data-mobile-action="controls"]').click();
          await new Promise((resolve) => setTimeout(resolve, 40));
          audit("mobile-controls");
          document.querySelector('[data-mobile-action="controls"]').click();
        }

        document.getElementById("modeStudio").click();
        const personTrigger = innerWidth <= 820
          ? document.querySelector('[data-mobile-action="add"]')
          : document.getElementById("addPersonButton");
        personTrigger.click();
        await new Promise((resolve) => setTimeout(resolve, 280));
        audit("person-dialog");
        document.getElementById("personDialog").close();

        document.getElementById("addRelationshipButton").click();
        await new Promise((resolve) => setTimeout(resolve, 280));
        audit("relationship-dialog");
        document.getElementById("relationshipDialog").close();
        return [...violations];
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.deepEqual(
      targetAudit.result.value,
      [],
      `interactive targets below 44x44: ${targetAudit.result.value.join(", ")}`,
    );

    await cdp.send("Runtime.evaluate", {
      expression: "document.activeElement?.blur(); document.body.focus();",
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Slash",
      key: "/",
      text: "/",
      type: "keyDown",
    });
    await cdp.send("Input.dispatchKeyEvent", { code: "Slash", key: "/", type: "keyUp" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const shortcutFocus = await cdp.send("Runtime.evaluate", {
      expression: "document.activeElement?.id",
      returnByValue: true,
    });
    assert.equal(shortcutFocus.result.value, "searchInput");
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Escape",
      key: "Escape",
      nativeVirtualKeyCode: 27,
      type: "rawKeyDown",
      windowsVirtualKeyCode: 27,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Escape",
      key: "Escape",
      nativeVirtualKeyCode: 27,
      type: "keyUp",
      windowsVirtualKeyCode: 27,
    });

    const dialogKeyboard = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const trigger = innerWidth <= 820
          ? document.querySelector('[data-mobile-action="add"]')
          : document.getElementById("addPersonButton");
        trigger.focus();
        trigger.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          focused: document.activeElement?.id,
          open: document.getElementById("personDialog").open,
          trigger: trigger.id || trigger.dataset.mobileAction,
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(dialogKeyboard.result.value.open, true);
    assert.equal(dialogKeyboard.result.value.focused, "personName");
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Escape",
      key: "Escape",
      nativeVirtualKeyCode: 27,
      type: "rawKeyDown",
      windowsVirtualKeyCode: 27,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      code: "Escape",
      key: "Escape",
      nativeVirtualKeyCode: 27,
      type: "keyUp",
      windowsVirtualKeyCode: 27,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const dialogAfterEscape = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const active = document.activeElement;
        return {
          focus: active?.id || active?.dataset?.mobileAction || "",
          open: document.getElementById("personDialog").open,
        };
      })()`,
      returnByValue: true,
    });
    assert.equal(dialogAfterEscape.result.value.open, false);
    assert.equal(dialogAfterEscape.result.value.focus, dialogKeyboard.result.value.trigger);

    await cdp.send("Accessibility.enable");
    const accessibilityTree = await cdp.send("Accessibility.getFullAXTree");
    const exposedNodes = accessibilityTree.nodes.filter((node) => !node.ignored);
    assert.ok(exposedNodes.some((node) => node.role?.value === "RootWebArea"));
    assert.ok(
      exposedNodes.some((node) =>
        node.role?.value === "heading" && node.name?.value === "关系星图"),
      "the relationship graph heading must be exposed in the accessibility tree",
    );
    assert.ok(
      !exposedNodes.some((node) => node.role?.value === "Canvas"),
      "the visual Canvas must remain hidden from the accessibility tree",
    );

    const storageFailure = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const beforePeople = Number(document.getElementById("peopleMetric").textContent);
        const originalSetItem = Storage.prototype.setItem;
        Object.defineProperty(Storage.prototype, "setItem", {
          configurable: true,
          value() {
            throw new DOMException("Synthetic quota failure", "QuotaExceededError");
          },
        });

        try {
          document.getElementById("addPersonButton").click();
          document.getElementById("personName").value = "存储失败测试";
          document.getElementById("personForm").requestSubmit();
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {
            afterPeople: Number(document.getElementById("peopleMetric").textContent),
            beforePeople,
            saveState: document.getElementById("saveStatus").dataset.state,
          };
        } finally {
          Object.defineProperty(Storage.prototype, "setItem", {
            configurable: true,
            value: originalSetItem,
          });
          if (document.getElementById("personDialog").open) {
            document.getElementById("personDialog").close();
          }
        }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(
      storageFailure.result.value.afterPeople,
      storageFailure.result.value.beforePeople,
      "a person edit must not be applied when local persistence fails",
    );
    assert.equal(storageFailure.result.value.saveState, "error");

    if (outputDirectory) {
      const screenshot = await cdp.send("Page.captureScreenshot", {
        captureBeyondViewport: false,
        format: "png",
        fromSurface: true,
      });
      await writeFile(
        path.join(outputDirectory, `heartlines-${viewport.name}-${mode}.png`),
        Buffer.from(screenshot.data, "base64"),
      );
    }

    const expectedOrigin = new URL(targetUrl).origin;
    const externalRequests = requestedUrls.filter((url) => {
      if (url === "about:blank" || url.startsWith("data:")) return false;
      return new URL(url).origin !== expectedOrigin;
    });
    assert.deepEqual(externalRequests, [], `external requests: ${externalRequests.join(", ")}`);
    assert.deepEqual(responses, [], `HTTP errors: ${responses.join(", ")}`);
    assert.deepEqual(failedRequests, [], `failed requests: ${failedRequests.join(", ")}`);
    assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
    return {
      ...result,
      accessibilityNodes: exposedNodes.length,
      forcedColors: forcedColorsState.result.value,
      interactions: interactions.result.value,
      mobileDock: mobileDock?.result.value,
      storageFailure: storageFailure.result.value,
      targetAudit: targetAudit.result.value,
      viewportTruth: viewportTruth.result.value,
      viewport: viewport.name,
    };
  } finally {
    cdp?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGTERM");
    if (!(await waitForExit(chrome))) {
      chrome.kill("SIGKILL");
      await waitForExit(chrome);
    }
    await removeProfile(profile);
  }
}

try {
  await runSourceGates();

  if (!targetUrl) {
    localServer = createAppServer();
    await new Promise((resolve, reject) => {
      localServer.once("error", reject);
      localServer.listen(0, "127.0.0.1", resolve);
    });
    const address = localServer.address();
    assert.ok(address && typeof address === "object");
    targetUrl = `http://127.0.0.1:${address.port}`;
  }

  if (outputDirectory) {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(outputDirectory, { recursive: true }));
  }

  const results = [];
  for (const viewport of viewportMatrix) {
    results.push(await smoke(viewport));
  }
  for (const viewport of viewportMatrix.filter(({ name }) => name !== "reflow-640-dpr2")) {
    results.push(await smoke(viewport, { javaScript: false }));
  }
  results.push(await smoke(
    { height: 900, name: "forced-colors-1024", width: 1024 },
    { forcedColors: true },
  ));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  if (localServer) {
    localServer.closeAllConnections();
    await new Promise((resolve, reject) => {
      localServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
