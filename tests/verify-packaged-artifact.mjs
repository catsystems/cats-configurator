import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import packageJson from "../package.json" with { type: "json" };

function expectedUpdateAssetName(platform, arch, version) {
  if (platform === "win32" && arch === "x64") {
    return `cats-configurator Setup ${version}.exe`;
  }
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) {
    return `cats-configurator-${version}-${arch}.dmg`;
  }
  if (platform === "linux" && arch === "x64") {
    return `cats-configurator-${version}.AppImage`;
  }
  return null;
}

const [platform, arch] = process.argv.slice(2);
const expectedName = expectedUpdateAssetName(
  platform,
  arch,
  packageJson.version,
);
assert.ok(expectedName, `unsupported release target: ${platform}/${arch}`);

const artifactPath = path.resolve("builds", expectedName);
const stat = await fs.lstat(artifactPath);
assert.ok(stat.isFile(), `${expectedName} is not a regular file`);
assert.ok(stat.size > 0, `${expectedName} is empty`);

console.log(`Verified packaged update asset: ${expectedName}`);
