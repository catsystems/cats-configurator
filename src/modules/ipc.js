import { ipcMain, dialog } from "electron";
import fs from "fs";

import { connect, disconnect, command, cliCommand, getList } from "./serial.js";

export function subscribeListeners() {
  ipcMain.on("BOARD:CONFIG", async (event, key) => {
    command(`get ${key}`);
  });

  ipcMain.on("BOARD:SET_CONFIG", async (event, [key, value]) => {
    if (!key) return;
    command(`set ${key} = ${value}`);
  });

  ipcMain.on("BOARD:EVENTS", async (event, key) => {
    command(`get ${key}`);
  });

  ipcMain.on("BOARD:TIMERS", async (event, key) => {
    command(`get ${key}_start`);
    command(`get ${key}_duration`);
    command(`get ${key}_end`);
  });

  ipcMain.on("BOARD:INFO", () => {
    command("status");
  });

  ipcMain.on("BOARD:LOG_INFO", () => {
    command("rec_info");
  });

  ipcMain.on("BOARD:DUMP", () => {
    command("dump");
  });

  ipcMain.on("BOARD:RESTORE", (event) => {
    let paths = dialog.showOpenDialogSync({ properties: ["openFile"] });

    if (paths) {
      let data = fs.readFileSync(paths[0], { encoding: "utf8" });
      if (data && data.length) {
        data = data.split("\n");
        data.forEach((cmd) => {
          command(cmd);
        });
      }
    }

    event.sender.send("BOARD:RESTORE");
  });

  ipcMain.on("BOARD:RESET_CONFIG", () => {
    command("defaults");
  });

  ipcMain.on("BOARD:SAVE", async () => {
    command("save");
  });

  ipcMain.on("CLI_COMMAND", (event, cmd) => {
    cliCommand(cmd);
  });

  ipcMain.on("CONNECT", (event, path) => {
    connect(path);
  });

  ipcMain.on("DISCONNECT", () => {
    disconnect();
  });

  ipcMain.on("FETCH_SERIAL_PORTS", async (event) => {
    const ports = await getList();
    event.sender.send("FETCH_SERIAL_PORTS", ports);
  });
}
