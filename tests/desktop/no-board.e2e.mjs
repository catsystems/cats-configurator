/* global before, describe, it */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser } from "@wdio/globals";
import packageJson from "../../package.json" with { type: "json" };
import {
  checkHandoff,
  hostCall,
  navigationToggle,
  openPage,
  selectMainWindow,
} from "./support.mjs";

const fixtureScript = fileURLToPath(
  new URL(
    "../../skills/cats-configurator-test/scripts/check.mjs",
    import.meta.url,
  ),
);

async function dropFixture(path) {
  // Deliver the same event the Tauri window receives from an OS file drop.
  await browser
    .executeAsync((file, done) => {
      window.__TAURI_INTERNALS__
        .invoke("plugin:event|emit_to", {
          target: { kind: "Window", label: "main" },
          event: "tauri://drag-drop",
          payload: { paths: [file], position: { x: 0, y: 0 } },
        })
        .then(
          () => done(null),
          (error) => done(String(error)),
        );
    }, path)
    .then((error) => assert.equal(error, null));
}

describe("Configurator desktop without a board", () => {
  before(selectMainWindow);
  it("launches disconnected with Connect disabled", async () => {
    const footer = await $("footer");
    await footer.waitForDisplayed();
    assert.match(await footer.getText(), /Status: Disconnected/);
    assert.ok(
      (await footer.getText()).includes(`App version: ${packageJson.version}`),
    );
    const connect = await $("button=Connect");
    assert.equal(await connect.isEnabled(), false);
    assert.equal(
      (await hostCall("firmware", "current")).platformSupported,
      true,
    );
    await $(".home-card").waitForDisplayed();

    await $('.port-selector [role="combobox"]').click({ x: 0, y: 0 });
    const showOtherPorts = await $("button=Show other serial ports");
    await showOtherPorts.waitForDisplayed();
    const menu = await $(".v-select__content");
    assert.match(await menu.getText(), /No Vega detected/);
    await showOtherPorts.click();
    await $("button=Hide other serial ports").waitForDisplayed();
    assert.match(await menu.getText(), /No serial ports available/);
    assert.equal(await connect.isEnabled(), false);
    await $("button=Hide other serial ports").click();
    await browser.keys("Escape");
  });

  it("offers the Linux USB setup while its device rule is missing", async () => {
    const status = await hostCall("app", "usbAccessStatus");
    const setup = await $(".v-list-item=Enable CATS USB access");
    if (process.platform !== "linux") {
      assert.equal(status, null);
      assert.equal(await setup.isExisting(), false);
      return;
    }
    if (status.installed) {
      assert.equal(await setup.isExisting(), false);
      return;
    }
    await setup.waitForDisplayed();
    await setup.click();
    await $("#usb-access-title").waitForDisplayed();
    if (status.canAuthenticate) await $("button=Use a terminal").click();
    const command = await $(".terminal-command textarea");
    await command.waitForDisplayed();
    assert.match(await command.getValue(), /udevadm control --reload-rules/);
    assert.match(await command.getValue(), /70-cats-devices\.rules/);
    await $("button=Later").click();
    await $("#usb-access-title").waitForDisplayed({ reverse: true });
  });

  it("reflows the window and opens the offline Ground Station radio guide", async () => {
    await browser.setWindowRect(null, null, 700, 760);
    const toggle = await $(navigationToggle);
    await toggle.waitForDisplayed({
      timeoutMsg: "The window manager did not provide a narrow viewport",
    });
    assert.ok(
      await browser.execute(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );

    await openPage("/firmware");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await $("button=Radio firmware installation guide").click();
    await $("#radio-guide-title").waitForDisplayed();
    const dialog = await $("[role=dialog]");
    await dialog.$("button=Close guide").click();
    await $("#radio-guide-title").waitForDisplayed({ reverse: true });
    assert.equal(await $("button=Update Ground Station").isEnabled(), false);
    assert.equal(await $("button=Prepare radio firmware").isEnabled(), false);

    await browser.setWindowRect(null, null, 1120, 760);
    await toggle.waitForExist({
      reverse: true,
      timeoutMsg: "The window manager did not provide a wide viewport",
    });
    await $("#app-navigation").waitForDisplayed();
  });

  it("imports a synthetic log through the native host and recovers from an empty file", async () => {
    await openPage("/flight-logs");
    await $("button=Choose flight log").waitForDisplayed();
    const { flightLog, invalidLog } = JSON.parse(
      execFileSync(process.execPath, [fixtureScript, "fixture"], {
        encoding: "utf8",
      }),
    );
    try {
      await dropFixture(flightLog);
      const current = await $(".current-log-heading");
      await current.waitForDisplayed();
      assert.match(await current.getText(), /synthetic-configurator-test\.cfl/);
      await browser.waitUntil(
        () =>
          browser.execute(() =>
            Array.from(document.querySelectorAll(".js-plotly-plot")).some(
              (plot) => plot.data?.some((trace) => trace.y?.includes(12)),
            ),
          ),
        {
          timeoutMsg: "The synthetic log did not plot the expected 12 m sample",
        },
      );
      assert.equal(await $("button=Export CSV").isEnabled(), true);

      await dropFixture(invalidLog);
      const error = await $(".flight-log-error");
      await error.waitForDisplayed();
      assert.match(await error.getText(), /file is empty/i);
      await current.waitForExist({ reverse: true });
      assert.equal(await $(".js-plotly-plot").isExisting(), false);

      await dropFixture(flightLog);
      const recovered = await $(".current-log-heading");
      await recovered.waitForDisplayed();
      assert.equal(await $(".flight-log-error").isExisting(), false);
      await checkHandoff(
        await recovered.$("button*=Open in Flights"),
        flightLog,
      );
    } finally {
      await rm(dirname(flightLog), { recursive: true, force: true });
    }
  });
});
