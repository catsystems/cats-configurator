import { ipcMain, dialog } from "electron";
import fs from "fs";
import { parseFlightLog } from "./logparser.js"
import { exportFlightLogToCSVs, exportFlightLogChartsToHTML } from "./flightlog.js"
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
    command(`get ${key}_trigger`);
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

  ipcMain.on("LOAD_FLIGHTLOG", (event, file) => {

    if (!file.toLowerCase().endsWith(".cfl")) {
      event.sender.send("LOAD_FLIGHTLOG", { error: "File does not end with .cfl" });
      return
    }

    let data = fs.readFileSync(file, { encoding: "binary" });
    if (!data || !data.length) {
      event.sender.send("LOAD_FLIGHTLOG", { error: "File is empty" });
      return
    }

    let flightLog = parseFlightLog(data);
    event.sender.send("LOAD_FLIGHTLOG", flightLog);
  });

  ipcMain.on("EXPORT_FLIGHTLOG_CSVS", (event, flightLog) => {
    exportFlightLogToCSVs(flightLog)
    event.sender.send("EXPORT_FLIGHTLOG_CSVS");
  });

  ipcMain.on("EXPORT_FLIGHTLOG_HTML", (event, flightLogChartsHTML) => {
    exportFlightLogChartsToHTML(flightLogChartsHTML);
    event.sender.send("EXPORT_FLIGHTLOG_HTML");
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
