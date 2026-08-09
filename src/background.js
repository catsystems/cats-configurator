import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setIpcWindow, subscribeListeners } from "./modules/ipc.js";
import { setSerialWindow } from "./modules/serial.js";
import { isAllowedExternalUrl } from "./modules/external-links.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);
const rendererEntry = path.join(currentDirectory, "../renderer/index.html");
let browserWindow;

if (process.env.CATS_E2E_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.CATS_E2E_USER_DATA));
  app.disableHardwareAcceleration();
}

export async function openAllowedExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) {
    throw new Error("External URL is not allowlisted.");
  }
  await shell.openExternal(rawUrl);
}

function isApplicationUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (isDevelopment) {
      return url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
    }
    return (
      url.protocol === "file:" &&
      path.normalize(fileURLToPath(url)) === path.normalize(rendererEntry)
    );
  } catch {
    return false;
  }
}

function secureWebContents(window) {
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl) => {
      console.error("Renderer failed to load", {
        errorCode,
        errorDescription,
        validatedUrl,
      });
    },
  );
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process exited", details);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void openAllowedExternalUrl(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isApplicationUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void openAllowedExternalUrl(url);
  });

  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}

async function createWindow() {
  browserWindow = new BrowserWindow({
    width: 1700,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    title: "CATS Configurator",
    webPreferences: {
      preload: path.join(currentDirectory, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  setIpcWindow(browserWindow);
  setSerialWindow(browserWindow);
  secureWebContents(browserWindow);

  if (!isDevelopment) browserWindow.removeMenu();

  if (isDevelopment) {
    await browserWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    browserWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await browserWindow.loadFile(rendererEntry);
  }

  browserWindow.on("closed", () => {
    browserWindow = undefined;
    setIpcWindow(undefined);
    setSerialWindow(undefined);
  });
}

app.whenReady().then(async () => {
  subscribeListeners(openAllowedExternalUrl);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
