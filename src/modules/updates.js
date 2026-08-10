import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { IPC_CHANNELS } from "../shared/ipc.js";
import {
  expectedUpdateAssetName,
  UPDATE_API_URL,
  UpdateManager,
} from "./update-manager.js";

let updateManager;
let updateWindow;

function sendState(state) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send(IPC_CHANNELS.UPDATES_STATE, state);
  }
}

export function setUpdateWindow(window) {
  updateWindow = window;
}

export function initializeUpdates(options) {
  updateManager?.stop();
  updateManager = new UpdateManager({ ...options, onState: sendState });
  updateManager.start();
  return updateManager.current();
}

function requireUpdateManager() {
  if (!updateManager) throw new Error("The update service is unavailable.");
  return updateManager;
}

export function currentUpdateState() {
  return requireUpdateManager().current();
}

export function checkForUpdates() {
  return requireUpdateManager().check({ manual: true });
}

export function revealDownloadedUpdate() {
  return requireUpdateManager().reveal();
}

export function openUpdateRelease() {
  return requireUpdateManager().openRelease();
}

export function cleanupUpdates() {
  updateManager?.stop();
}

export async function createE2EUpdateFetch(
  fixturePath,
  { platform, arch, currentVersion },
) {
  const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const version = fixture.version;
  const assetPath = path.resolve(fixture.assetPath);
  const bytes = await fs.readFile(assetPath);
  const assetName = expectedUpdateAssetName(platform, arch, version);
  if (!assetName) throw new Error("The E2E update platform is unsupported.");
  const digest =
    fixture.digest ?? createHash("sha256").update(bytes).digest("hex");
  const downloadUrl = `https://github.com/catsystems/cats-configurator/releases/download/${encodeURIComponent(
    version,
  )}/${encodeURIComponent(assetName)}`;
  const release = {
    tag_name: version,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: assetName,
        state: "uploaded",
        size: bytes.byteLength,
        digest: `sha256:${digest}`,
        browser_download_url: downloadUrl,
      },
    ],
  };

  return async (url) => {
    if (url === UPDATE_API_URL) {
      const body = JSON.stringify(release);
      return new Response(body, {
        status: 200,
        headers: {
          "content-length": String(Buffer.byteLength(body)),
          "content-type": "application/json",
        },
      });
    }
    if (url === downloadUrl) {
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "application/octet-stream",
        },
      });
    }
    throw new Error(
      `Unexpected E2E update request from ${currentVersion}: ${url}`,
    );
  };
}
