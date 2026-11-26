/* global before, describe, it */

import assert from "node:assert/strict";
import { $ } from "@wdio/globals";
import {
  hostCall,
  openPage,
  selectMainWindow,
  waitForFirmwareResult,
} from "./support.mjs";

const groundStation = {
  target: "ground-station",
  button: "Update Ground Station",
  submit: "Start update",
  result: "succeeded",
};
const radios = {
  target: "telemetry",
  button: "Prepare radio firmware",
  submit: "Prepare file",
  result: "prepared",
};
const installVersion = process.env.CATS_DESKTOP_TEST_INSTALL_VERSION;
const prepareVersion = process.env.CATS_DESKTOP_TEST_PREPARE_RADIO_VERSION;
const recovery = process.env.CATS_DESKTOP_TEST_GS_RECOVERY === "1";

async function discover() {
  const before = await hostCall("firmware", "current");
  await $("button=Check devices & releases").click();
  return waitForFirmwareResult(before.revision);
}

function deviceFor(snapshot, target) {
  const matches = snapshot.devices.filter((device) => device.target === target);
  assert.equal(
    matches.length,
    1,
    `Expected one unambiguous ${target} test device`,
  );
  return matches[0];
}

function checkApplicationMetadata(snapshot) {
  const station = deviceFor(snapshot, groundStation.target);
  const receiverDrive = deviceFor(snapshot, radios.target);
  assert.equal(station.mode, "application");
  assert.equal(station.versionSource, "version-json");
  assert.match(station.version, /^\d+\.\d+\.\d+/);
  assert.equal(receiverDrive.telemetryVersions?.length, 2);
  for (const version of receiverDrive.telemetryVersions) {
    assert.match(version, /^\d+\.\d+\.\d+/);
  }
  console.log(
    `Ground Station ${station.version}; receivers ${receiverDrive.telemetryVersions.join(" and ")}`,
  );
}

async function checkConfirmation(snapshot, operation, requestedVersion) {
  deviceFor(snapshot, operation.target);
  const version = snapshot.available.find(
    (asset) => asset.target === operation.target,
  )?.version;
  const button = await $(`button=${operation.button}`);
  if (requestedVersion) {
    assert.equal(
      version,
      requestedVersion,
      "The offered firmware is not the requested version",
    );
  }
  if (!version) {
    assert.equal(await button.isEnabled(), false);
    console.log(`SKIP ${operation.button} confirmation (no eligible release)`);
    return;
  }
  assert.equal(await button.isEnabled(), true);
  await button.click();
  const dialog = await $("[role=dialog]");
  await dialog.waitForDisplayed();
  assert.ok((await dialog.getText()).includes(version));
  const submit = await dialog.$(`button=${operation.submit}`);
  assert.equal(await submit.isEnabled(), false);
  if (!requestedVersion) {
    await dialog.$("button=Back").click();
    await dialog.waitForDisplayed({ reverse: true });
    return;
  }

  for (const label of await dialog.$$(".v-checkbox label")) await label.click();
  assert.equal(await submit.isEnabled(), true);
  await submit.click();
  const result = await waitForFirmwareResult(snapshot.revision, 360_000, true);
  assert.equal(
    result.stage,
    operation.result,
    result.error?.message ?? result.message,
  );
  if (operation === groundStation) {
    assert.equal(deviceFor(result, operation.target).version, requestedVersion);
  } else {
    assert.match(result.message, /telemetry_firmware/);
  }
}

describe("Configurator desktop with the test Ground Station", () => {
  before(selectMainWindow);
  let discovered;
  let installed = false;

  it("identifies the Ground Station and reports eligible releases", async () => {
    await $("footer").waitForDisplayed();
    await openPage("/firmware");
    const snapshot = await discover();
    if (recovery) {
      assert.equal(deviceFor(snapshot, groundStation.target).mode, "recovery");
      console.log("Found the selected Ground Station in TinyUF2 recovery");
    } else {
      checkApplicationMetadata(snapshot);
    }
    assert.equal(
      snapshot.stage,
      "succeeded",
      snapshot.error?.message ?? snapshot.message,
    );
    for (const { target } of [groundStation, radios]) {
      const version = snapshot.available.find(
        (asset) => asset.target === target,
      )?.version;
      console.log(`${target} release: ${version ?? "unavailable"}`);
    }
    discovered = snapshot;
  });

  it("shows the application update confirmation and its safety gate", async () => {
    assert.ok(
      discovered,
      "Ground Station discovery must pass before an update",
    );
    await checkConfirmation(discovered, groundStation, installVersion);
    installed = Boolean(installVersion);
  });

  it("shows radio preparation separately from receiver installation", async () => {
    assert.ok(
      discovered,
      "Ground Station discovery must pass before radio preparation",
    );
    if (installVersion) {
      assert.ok(
        installed,
        "The requested Ground Station update must pass before radio preparation",
      );
    }
    const snapshot = installVersion ? await discover() : discovered;
    if (installVersion) checkApplicationMetadata(snapshot);
    await checkConfirmation(snapshot, radios, prepareVersion);
  });
});
