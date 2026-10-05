import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import packageJson from "../package.json" with { type: "json" };

export async function createUpdaterManifest(directory, tag) {
  const version = packageJson.version;
  assert.equal(
    tag.replace(/^v(?=\d)/i, ""),
    version,
    "Release tag must match the package version.",
  );
  const files = {
    "windows-x86_64": `cats-configurator-Setup-${version}.exe`,
    "linux-x86_64": `cats-configurator-${version}.AppImage`,
    "darwin-aarch64": `cats-configurator-${version}-arm64.app.tar.gz`,
    "darwin-x86_64": `cats-configurator-${version}-x64.app.tar.gz`,
  };
  const platforms = {};
  for (const [platform, filename] of Object.entries(files)) {
    assert.ok(
      (await fs.stat(path.join(directory, filename))).size > 0,
      `Empty updater package: ${filename}`,
    );
    const signature = (
      await fs.readFile(path.join(directory, `${filename}.sig`), "utf8")
    ).trim();
    assert.ok(signature, `Missing updater signature: ${filename}`);
    platforms[platform] = {
      url: `https://github.com/catsystems/cats-configurator/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`,
      signature,
    };
  }
  const manifest = { version, pub_date: new Date().toISOString(), platforms };
  await fs.writeFile(
    path.join(directory, "latest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (import.meta.main) {
  const [directory, tag] = process.argv.slice(2);
  assert.ok(
    directory && tag,
    "Usage: node scripts/create-updater-manifest.mjs <directory> <tag>",
  );
  await createUpdaterManifest(directory, tag);
  console.log("Signed update manifest generated for all four platforms.");
}
