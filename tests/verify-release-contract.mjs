import assert from "node:assert/strict";
import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const workflow = fs.readFileSync(".github/workflows/build.yml", "utf8");

assert.equal(
  packageJson.version,
  packageLock.version,
  "package and lockfile versions must match",
);
assert.equal(
  packageJson.version,
  packageLock.packages[""].version,
  "root lockfile metadata must match the package version",
);
assert.equal(
  packageJson.build.win.artifactName,
  "${name} Setup ${version}.${ext}",
  "Windows release name no longer matches the updater contract",
);
assert.equal(
  packageJson.build.mac.artifactName,
  "${name}-${version}-${arch}.${ext}",
  "macOS release name no longer matches the updater contract",
);
assert.equal(
  packageJson.build.linux.artifactName,
  "${name}-${version}.${ext}",
  "Linux release name no longer matches the updater contract",
);

for (const expected of [
  "--win nsis --x64",
  "--mac dmg --x64",
  "--mac dmg --arm64",
  "--linux AppImage --x64",
]) {
  assert.ok(
    workflow.includes(expected),
    `release workflow is missing ${expected}`,
  );
}

assert.ok(
  workflow.includes("npm run verify:release-tag"),
  "release workflow does not validate the tag against the package version",
);

console.log("Release artifact naming and architecture contract verified.");
