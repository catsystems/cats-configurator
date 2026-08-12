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
  packageJson.productName,
  "CATS Configurator",
  "product name no longer matches the signing metadata contract",
);
assert.equal(
  packageJson.author,
  "Control and Telemetry Systems GmbH",
  "company name no longer matches the signing metadata contract",
);
assert.equal(
  packageJson.build.copyright,
  "Copyright © 2026 Control and Telemetry Systems GmbH",
  "copyright no longer matches the signing metadata contract",
);
assert.equal(
  packageJson.build.win.executableName,
  "CATS Configurator",
  "Windows executable name no longer matches the signing metadata contract",
);
assert.equal(
  packageJson.build.win.artifactName,
  "${name}-Setup-${version}.${ext}",
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
assert.ok(
  workflow.includes("CODE_SIGNING_POLICY.md"),
  "generated release notes do not link to the code signing policy",
);

console.log("Release artifact naming and architecture contract verified.");
