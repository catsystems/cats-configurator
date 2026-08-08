import { dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertBoardKey,
  assertBoardValue,
  assertNonEmptyString,
  assertRecord,
  assertTrustedSender,
  IPC_CHANNELS,
} from "../shared/ipc.js";
import { getFilename } from "../utils/file.js";
import {
  exportFlightLogChartsToHTML,
  exportFlightLogToCSVs,
} from "./flightlog.js";
import { parseFlightLog } from "./logparser.js";
import { cliCommand, command, connect, disconnect, getList } from "./serial.js";

let trustedWindow;
let registered = false;
let flightLogFilename = "flight_log";

export function setIpcWindow(window) {
  trustedWindow = window;
}

function trusted(handler) {
  return async (event, payload) => {
    assertTrustedSender(event, trustedWindow);
    return handler(payload);
  };
}

function handle(channel, handler) {
  ipcMain.handle(channel, trusted(handler));
}

async function loadFlightLog(filePath) {
  assertNonEmptyString(filePath, "Flight-log path");
  const resolvedPath = path.resolve(filePath);
  if (path.extname(resolvedPath).toLowerCase() !== ".cfl") {
    throw new Error("File does not end with .cfl");
  }

  const fileStat = await fs.stat(resolvedPath);
  if (!fileStat.isFile()) throw new Error("Flight-log path is not a file.");
  if (fileStat.size === 0) throw new Error("File is empty");

  flightLogFilename = getFilename(resolvedPath.slice(0, -4));
  const data = await fs.readFile(resolvedPath);
  return parseFlightLog(data.toString("binary"));
}

async function restoreBoardConfiguration() {
  const selection = await dialog.showOpenDialog(trustedWindow, {
    properties: ["openFile"],
    filters: [{ name: "CATS configuration", extensions: ["txt"] }],
  });
  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true };
  }

  const data = await fs.readFile(selection.filePaths[0], "utf8");
  for (const line of data.split(/\r?\n/)) {
    const boardCommand = line.trim();
    if (boardCommand) command(boardCommand);
  }
  return { canceled: false };
}

export function subscribeListeners(openExternal) {
  if (registered) return;
  registered = true;

  handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (url) => {
    assertNonEmptyString(url, "External URL", 2048);
    await openExternal(url);
    return true;
  });

  handle(IPC_CHANNELS.SERIAL_LIST, () => getList());
  handle(IPC_CHANNELS.SERIAL_CONNECT, (portPath) => {
    assertNonEmptyString(portPath, "Serial port path", 512);
    connect(portPath);
    return true;
  });
  handle(IPC_CHANNELS.SERIAL_DISCONNECT, () => {
    disconnect();
    return true;
  });
  handle(IPC_CHANNELS.SERIAL_SEND, (value) => {
    assertNonEmptyString(value, "CLI command", 1024);
    if (/[\r\n]/.test(value))
      throw new Error("CLI command must fit on one line.");
    cliCommand(value);
    return true;
  });

  handle(IPC_CHANNELS.BOARD_GET_CONFIG, (key) => {
    command(`get ${assertBoardKey(key)}`);
    return true;
  });
  handle(IPC_CHANNELS.BOARD_SET_CONFIG, (payload) => {
    assertRecord(payload, "Board configuration update");
    const key = assertBoardKey(payload.key);
    const value = assertBoardValue(payload.value);
    command(`set ${key} = ${value}`);
    return true;
  });
  handle(IPC_CHANNELS.BOARD_GET_EVENTS, (key) => {
    command(`get ${assertBoardKey(key)}`);
    return true;
  });
  handle(IPC_CHANNELS.BOARD_GET_TIMERS, (key) => {
    const timer = assertBoardKey(key);
    command(`get ${timer}_start`);
    command(`get ${timer}_duration`);
    command(`get ${timer}_trigger`);
    return true;
  });
  handle(IPC_CHANNELS.BOARD_GET_INFO, () => {
    command("status");
    return true;
  });
  handle(IPC_CHANNELS.BOARD_GET_LOG_INFO, () => {
    command("rec_info");
    return true;
  });
  handle(IPC_CHANNELS.BOARD_DUMP, () => {
    command("dump");
    return true;
  });
  handle(IPC_CHANNELS.BOARD_RESTORE, restoreBoardConfiguration);
  handle(IPC_CHANNELS.BOARD_RESET, () => {
    command("defaults");
    return true;
  });
  handle(IPC_CHANNELS.BOARD_SAVE, () => {
    command("save");
    return true;
  });

  handle(IPC_CHANNELS.FLIGHT_LOG_LOAD, loadFlightLog);
  handle(IPC_CHANNELS.FLIGHT_LOG_EXPORT_CSV, async (flightLog) => {
    assertRecord(flightLog, "Flight log");
    return exportFlightLogToCSVs(flightLog, flightLogFilename, trustedWindow);
  });
  handle(IPC_CHANNELS.FLIGHT_LOG_EXPORT_HTML, async (payload) => {
    assertRecord(payload, "Flight-log HTML export");
    assertRecord(payload.flightLog, "Flight log");
    return exportFlightLogChartsToHTML(
      payload.flightLog,
      Boolean(payload.useImperialUnits),
      flightLogFilename,
      trustedWindow,
    );
  });
}
