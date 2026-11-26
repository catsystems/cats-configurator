import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const [mode = "no-board", ...args] = process.argv.slice(2);
const options = {
  "no-board": { "live-flights": { type: "boolean" } },
  vega: {
    port: { type: "string" },
    log: { type: "string" },
    "with-gs": { type: "boolean" },
    "install-version": { type: "string" },
    "live-flights": { type: "boolean" },
  },
  gs: {
    "install-version": { type: "string" },
    "prepare-radio-version": { type: "string" },
    recovery: { type: "boolean" },
  },
};
if (!Object.hasOwn(options, mode)) {
  throw new Error("Choose no-board, vega, or gs.");
}
const { values } = parseArgs({ args, options: options[mode] });
if (mode === "vega" && !values.port?.trim()) {
  throw new Error(
    "Vega mode requires the identified serial path (vega --port PORT).",
  );
}
if (mode === "vega" && values["live-flights"] && !values.log) {
  throw new Error("The live onboard Flights test requires --log FILE.cfl.");
}
if (mode === "gs" && values.recovery && !values["install-version"]) {
  throw new Error("Recovery mode requires --install-version VERSION.");
}
let serialPort = values.port ?? "";
if (serialPort && process.platform !== "win32") {
  serialPort = realpathSync(serialPort);
  accessSync(serialPort, constants.R_OK | constants.W_OK);
}

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtureDirectory = mkdtempSync(join(tmpdir(), "cats-desktop-test-"));
try {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules", "@wdio", "cli", "bin", "wdio.js"),
      "run",
      "tests/desktop/wdio.conf.mjs",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CATS_DESKTOP_TEST_MODE: mode,
        CATS_DESKTOP_TEST_VEGA_PORT: serialPort,
        CATS_DESKTOP_TEST_WITH_GS: values["with-gs"] ? "1" : "",
        CATS_DESKTOP_TEST_VEGA_LOG: values.log ? resolve(values.log) : "",
        CATS_DESKTOP_TEST_FLIGHTS_CAPTURE:
          mode === "gs" ? "" : join(fixtureDirectory, "handoff-url"),
        CATS_DESKTOP_TEST_LIVE_FLIGHTS: values["live-flights"] ? "1" : "",
        CATS_DESKTOP_TEST_INSTALL_VERSION: values["install-version"] ?? "",
        CATS_DESKTOP_TEST_GS_RECOVERY: values.recovery ? "1" : "",
        CATS_DESKTOP_TEST_PREPARE_RADIO_VERSION:
          values["prepare-radio-version"] ?? "",
      },
      stdio: "inherit",
    },
  );
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(fixtureDirectory, { recursive: true, force: true });
}
