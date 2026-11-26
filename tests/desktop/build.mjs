import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
if (process.argv.length > 2) {
  throw new Error("This command takes no arguments.");
}
const result = spawnSync(
  process.execPath,
  [
    cli,
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "desktop-test",
    "--config",
    "src-tauri/tauri.desktop-test.conf.json",
    "--",
    "--locked",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: join(root, "src-tauri", "target", "desktop-test"),
      CARGO_PROFILE_DEV_DEBUG: "0",
    },
    stdio: "inherit",
  },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
