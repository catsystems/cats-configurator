import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUpdaterManifest } from "../../scripts/create-updater-manifest.mjs";
import packageJson from "../../package.json";

describe("release update manifest", () => {
  let directory;
  let files;

  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "cats-updater-manifest-"),
    );
    files = [
      `cats-configurator-Setup-${packageJson.version}.exe`,
      `cats-configurator-${packageJson.version}.AppImage`,
      `cats-configurator-${packageJson.version}-arm64.app.tar.gz`,
      `cats-configurator-${packageJson.version}-x64.app.tar.gz`,
    ];
    for (const file of files) {
      await fs.writeFile(path.join(directory, file), "package");
      await fs.writeFile(
        path.join(directory, `${file}.sig`),
        `signature-${file}\n`,
      );
    }
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("includes distinct signed packages for all supported architectures", async () => {
    const manifest = await createUpdaterManifest(
      directory,
      `v${packageJson.version}`,
    );
    expect(manifest.version).toBe(packageJson.version);
    expect(Object.keys(manifest.platforms)).toEqual([
      "windows-x86_64",
      "linux-x86_64",
      "darwin-aarch64",
      "darwin-x86_64",
    ]);
    Object.values(manifest.platforms).forEach((platform, index) => {
      expect(platform.url).toBe(
        `https://github.com/catsystems/cats-configurator/releases/download/v${packageJson.version}/${files[index]}`,
      );
      expect(platform.signature).toBe(`signature-${files[index]}`);
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(directory, "latest.json"), "utf8"),
      ),
    ).toEqual(manifest);
  });

  it("rejects missing signatures, empty packages, and mismatched tags", async () => {
    await fs.writeFile(path.join(directory, `${files[0]}.sig`), "\n");
    await expect(
      createUpdaterManifest(directory, packageJson.version),
    ).rejects.toThrow("Missing updater signature");
    await fs.writeFile(path.join(directory, files[0]), "");
    await expect(
      createUpdaterManifest(directory, packageJson.version),
    ).rejects.toThrow("Empty updater package");
    await expect(createUpdaterManifest(directory, "0.0.1")).rejects.toThrow(
      "Release tag must match",
    );
    expect(
      await fs.access(path.join(directory, "latest.json")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });
});
