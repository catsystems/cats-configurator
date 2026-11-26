import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { $, browser } from "@wdio/globals";
import { remote } from "webdriverio";

export const navigationToggle = "#navigation-toggle";

export async function selectMainWindow() {
  // Selecting the only window avoids the service's optional multi-window IPC hook.
  let handles;
  await browser.waitUntil(
    async () => {
      handles = await browser.getWindowHandles();
      return handles.length === 1;
    },
    { timeoutMsg: "The Configurator main window did not open" },
  );
  await browser.switchToWindow(handles[0]);
}

export async function openPage(path) {
  const toggle = await $(navigationToggle);
  if (
    (await toggle.isDisplayed()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  ) {
    await toggle.click();
  }
  const link = await $(`#app-navigation a[href="#${path}"]`);
  await link.waitForDisplayed();
  await link.click();
  await browser.waitUntil(async () =>
    (await browser.getUrl()).endsWith(`#${path}`),
  );
}

export async function hostCall(group, method, ...args) {
  const result = await browser.executeAsync(
    (group, method, args, done) => {
      window.cats[group][method](...args).then(
        (value) => done({ value }),
        (error) => done({ error: error.message }),
      );
    },
    group,
    method,
    args,
  );
  if (result.error) throw new Error(result.error);
  return result.value;
}

export async function waitForFirmwareResult(
  revision,
  timeout = 45_000,
  showProgress = false,
) {
  let snapshot;
  let previousStage;
  await browser.waitUntil(
    async () => {
      snapshot = await hostCall("firmware", "current");
      if (
        showProgress &&
        snapshot.revision > revision &&
        snapshot.stage !== previousStage
      ) {
        previousStage = snapshot.stage;
        console.log(`Firmware stage: ${snapshot.stage}`);
      }
      return snapshot.revision > revision && !snapshot.busy;
    },
    { timeout, timeoutMsg: "Configurator firmware operation did not finish" },
  );
  return snapshot;
}

async function startFlightsBrowser() {
  const chromeBinary = process.env.CATS_DESKTOP_TEST_CHROME_BINARY;
  return remote({
    logLevel: "silent",
    capabilities: {
      browserName: "chrome",
      "wdio:chromedriverOptions": {
        allowedIps: ["127.0.0.1", "::1"],
        allowedOrigins: ["http://127.0.0.1", "http://localhost"],
      },
      "goog:chromeOptions": {
        args: ["--headless=new", "--disable-dev-shm-usage"],
        ...(chromeBinary ? { binary: chromeBinary } : {}),
      },
    },
  });
}

async function checkFlightsBrowser(chrome, url, name) {
  try {
    const majorVersion = Number.parseInt(
      chrome.capabilities.browserVersion,
      10,
    );
    if (majorVersion >= 142) {
      // Reproduce accepting the permission prompt inside this disposable browser profile.
      await chrome.sendCommandAndGetResult("Browser.setPermission", {
        origin: url.origin,
        permission: {
          name:
            majorVersion >= 145 ? "loopback-network" : "local-network-access",
        },
        setting: "granted",
      });
    }
    await chrome.url(url.href);
    await chrome.waitUntil(
      () =>
        chrome.execute((filename) => {
          const text = document.body.innerText;
          return (
            text.includes(filename) &&
            /apogee|altitude|maximum velocity/i.test(text)
          );
        }, name),
      { timeout: 30_000 },
    );
  } catch {
    const output = join("test-results", "desktop");
    await mkdir(output, { recursive: true });
    await chrome
      .saveScreenshot(join(output, "cats-flights.png"))
      .catch(() => {});
    throw new Error(
      "CATS Flights did not render the selected log. Check browser local-network access and the live analyzer.",
    );
  }
}

export async function checkHandoff(button, sourceFile) {
  const chrome =
    process.env.CATS_DESKTOP_TEST_LIVE_FLIGHTS === "1"
      ? await startFlightsBrowser()
      : null;
  try {
    await verifyHandoff(button, sourceFile, chrome);
  } finally {
    if (chrome) await chrome.deleteSession();
  }
}

async function verifyHandoff(button, sourceFile, chrome) {
  const capturePath = process.env.CATS_DESKTOP_TEST_FLIGHTS_CAPTURE;
  const name = basename(sourceFile);
  await rm(capturePath, { force: true });
  await button.click();
  let capturedUrl;
  await browser.waitUntil(
    async () => {
      try {
        capturedUrl = await readFile(capturePath, "utf8");
        return Boolean(capturedUrl);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return false;
      }
    },
    { timeoutMsg: "The native host did not start the Flights handoff" },
  );
  const url = new URL(capturedUrl);
  assert.equal(url.origin, "https://catsystems.io");
  assert.equal(url.pathname, "/flights/analyze");
  const fragment = new URLSearchParams(url.hash.slice(1));
  assert.equal(fragment.get("cats-import"), "v1");
  const port = Number(fragment.get("port"));
  const token = fragment.get("token");
  assert.ok(
    Number.isInteger(port) && port > 0 && port <= 65535,
    "Expected a valid loopback port",
  );
  assert.ok(
    /^[A-Za-z0-9_-]{43}$/.test(token ?? ""),
    "Expected a private handoff token",
  );

  if (chrome) {
    await checkFlightsBrowser(chrome, url, name);
  } else {
    const endpoint = `http://127.0.0.1:${port}/v1/flight-log/${token}`;
    const response = await fetch(endpoint, {
      headers: { Origin: url.origin },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-cats-log-name"), name);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(
      bytes.equals(await readFile(sourceFile)),
      "CATS Flights handoff bytes differ from the selected log",
    );
  }
  await $(".v-dialog.v-overlay--active").waitForExist({ reverse: true });
}
