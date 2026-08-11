import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";

export const UPDATE_API_URL =
  "https://api.github.com/repos/catsystems/cats-configurator/releases/latest";
export const UPDATE_RELEASE_BASE_URL =
  "https://github.com/catsystems/cats-configurator/releases";
export const UPDATE_INITIAL_DELAY_MS = 30_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_REQUEST_TIMEOUT_MS = 15_000;
export const UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;
export const MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024;
export const MAX_UPDATE_BYTES = 512 * 1024 * 1024;

const UPDATE_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

function updateError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function networkFailure(_error, signal, message) {
  if (signal.aborted && signal.reason instanceof Error) return signal.reason;
  return updateError(message, "NETWORK_ERROR");
}

function normalizeStableVersion(tagName) {
  if (typeof tagName !== "string") return null;
  if (tagName !== tagName.trim()) return null;
  const candidate = tagName.replace(/^v(?=\d)/i, "");
  const version = semver.valid(candidate);
  if (!version || semver.prerelease(version)) return null;
  return version;
}

export function expectedUpdateAssetName(platform, arch, version) {
  if (platform === "win32" && arch === "x64") {
    // GitHub normalizes spaces in uploaded asset filenames, so keep this URL-safe.
    return `cats-configurator-Setup-${version}.exe`;
  }
  if (platform === "darwin" && ["x64", "arm64"].includes(arch)) {
    return `cats-configurator-${version}-${arch}.dmg`;
  }
  if (platform === "linux" && arch === "x64") {
    return `cats-configurator-${version}.AppImage`;
  }
  return null;
}

function parseReleaseDownloadUrl(rawUrl, tagName, assetName) {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.origin !== "https://github.com" ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (
      segments.length !== 6 ||
      segments[0] !== "catsystems" ||
      segments[1] !== "cats-configurator" ||
      segments[2] !== "releases" ||
      segments[3] !== "download"
    ) {
      return null;
    }
    if (
      decodeURIComponent(segments[4]) !== tagName ||
      decodeURIComponent(segments[5]) !== assetName
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function validateLatestRelease(
  payload,
  { currentVersion, platform, arch },
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw updateError(
      "GitHub returned an invalid release response.",
      "INVALID_RELEASE",
    );
  }
  if (payload.draft || payload.prerelease) {
    throw updateError(
      "GitHub returned a non-stable release.",
      "INVALID_RELEASE",
    );
  }

  const version = normalizeStableVersion(payload.tag_name);
  if (!version) {
    throw updateError(
      "The latest release has an invalid version.",
      "INVALID_VERSION",
    );
  }
  if (!semver.gt(version, currentVersion)) {
    return { kind: "up-to-date", version };
  }

  const releaseUrl = `${UPDATE_RELEASE_BASE_URL}/tag/${encodeURIComponent(
    payload.tag_name,
  )}`;
  const assetName = expectedUpdateAssetName(platform, arch, version);
  if (!assetName) {
    return {
      kind: "unsupported",
      version,
      tagName: payload.tag_name,
      releaseUrl,
      reason: "No automatic download is available for this platform.",
    };
  }

  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const asset = assets.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      candidate.name === assetName &&
      candidate.state === "uploaded",
  );
  if (!asset) {
    return {
      kind: "unsupported",
      version,
      tagName: payload.tag_name,
      releaseUrl,
      reason: `The ${assetName} release asset is unavailable.`,
    };
  }

  const digestMatch = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "");
  const downloadUrl = parseReleaseDownloadUrl(
    asset.browser_download_url,
    payload.tag_name,
    assetName,
  );
  if (
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > MAX_UPDATE_BYTES ||
    !digestMatch ||
    !downloadUrl
  ) {
    return {
      kind: "unsupported",
      version,
      tagName: payload.tag_name,
      releaseUrl,
      reason: "The release asset could not be verified safely.",
    };
  }

  return {
    kind: "available",
    version,
    tagName: payload.tag_name,
    releaseUrl,
    asset: {
      name: assetName,
      size: asset.size,
      sha256: digestMatch[1].toLowerCase(),
      downloadUrl,
    },
  };
}

export function isAllowedUpdateResponseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      UPDATE_DOWNLOAD_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

