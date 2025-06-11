"use strict";

import { app, protocol, BrowserWindow } from "electron";
import { createProtocol } from "vue-cli-plugin-electron-builder/lib";
import installExtension from "electron-devtools-installer";
import { subscribeListeners } from "./modules/ipc.js";
import path from "path";

const isDevelopment = process.env.NODE_ENV !== "production";

let browserWindow;

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { secure: true, standard: true } },
]);

async function createWindow() {
  // Create the browser window.
  browserWindow = new BrowserWindow({
    width: 1700,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
      // nodeIntegration: true,
      // contextIsolation: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (!isDevelopment) {
    browserWindow.removeMenu();
  }

  browserWindow.webContents.on('did-finish-load',() => {
    browserWindow.setTitle("CATS Configurator");
  });

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await browserWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL);
  } else {
    createProtocol("app");
    // Load the index.html when not in development
    browserWindow.loadURL("app://./index.html");
  }
}

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", async () => {
  subscribeListeners();

  if (isDevelopment) {
    // Install Vue Devtools
    try {
      // Provide legacy Vue.js devtools ID
      await installExtension('iaajmlceplecbljialhhkmedjlpdblhp');
    } catch (e) {
      console.error("Vue Devtools failed to install:", e.toString());
    }
  }

  await createWindow();

  if (isDevelopment && browserWindow) {
    browserWindow.webContents.openDevTools();
  }
});

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === "win32") {
    process.on("message", (data) => {
      if (data === "graceful-exit") {
        app.quit();
      }
    });
  } else {
    process.on("SIGTERM", () => {
      app.quit();
    });
  }
}
