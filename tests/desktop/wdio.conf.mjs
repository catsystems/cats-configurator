import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@wdio/globals";

const root = fileURLToPath(new URL("../../", import.meta.url));
const results = join(root, "test-results", "desktop");
const binary =
  process.platform === "win32" ? "cats-configurator.exe" : "cats-configurator";
const firmwareWrite =
  process.env.CATS_DESKTOP_TEST_INSTALL_VERSION ||
  process.env.CATS_DESKTOP_TEST_PREPARE_RADIO_VERSION;

export const config = {
  runner: "local",
  specs: [`./${process.env.CATS_DESKTOP_TEST_MODE || "no-board"}.e2e.mjs`],
  maxInstances: 1,
  capabilities: [{ browserName: "tauri" }],
  services: [
    [
      "tauri",
      {
        driverProvider: "embedded",
        appBinaryPath: join(
          root,
          "src-tauri",
          "target",
          "desktop-test",
          "debug",
          binary,
        ),
      },
    ],
  ],
  framework: "mocha",
  mochaOpts: {
    timeout: firmwareWrite ? 420_000 : 180_000,
    bail: Boolean(firmwareWrite),
  },
  reporters: ["spec"],
  logLevel: "warn",
  waitforTimeout: 15_000,
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    try {
      await mkdir(results, { recursive: true });
      const name = test.title.replace(/[^a-z0-9]+/gi, "-");
      await browser.saveScreenshot(join(results, `${name}.png`));
    } catch (error) {
      console.warn(`Could not capture the test window: ${error.message}`);
    }
  },
};
