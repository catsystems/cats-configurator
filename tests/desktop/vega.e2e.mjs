/* global before, describe, it */

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { basename } from "node:path";
import { $, $$, browser } from "@wdio/globals";
import {
  checkHandoff,
  hostCall,
  openPage,
  selectMainWindow,
  waitForFirmwareResult,
} from "./support.mjs";

const installVersion = process.env.CATS_DESKTOP_TEST_INSTALL_VERSION;
const vegaPath = process.env.CATS_DESKTOP_TEST_VEGA_PORT;

async function pickerLabels() {
  const options = await $$('.v-select__content [role="option"]');
  return options.map((option) => option.getText());
}

describe("Configurator desktop with the test Vega", () => {
  before(selectMainWindow);
  it("connects and loads configuration, events, profiles, and preflight", async () => {
    const footer = await $("footer");
    await browser.waitUntil(
      async () => /Status: Connected/.test(await footer.getText()),
      {
        timeout: 30_000,
        timeoutMsg:
          "The selected Vega did not connect. Check USB access and competing serial clients.",
      },
    );
    assert.match(await footer.getText(), /CATS Vega/);
    await $(".config-card").waitForDisplayed();
    await openPage("/events");
    await $(".event-column-card").waitForDisplayed();
    await openPage("/profiles");
    const profile = await $(".profile-summary");
    await profile.waitForDisplayed();
    assert.match(await profile.getText(), /CATS Vega/);
    await openPage("/preflight");
    await $(".v-card-title=Preflight Report").waitForDisplayed();
  });

  it("reads board status in the CLI", async () => {
    await openPage("/cli");
    const command = await $(".cli-input input");
    await command.waitForDisplayed();
    await command.click();
    await command.setValue("status");
    await browser.keys("Enter");
    await browser.waitUntil(
      async () => /State:/.test(await $("#cli_card").getText()),
      {
        timeoutMsg: "The Vega did not return a status to the CLI",
      },
    );
  });

  it(
    installVersion
      ? "installs and verifies Vega firmware"
      : "opens Vega's firmware update confirmation with its safety check",
    async () => {
      await openPage("/firmware");
      await $("button=Check devices & releases").click();
      const update = await $("button=Update Vega");
      await update.waitForEnabled({ timeout: 45_000 });
      const snapshot = await hostCall("firmware", "current");
      const candidates = snapshot.devices.filter(
        ({ target }) => target === "vega",
      );
      assert.equal(candidates.length, 1, "Expected one unambiguous test Vega");
      const [vega] = candidates;
      assert.equal(vega.label, `Vega (${vegaPath})`);
      assert.equal(vega.versionSource, "serial");
      assert.match(vega.version, /^\d+\.\d+\.\d+/);
      const release = snapshot.available.find(
        ({ target }) => target === "vega",
      );
      console.log(`Vega ${vega.version}; offered ${release.version}`);
      if (installVersion) {
        assert.equal(
          release.version,
          installVersion,
          "The offered firmware is not the requested version",
        );
      }

      await update.click();
      const dialog = await $("[role=dialog]");
      await dialog.waitForDisplayed();
      assert.ok((await dialog.getText()).includes(release.version));
      assert.match(
        await dialog.getText(),
        /Deployment charges are disconnected/,
      );
      const submit = await dialog.$("button=Start update");
      assert.equal(await submit.isEnabled(), false);
      if (!installVersion) {
        await dialog.$("button=Back").click();
        await dialog.waitForDisplayed({ reverse: true });
        return;
      }

      for (const label of await dialog.$$(".v-checkbox label"))
        await label.click();
      assert.equal(await submit.isEnabled(), true);
      await submit.click();
      const result = await waitForFirmwareResult(
        snapshot.revision,
        360_000,
        true,
      );
      assert.equal(
        result.stage,
        "succeeded",
        result.error?.message ?? result.message,
      );
      const verified = result.devices.find(({ id }) => id === vega.id);
      assert.equal(verified.version, installVersion);
      assert.equal(verified.versionSource, "serial");
      console.log(`Vega reconnected and verified ${verified.version}`);
    },
  );

  it("reads an onboard log and exercises the direct Flights handoff", async function () {
    const log = process.env.CATS_DESKTOP_TEST_VEGA_LOG;
    if (!log) {
      console.log(
        "SKIP onboard flight-log handoff (provide --log FILE.cfl on the Vega drive).",
      );
      this.skip();
    }
    await browser.waitUntil(
      () =>
        access(log).then(
          () => true,
          () => false,
        ),
      {
        timeout: 30_000,
        timeoutMsg:
          "The selected log is not accessible on the mounted Vega drive",
      },
    );
    await openPage("/flight-logs");
    const name = basename(log);
    const row = await $(`.v-list-item*=${name}`);
    await row.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: "The selected log was not found on the Vega drive",
    });
    await row.$("button=View locally").click();
    const current = await $(".current-log-heading");
    await current.waitForDisplayed();
    assert.ok((await current.getText()).includes(name));
    await $(".js-plotly-plot").waitForExist();
    await checkHandoff(await row.$("button*=Open in Flights"), log);
  });

  it("disconnects the Vega and disables connection-dependent actions", async () => {
    await $("button=disconnect").click();
    const footer = await $("footer");
    await browser.waitUntil(async () =>
      /Status: Disconnected/.test(await footer.getText()),
    );
    assert.equal(await $("button=Connect").isDisplayed(), true);
  });

  it("shows Vega first and reveals only eligible other ports on request", async () => {
    const ports = await hostCall("serial", "list");
    const groundStation = ports.find(
      ({ vendorId, productId }) => vendorId === "239A" && productId === "80AB",
    );
    if (process.env.CATS_DESKTOP_TEST_WITH_GS === "1") {
      assert.ok(
        groundStation,
        "Connect a Ground Station in application mode for this test",
      );
    }
    const vegaLabel = `CATS Vega (${vegaPath})`;
    const otherPort = ports.find(
      ({ path }) => path !== vegaPath && path !== groundStation?.path,
    );
    const picker = await $('.port-selector [role="combobox"]');
    // The embedded driver needs pointer actions to open Vuetify's mousedown menu.
    await picker.click({ x: 0, y: 0 });
    const show = await $("button=Show other serial ports");
    await show.waitForDisplayed();
    assert.deepEqual(await pickerLabels(), [vegaLabel]);

    await show.click();
    const hide = await $("button=Hide other serial ports");
    await hide.waitForDisplayed();
    if (otherPort) {
      await browser.waitUntil(async () =>
        (await pickerLabels()).includes(otherPort.path),
      );
    }
    const expanded = await pickerLabels();
    assert.equal(expanded[0], vegaLabel);
    assert.ok(!expanded.includes(groundStation?.path));

    await hide.click();
    await $("button=Show other serial ports").waitForDisplayed();
    assert.deepEqual(await pickerLabels(), [vegaLabel]);
    await browser.keys("Escape");
  });
});
