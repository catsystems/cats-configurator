import assert from "node:assert/strict";
import fs from "node:fs/promises";
import packageJson from "../package.json" with { type: "json" };
import lockfile from "../package-lock.json" with { type: "json" };
import config from "../src-tauri/tauri.conf.json" with { type: "json" };

const cargo = await fs.readFile(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
assert.equal(packageJson.name, "cats-configurator");
assert.equal(config.productName, packageJson.productName);
assert.equal(config.version, packageJson.version);
assert.equal(config.identifier, "com.cats.cats-configurator");
assert.equal(config.build.frontendDist, "../dist");
assert.equal(lockfile.name, packageJson.name);
assert.equal(lockfile.version, packageJson.version);
assert.equal(lockfile.packages[""].name, packageJson.name);
assert.equal(lockfile.packages[""].version, packageJson.version);
assert.match(cargo, /^name = "cats-configurator"$/m);
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], packageJson.version);

for (const section of ["dependencies", "devDependencies"]) {
  assert.deepEqual(lockfile.packages[""][section], packageJson[section]);
  for (const name of Object.keys(packageJson[section])) {
    assert.ok(
      !name.startsWith("electron"),
      `Legacy Electron dependency: ${name}`,
    );
  }
}

for (const [platform, targets] of [
  ["windows", ["nsis"]],
  ["macos", ["app", "dmg"]],
  ["linux", ["appimage", "deb"]],
]) {
  const platformConfig = JSON.parse(
    await fs.readFile(
      new URL(`../src-tauri/tauri.${platform}.conf.json`, import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(platformConfig.bundle.targets, targets);
  if (platform === "windows") {
    assert.equal(
      platformConfig.bundle.windows.nsis.installerHooks,
      "installer-hooks.nsh",
    );
  }
}

const installerHooks = await fs.readFile(
  new URL("../src-tauri/installer-hooks.nsh", import.meta.url),
  "utf8",
);
assert.match(installerHooks, /0f7e2335-0fae-5554-8f8f-93ac69b9f97d/);
assert.match(installerHooks, /\/KEEP_APP_DATA --updated/);
assert.match(
  installerHooks,
  /Push \$R0\s+Push \$R1\s+Push \$R2\s+Push \$R3\s+!insertmacro CheckIfAppIsRunning "CATS Configurator\.exe" "CATS Configurator"\s+Pop \$R3\s+Pop \$R2\s+Pop \$R1\s+Pop \$R0/,
);

const workflow = await fs.readFile(
  new URL("../.github/workflows/build.yml", import.meta.url),
  "utf8",
);
const appImagePatch = await fs.readFile(
  new URL("../scripts/patch-appimage-wayland.sh", import.meta.url),
  "utf8",
);
assert.doesNotMatch(workflow, /dmgbuild/);
assert.doesNotMatch(workflow, /Build custom Mac installer/);
assert.match(workflow, /test -L "\$mount\/Applications"/);
assert.match(workflow, /bash scripts\/patch-appimage-wayland\.sh/);
assert.match(workflow, /find "\$inspect\/squashfs-root\/usr\/lib"/);
assert.match(appImagePatch, /libwayland-\*\.so\*/);
assert.match(appImagePatch, /mksquashfs[\s\S]*-comp zstd/);
assert.match(appImagePatch, /mksquashfs[\s\S]*-b 128K/);
for (const filename of [
  "cats-configurator-Setup-$version.exe",
  "cats-configurator-$version.AppImage",
  "cats-configurator-$version-arm64.dmg",
  "cats-configurator-$version-x64.dmg",
]) {
  assert.ok(
    workflow.includes(filename),
    `Missing release filename: ${filename}`,
  );
}

const host = await fs.readFile(
  new URL("../src/host.js", import.meta.url),
  "utf8",
);
const backend = await fs.readFile(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const commands = [...host.matchAll(/(?:call|invoke)\("([a-z_]+)"/g)].map(
  (match) => match[1],
);
const handlers =
  backend.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "";
for (const command of commands) {
  assert.match(
    handlers,
    new RegExp(`\\b${command}\\b`),
    `Unregistered host command: ${command}`,
  );
}

console.log(
  "Root Tauri identity, lockfile, native targets, upgrade bridge, and host commands verified.",
);