async function readLimitedBody(response, maximumBytes) {
  if (!response.body) {
    throw updateError("The update response was empty.", "EMPTY_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw updateError(
        "The update response was too large.",
        "RESPONSE_TOO_LARGE",
      );
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function sha256File(filePath) {
  const file = await fs.open(filePath, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }
  } finally {
    await file.close();
  }
  return hash.digest("hex");
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export class UpdateManager {
  constructor({
    currentVersion,
    cacheRoot,
    platform = process.platform,
    arch = process.arch,
    fetch,
    revealFile,
    openExternal,
    enabled = true,
    initialDelayMs = UPDATE_INITIAL_DELAY_MS,
    checkIntervalMs = UPDATE_CHECK_INTERVAL_MS,
    requestTimeoutMs = UPDATE_REQUEST_TIMEOUT_MS,
    downloadIdleTimeoutMs = UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS,
    onState = () => {},
  }) {
    this.currentVersion = currentVersion;
    this.cacheRoot = path.resolve(cacheRoot);
    this.platform = platform;
    this.arch = arch;
    this.fetch = fetch;
    this.revealFile = revealFile;
    this.openExternal = openExternal;
    this.enabled = enabled;
    this.initialDelayMs = initialDelayMs;
    this.checkIntervalMs = checkIntervalMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.downloadIdleTimeoutMs = downloadIdleTimeoutMs;
    this.onState = onState;
    this.checkPromise = null;
    this.abortController = null;
    this.initialTimer = null;
    this.intervalTimer = null;
    this.readyFile = null;
    this.readyAsset = null;
    this.releaseUrl = null;
    this.stopped = false;
    this.state = {
      status: "idle",
      currentVersion,
      availableVersion: null,
      assetName: null,
      progress: null,
      message: null,
      manual: false,
    };
  }

  current() {
    return { ...this.state };
  }

  setState(status, values = {}) {
    this.state = {
      ...this.state,
      status,
      ...values,
    };
    this.onState(this.current());
    return this.current();
  }

  start() {
    if (!this.enabled || this.initialTimer || this.intervalTimer) return;
    this.stopped = false;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.check({ manual: false });
    }, this.initialDelayMs);
    this.intervalTimer = setInterval(
      () => void this.check({ manual: false }),
      this.checkIntervalMs,
    );
  }

  stop() {
    this.stopped = true;
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
    this.abortController?.abort();
  }

  async check({ manual = true } = {}) {
    if (this.checkPromise) return this.checkPromise;
    if (!this.enabled) {
      return this.setState("error", {
        manual,
        message: "Update checks are available in packaged builds.",
      });
    }

    this.checkPromise = this.performCheck(manual).finally(() => {
      this.checkPromise = null;
      this.abortController = null;
    });
    return this.checkPromise;
  }

  async performCheck(manual) {
    this.abortController = new AbortController();
    this.setState("checking", {
      availableVersion: null,
      assetName: null,
      progress: null,
      message: null,
      manual,
    });
    this.releaseUrl = null;

    try {
      const response = await this.fetchRelease(this.abortController.signal);
      const release = validateLatestRelease(response, {
        currentVersion: this.currentVersion,
        platform: this.platform,
        arch: this.arch,
      });

      if (release.kind === "up-to-date") {
        this.readyFile = null;
        this.readyAsset = null;
        this.releaseUrl = null;
        await this.cleanupCache(null);
        return this.setState("up-to-date", {
          availableVersion: null,
          assetName: null,
          progress: null,
          message: "CATS Configurator is up to date.",
          manual,
        });
      }

      if (release.kind === "unsupported") {
        this.readyFile = null;
        this.readyAsset = null;
        this.releaseUrl = release.releaseUrl;
        await this.cleanupCache(null);
        return this.setState("unsupported", {
          availableVersion: release.version,
          assetName: null,
          progress: null,
          message: release.reason,
          manual,
        });
      }

      this.releaseUrl = release.releaseUrl;
      this.setState("downloading", {
        availableVersion: release.version,
        assetName: release.asset.name,
        progress: 0,
        message: `Downloading CATS Configurator ${release.version}…`,
        manual,
      });
      await this.cleanupCache(release.version, release.asset.name);
      const target = this.cachePath(release.version, release.asset.name);
      if (await this.verifyFile(target, release.asset)) {
        return this.markReady(target, release, manual);
      }

      await this.downloadAsset(release, target, this.abortController.signal);
      return this.markReady(target, release, manual);
    } catch (error) {
      if (this.stopped) return this.current();
      const quietNetworkFailure = ["NETWORK_ERROR", "TIMEOUT"].includes(
        error?.code,
      );
      return this.setState("error", {
        availableVersion: quietNetworkFailure
          ? null
          : this.state.availableVersion,
        assetName: quietNetworkFailure ? null : this.state.assetName,
        progress: null,
        message: error?.message || "The update check failed.",
        manual,
      });
    }
  }

  async fetchRelease(signal) {
    const timeout = setTimeout(
      () =>
        this.abortController?.abort(
          updateError("The update check timed out.", "TIMEOUT"),
        ),
      this.requestTimeoutMs,
    );
    try {
      let response;
      try {
        response = await this.fetch(UPDATE_API_URL, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `CATS-Configurator/${this.currentVersion}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          redirect: "follow",
          signal,
        });
      } catch (error) {
        throw networkFailure(
          error,
          signal,
          "CATS Configurator could not reach GitHub to check for updates.",
        );
      }
      if (!response.ok) {
        throw updateError(
          `GitHub update check failed with status ${response.status}.`,
          "HTTP_ERROR",
        );
      }
      if (response.url && response.url !== UPDATE_API_URL) {
        throw updateError(
          "GitHub redirected the release request unexpectedly.",
          "INVALID_URL",
        );
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_RELEASE_RESPONSE_BYTES
      ) {
        throw updateError(
          "The GitHub release response was too large.",
          "RESPONSE_TOO_LARGE",
        );
      }
      const body = await readLimitedBody(response, MAX_RELEASE_RESPONSE_BYTES);
      try {
        return JSON.parse(new TextDecoder().decode(body));
      } catch {
        throw updateError(
          "GitHub returned malformed release data.",
          "INVALID_RELEASE",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  cachePath(version, assetName) {
    const directory = path.resolve(this.cacheRoot, version);
    const target = path.resolve(directory, assetName);
    if (
      !isContainedPath(this.cacheRoot, directory) ||
      !isContainedPath(directory, target)
    ) {
      throw updateError("The update cache path is invalid.", "INVALID_PATH");
    }
    return target;
  }

  async ensureCacheRoot() {
    try {
      const stat = await fs.lstat(this.cacheRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw updateError(
          "The update cache directory is invalid.",
          "INVALID_PATH",
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await fs.mkdir(this.cacheRoot, { recursive: true });
      const stat = await fs.lstat(this.cacheRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw updateError(
          "The update cache directory is invalid.",
          "INVALID_PATH",
        );
      }
    }
  }

  async cleanupCache(keepVersion, keepAssetName = null) {
    await this.ensureCacheRoot();
    const entries = await fs.readdir(this.cacheRoot, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.resolve(this.cacheRoot, entry.name);
      if (!isContainedPath(this.cacheRoot, candidate)) continue;
      if (
        entry.name === keepVersion &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
      ) {
        const children = await fs.readdir(candidate, { withFileTypes: true });
        for (const child of children) {
          if (
            child.name === keepAssetName &&
            child.isFile() &&
            !child.isSymbolicLink()
          ) {
            continue;
          }
          const childPath = path.resolve(candidate, child.name);
          if (isContainedPath(candidate, childPath)) {
            await fs.rm(childPath, { recursive: true, force: true });
          }
        }
        continue;
      }
      await fs.rm(candidate, { recursive: true, force: true });
    }
  }

  async verifyFile(filePath, asset) {
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.size) {
        await fs.rm(filePath, { force: true });
        return false;
      }
      if ((await sha256File(filePath)) !== asset.sha256) {
        await fs.rm(filePath, { force: true });
        return false;
      }
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async downloadAsset(release, target, signal) {
    const asset = release.asset;
    const directory = path.dirname(target);
    const temporary = `${target}.part`;
    await fs.mkdir(directory, { recursive: true });
    await fs.rm(temporary, { force: true });

    const response = await this.fetchAssetResponse(asset.downloadUrl, signal);
    if (!response.ok || !response.body) {
      throw updateError(
        `The update download failed with status ${response.status}.`,
        "NETWORK_ERROR",
      );
    }
    if (!isAllowedUpdateResponseUrl(response.url || asset.downloadUrl)) {
      throw updateError(
        "The update download was redirected to an unsafe host.",
        "INVALID_URL",
      );
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength !== asset.size
      ) {
        throw updateError(
          "The update download size did not match the release.",
          "SIZE_MISMATCH",
        );
      }
    }

    const reader = response.body.getReader();
    const output = await fs.open(temporary, "wx");
    const hash = createHash("sha256");
    let transferred = 0;
    let lastPercent = -1;
    let idleTimer;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () =>
          this.abortController?.abort(
            updateError("The update download stalled.", "TIMEOUT"),
          ),
        this.downloadIdleTimeoutMs,
      );
    };

    try {
      resetIdleTimer();
      while (true) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw networkFailure(
            error,
            signal,
            "The update download was interrupted by a network error.",
          );
        }
        const { done, value } = chunk;
        if (done) break;
        resetIdleTimer();
        transferred += value.byteLength;
        if (transferred > asset.size || transferred > MAX_UPDATE_BYTES) {
          throw updateError(
            "The update download exceeded its expected size.",
            "SIZE_MISMATCH",
          );
        }
        hash.update(value);
        await output.write(value);
        const percent = Math.floor((transferred / asset.size) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          this.setState("downloading", {
            progress: percent,
            message: `Downloading CATS Configurator ${release.version}…`,
          });
        }
      }
      if (transferred !== asset.size) {
        throw updateError(
          "The update download was incomplete.",
          "SIZE_MISMATCH",
        );
      }
      if (hash.digest("hex") !== asset.sha256) {
        throw updateError(
          "The update download failed SHA-256 verification.",
          "DIGEST_MISMATCH",
        );
      }
      await output.sync();
      await output.close();
      await fs.rm(target, { force: true });
      await fs.rename(temporary, target);
      if (this.platform === "linux") await fs.chmod(target, 0o755);
    } catch (error) {
      await output.close().catch(() => {});
      await reader.cancel().catch(() => {});
      await fs.rm(temporary, { force: true });
      await fs.rm(target, { force: true });
      throw error;
    } finally {
      clearTimeout(idleTimer);
    }
  }

  async fetchAssetResponse(downloadUrl, signal) {
    let currentUrl = downloadUrl;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      let headerTimer;
      try {
        headerTimer = setTimeout(
          () =>
            this.abortController?.abort(
              updateError("The update download stalled.", "TIMEOUT"),
            ),
          this.downloadIdleTimeoutMs,
        );
        let response;
        try {
          response = await this.fetch(currentUrl, {
            headers: {
              "User-Agent": `CATS-Configurator/${this.currentVersion}`,
            },
            redirect: "manual",
            signal,
          });
        } catch (error) {
          throw networkFailure(
            error,
            signal,
            "The update download could not reach GitHub.",
          );
        }
        const responseUrl = response.url || currentUrl;
        if (!isAllowedUpdateResponseUrl(responseUrl)) {
          throw updateError(
            "The update download was redirected to an unsafe host.",
            "INVALID_URL",
          );
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          let nextUrl;
          try {
            if (!location) throw new Error("Missing redirect location.");
            nextUrl = new URL(location, responseUrl).href;
          } catch {
            throw updateError(
              "The update download returned an invalid redirect.",
              "INVALID_URL",
            );
          }
          if (!isAllowedUpdateResponseUrl(nextUrl)) {
            throw updateError(
              "The update download was redirected to an unsafe host.",
              "INVALID_URL",
            );
          }
          currentUrl = nextUrl;
          continue;
        }
        return response;
      } finally {
        clearTimeout(headerTimer);
      }
    }
    throw updateError(
      "The update download was redirected too many times.",
      "INVALID_URL",
    );
  }

  markReady(target, release, manual) {
    this.readyFile = target;
    this.readyAsset = release.asset;
    return this.setState("ready", {
      availableVersion: release.version,
      assetName: release.asset.name,
      progress: 100,
      message: `CATS Configurator ${release.version} is ready to install.`,
      manual,
    });
  }

  async reveal() {
    if (
      this.state.status !== "ready" ||
      !this.readyFile ||
      !this.readyAsset ||
      !(await this.verifyFile(this.readyFile, this.readyAsset))
    ) {
      this.readyFile = null;
      this.readyAsset = null;
      throw updateError(
        "The verified update file is no longer available.",
        "MISSING_UPDATE",
      );
    }
    this.revealFile(this.readyFile);
    return true;
  }

  async openRelease() {
    if (!this.releaseUrl) {
      throw updateError("No newer release is available.", "NO_RELEASE");
    }
    await this.openExternal(this.releaseUrl);
    return true;
  }
}
