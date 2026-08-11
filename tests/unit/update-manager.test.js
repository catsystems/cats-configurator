import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expectedUpdateAssetName,
  isAllowedUpdateResponseUrl,
  MAX_RELEASE_RESPONSE_BYTES,
  MAX_UPDATE_BYTES,
  UPDATE_API_URL,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_INITIAL_DELAY_MS,
  UpdateManager,
  validateLatestRelease,
} from "@/modules/update-manager.js";

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cats-updates-"));
  temporaryDirectories.push(directory);
  return directory;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assetName(version = "1.4.0") {
  return expectedUpdateAssetName(
    "win32",
    "x64",
    version.replace(/^v(?=\d)/i, ""),
  );
}

function releasePayload({
  version = "1.4.0",
  bytes = Buffer.from("verified installer"),
  asset = {},
  release = {},
} = {}) {
  const name = assetName(version);
  return {
    tag_name: version,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        state: "uploaded",
        size: bytes.byteLength,
        digest: `sha256:${digest(bytes)}`,
        browser_download_url:
          `https://github.com/catsystems/cats-configurator/releases/download/` +
          `${version}/${encodeURIComponent(name)}`,
        ...asset,
      },
    ],
    ...release,
  };
}

function response(body, { url = "", headers = {}, status = 200 } = {}) {
  const result = new Response(body, { status, headers });
  if (url) Object.defineProperty(result, "url", { value: url });
  return result;
}

function jsonResponse(payload, options = {}) {
  const body = JSON.stringify(payload);
  return response(body, {
    url: UPDATE_API_URL,
    headers: { "content-length": String(Buffer.byteLength(body)) },
    ...options,
  });
}

function createFetch(payload, bytes, assetOptions = {}) {
  return vi.fn(async (url) => {
    if (url === UPDATE_API_URL) return jsonResponse(payload);
    return response(bytes, {
      url: payload.assets[0].browser_download_url,
      headers: { "content-length": String(bytes.byteLength) },
      ...assetOptions,
    });
  });
}

async function createManager(options = {}) {
  const cacheRoot = options.cacheRoot ?? (await temporaryDirectory());
  return new UpdateManager({
    currentVersion: "1.3.0",
    cacheRoot,
    platform: "win32",
    arch: "x64",
    fetch: vi.fn(),
    revealFile: vi.fn(),
    openExternal: vi.fn(),
    ...options,
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("update release validation", () => {
  it("locks the supported platform asset names", () => {
    expect(expectedUpdateAssetName("win32", "x64", "1.4.0")).toBe(
      "cats-configurator-Setup-1.4.0.exe",
    );
    expect(expectedUpdateAssetName("darwin", "x64", "1.4.0")).toBe(
      "cats-configurator-1.4.0-x64.dmg",
    );
    expect(expectedUpdateAssetName("darwin", "arm64", "1.4.0")).toBe(
      "cats-configurator-1.4.0-arm64.dmg",
    );
    expect(expectedUpdateAssetName("linux", "x64", "1.4.0")).toBe(
      "cats-configurator-1.4.0.AppImage",
    );
    expect(expectedUpdateAssetName("win32", "arm64", "1.4.0")).toBeNull();
  });

  it("accepts only a newer stable semantic version", () => {
    expect(
      validateLatestRelease(releasePayload(), {
        currentVersion: "1.3.0",
        platform: "win32",
        arch: "x64",
      }),
    ).toMatchObject({ kind: "available", version: "1.4.0" });
    expect(
      validateLatestRelease(releasePayload({ version: "v1.4.0" }), {
        currentVersion: "1.3.0",
        platform: "win32",
        arch: "x64",
      }),
    ).toMatchObject({ kind: "available", version: "1.4.0" });

    for (const version of ["1.3.0", "1.2.9"]) {
      expect(
        validateLatestRelease(releasePayload({ version }), {
          currentVersion: "1.3.0",
          platform: "win32",
          arch: "x64",
        }),
      ).toMatchObject({ kind: "up-to-date" });
    }

    for (const release of [
      releasePayload({ version: "not-a-version" }),
      releasePayload({ version: "1.4.0-beta.1" }),
      releasePayload({ version: " 1.4.0 " }),
      releasePayload({ release: { draft: true } }),
      releasePayload({ release: { prerelease: true } }),
    ]) {
      expect(() =>
        validateLatestRelease(release, {
          currentVersion: "1.3.0",
          platform: "win32",
          arch: "x64",
        }),
      ).toThrow();
    }
  });

  it("falls back to the release page when a verified asset is unavailable", () => {
    const context = {
      currentVersion: "1.3.0",
      platform: "win32",
      arch: "x64",
    };
    for (const payload of [
      releasePayload({ asset: { digest: null } }),
      releasePayload({ asset: { size: MAX_UPDATE_BYTES + 1 } }),
      releasePayload({ asset: { state: "new" } }),
      releasePayload({
        asset: { browser_download_url: "https://example.com" },
      }),
    ]) {
      expect(validateLatestRelease(payload, context)).toMatchObject({
        kind: "unsupported",
        version: "1.4.0",
      });
    }
    expect(
      validateLatestRelease(releasePayload(), {
        ...context,
        arch: "arm64",
      }),
    ).toMatchObject({ kind: "unsupported" });
  });

  it("allows only HTTPS GitHub release response hosts", () => {
    expect(
      isAllowedUpdateResponseUrl(
        "https://release-assets.githubusercontent.com/file?token=one",
      ),
    ).toBe(true);
    expect(
      isAllowedUpdateResponseUrl("https://objects.githubusercontent.com/file"),
    ).toBe(true);
    expect(isAllowedUpdateResponseUrl("http://github.com/file")).toBe(false);
    expect(isAllowedUpdateResponseUrl("https://github.com:444/file")).toBe(
      false,
    );
    expect(isAllowedUpdateResponseUrl("https://github.com.example/file")).toBe(
      false,
    );
  });
});

describe("verified update downloads", () => {
  it("streams, verifies, atomically promotes, reveals, and opens a release", async () => {
    const bytes = Buffer.from("verified installer");
    const payload = releasePayload({ bytes });
    const states = [];
    const revealFile = vi.fn();
    const openExternal = vi.fn();
    const manager = await createManager({
      fetch: createFetch(payload, bytes),
      revealFile,
      openExternal,
      onState: (state) => states.push(state),
    });

    const state = await manager.check({ manual: true });
    expect(state).toMatchObject({
      status: "ready",
      currentVersion: "1.3.0",
      availableVersion: "1.4.0",
      assetName: assetName(),
      progress: 100,
      manual: true,
    });
    expect(JSON.stringify(state)).not.toContain("cats-updates-");
    expect(states.some((item) => item.status === "downloading")).toBe(true);

    await manager.reveal();
    const cachedFile = revealFile.mock.calls[0][0];
    expect(await fs.readFile(cachedFile)).toEqual(bytes);
    await expect(fs.access(`${cachedFile}.part`)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await manager.openRelease();
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/catsystems/cats-configurator/releases/tag/1.4.0",
    );
  });

  it("rejects digest, size, and redirect failures without retaining files", async () => {
    const bytes = Buffer.from("untrusted installer");
    const cases = [
      {
        payload: releasePayload({
          bytes,
          asset: { digest: `sha256:${"0".repeat(64)}` },
        }),
        response: {},
        message: "SHA-256",
      },
      {
        payload: releasePayload({ bytes }),
        response: { headers: { "content-length": "1" } },
        message: "size",
      },
      {
        payload: releasePayload({ bytes }),
        response: { url: "https://updates.example.com/file" },
        message: "unsafe host",
      },
    ];

    for (const item of cases) {
      const cacheRoot = await temporaryDirectory();
      const manager = await createManager({
        cacheRoot,
        fetch: createFetch(item.payload, bytes, item.response),
      });
      const state = await manager.check();
      expect(state).toMatchObject({
        status: "error",
        availableVersion: "1.4.0",
      });
      expect(state.message.toLowerCase()).toContain(item.message.toLowerCase());
      const files = await fs.readdir(cacheRoot, { recursive: true });
      expect(files.filter((name) => /\.part$|\.exe$/.test(name))).toEqual([]);
    }
  });

  it("rejects an unsafe intermediate redirect before following it", async () => {
    const bytes = Buffer.from("redirected installer");
    const payload = releasePayload({ bytes });
    const fetch = vi.fn(async (url) => {
      if (url === UPDATE_API_URL) return jsonResponse(payload);
      return response(null, {
        url: payload.assets[0].browser_download_url,
        status: 302,
        headers: { location: "https://updates.example.com/file.exe" },
      });
    });
    const manager = await createManager({ fetch });

    await expect(manager.check()).resolves.toMatchObject({
      status: "error",
      message: expect.stringContaining("unsafe host"),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects cache paths that could escape their version directory", async () => {
    const manager = await createManager();
    expect(() => manager.cachePath("../outside", "update.exe")).toThrow(
      "cache path is invalid",
    );
    expect(() => manager.cachePath("1.4.0", "../outside.exe")).toThrow(
      "cache path is invalid",
    );
  });

  it("reuses a valid cache, removes stale content, and rejects later tampering", async () => {
    const bytes = Buffer.from("cached installer");
    const payload = releasePayload({ bytes });
    const cacheRoot = await temporaryDirectory();
    const first = await createManager({
      cacheRoot,
      fetch: createFetch(payload, bytes),
    });
    await first.check();

    const staleDirectory = path.join(cacheRoot, "1.2.0");
    const staleSibling = path.join(cacheRoot, "1.4.0", "stale.part");
    await fs.mkdir(staleDirectory, { recursive: true });
    await fs.writeFile(path.join(staleDirectory, "old.exe"), "old");
    await fs.writeFile(staleSibling, "partial");

    const cachedFetch = createFetch(payload, bytes);
    const revealFile = vi.fn();
    const second = await createManager({
      cacheRoot,
      fetch: cachedFetch,
      revealFile,
    });
    await expect(second.check()).resolves.toMatchObject({ status: "ready" });
    expect(cachedFetch).toHaveBeenCalledTimes(1);
    await expect(fs.access(staleDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(staleSibling)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await second.reveal();
    const cachedFile = revealFile.mock.calls[0][0];
    await fs.writeFile(cachedFile, "tampered");
    await expect(second.reveal()).rejects.toThrow("no longer available");
    await expect(fs.access(cachedFile)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects oversized and malformed API responses", async () => {
    for (const responseValue of [
      response("not JSON", { url: UPDATE_API_URL }),
      response("x", {
        url: UPDATE_API_URL,
        headers: { "content-length": String(MAX_RELEASE_RESPONSE_BYTES + 1) },
      }),
    ]) {
      const manager = await createManager({
        fetch: vi.fn(() => responseValue),
      });
      await expect(manager.check()).resolves.toMatchObject({ status: "error" });
    }
  });

  it("deduplicates concurrent checks", async () => {
    const bytes = Buffer.from("one request");
    const payload = releasePayload({ bytes });
    let resolveRelease;
    const fetch = vi.fn((url) => {
      if (url === UPDATE_API_URL) {
        return new Promise((resolve) => {
          resolveRelease = resolve;
        });
      }
      return response(bytes, {
        url: payload.assets[0].browser_download_url,
        headers: { "content-length": String(bytes.byteLength) },
      });
    });
    const manager = await createManager({ fetch });
    const first = manager.check();
    const second = manager.check();
    resolveRelease(jsonResponse(payload));
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("schedules startup and six-hour checks and disposes timers", async () => {
    vi.useFakeTimers();
    const manager = await createManager();
    const check = vi
      .spyOn(manager, "check")
      .mockResolvedValue(manager.current());

    manager.start();
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(UPDATE_INITIAL_DELAY_MS);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(
      UPDATE_CHECK_INTERVAL_MS - UPDATE_INITIAL_DELAY_MS,
    );
    expect(check).toHaveBeenCalledTimes(2);
    manager.stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("cancels an active request without reporting a shutdown error", async () => {
    const states = [];
    const fetch = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const manager = await createManager({
      fetch,
      onState: (state) => states.push(state),
    });
    const check = manager.check({ manual: false });
    manager.stop();
    await check;
    expect(states.map((state) => state.status)).not.toContain("error");
  });

  it("times out while waiting for download response headers", async () => {
    const bytes = Buffer.from("stalled installer");
    const payload = releasePayload({ bytes });
    const fetch = vi.fn((url, { signal }) => {
      if (url === UPDATE_API_URL) return jsonResponse(payload);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    });
    const manager = await createManager({
      fetch,
      downloadIdleTimeoutMs: 10,
    });

    await expect(manager.check()).resolves.toMatchObject({
      status: "error",
      message: "The update download stalled.",
    });
  });

  it("keeps automatic asset-network failures quiet", async () => {
    const bytes = Buffer.from("unreachable installer");
    const payload = releasePayload({ bytes });
    const fetch = vi.fn((url) => {
      if (url === UPDATE_API_URL) return jsonResponse(payload);
      throw new Error("connection reset");
    });
    const manager = await createManager({ fetch });

    await expect(manager.check({ manual: false })).resolves.toMatchObject({
      status: "error",
      availableVersion: null,
      assetName: null,
      manual: false,
      message: "The update download could not reach GitHub.",
    });
  });
});
