import { dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertBoardKey,
  assertBoardEntries,
  assertBoardValue,
  assertNonEmptyString,
  assertOpaqueId,
  assertRecord,
  assertTrustedSender,
  IPC_CHANNELS,
} from "../shared/ipc.js";
import {
  exportFlightLogChartsToHTML,
  exportFlightLogToCSVs,
} from "./flightlog.js";
import {
  applyConfiguration,
  cliCommand,
  command,
  connect,
  disconnect,
  getList,
  restoreBoardConfiguration,
} from "./serial.js";
import { FlightLogManager } from "./flight-log-manager.js";
import { startFlightLogHandoff } from "./flight-log-handoff.js";
import {
  checkForUpdates,
  currentUpdateState,
  openUpdateRelease,
  revealDownloadedUpdate,
} from "./updates.js";

let trustedWindow;
let registered = false;
let openExternalUrl;
let activeHandoff;
const flightLogManager = new FlightLogManager();

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

function sendFlightLogEvent(channel, payload) {
  if (trustedWindow && !trustedWindow.isDestroyed()) {
    trustedWindow.webContents.send(channel, payload);
  }
}

function cancelActiveHandoff() {
  activeHandoff?.cancel();
  activeHandoff = undefined;
}

async function loadFlightLog(filePath) {
  assertNonEmptyString(filePath, "Flight-log path");
  cancelActiveHandoff();
  return flightLogManager.loadPath(filePath, "local");
}

async function chooseOnboardDrive() {
  const selection = await dialog.showOpenDialog(trustedWindow, {
    title: "Choose the mounted CATS drive",
    properties: ["openDirectory"],
  });
  if (selection.canceled || selection.filePaths.length === 0) {
    return { status: "cancelled", logs: [] };
  }
  const result = await flightLogManager.selectVolume(selection.filePaths[0]);
  sendFlightLogEvent(IPC_CHANNELS.FLIGHT_LOG_ONBOARD_CHANGED, result);
  return result;
}

async function saveOriginalFlightLog(sessionId) {
  const session = flightLogManager.getSession(
    assertOpaqueId(sessionId, "Flight-log session ID"),
  );
  const selection = await dialog.showSaveDialog(trustedWindow, {
    title: "Save flight log",
    defaultPath: session.name,
    filters: [{ name: "CATS flight log", extensions: ["cfl"] }],
  });
  if (selection.canceled || !selection.filePath) return null;
  const destination = await flightLogManager.assertSaveDestination(
    selection.filePath,
  );
  await fs.writeFile(destination, session.bytes);
  return destination;
}

async function openFlightLogInFlights(sessionId) {
  if (!openExternalUrl)
    throw new Error("External browser access is unavailable.");
  const session = flightLogManager.getSession(
    assertOpaqueId(sessionId, "Flight-log session ID"),
  );
  cancelActiveHandoff();
  let reachedTerminalState = false;
  const handoff = await startFlightLogHandoff({
    bytes: session.bytes,
    fileName: session.name,
    openExternal: openExternalUrl,
    onState(state) {
      sendFlightLogEvent(IPC_CHANNELS.FLIGHT_LOG_HANDOFF_STATE, state);
      if (
        ["cancelled", "complete", "expired", "failed"].includes(state.status)
      ) {
        reachedTerminalState = true;
        if (activeHandoff?.id === state.id) activeHandoff = undefined;
      }
    },
  });
  activeHandoff = handoff;
  if (reachedTerminalState) activeHandoff = undefined;
  return { id: handoff.id, status: "waiting" };
}

export function subscribeListeners(openExternal) {
  if (registered) return;
  registered = true;
  openExternalUrl = openExternal;

  handle(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (url) => {
    assertNonEmptyString(url, "External URL", 2048);
    await openExternal(url);
    return true;
  });

  handle(IPC_CHANNELS.UPDATES_CURRENT, currentUpdateState);
  handle(IPC_CHANNELS.UPDATES_CHECK, checkForUpdates);
  handle(IPC_CHANNELS.UPDATES_REVEAL, revealDownloadedUpdate);
  handle(IPC_CHANNELS.UPDATES_OPEN_RELEASE, openUpdateRelease);

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
  handle(IPC_CHANNELS.SERIAL_SEND, async (value) => {
    assertNonEmptyString(value, "CLI command", 1024);
    if (/[\r\n]/.test(value))
      throw new Error("CLI command must fit on one line.");
    await cliCommand(value);
    return true;
  });

  handle(IPC_CHANNELS.BOARD_GET_CONFIG, (key) =>
    command(`get ${assertBoardKey(key)}`),
  );
  handle(IPC_CHANNELS.BOARD_SET_CONFIG, async (payload) => {
    assertRecord(payload, "Board configuration update");
    const key = assertBoardKey(payload.key);
    const value = assertBoardValue(payload.value);
    await command(`set ${key} = ${value}`);
    return true;
  });
  handle(IPC_CHANNELS.BOARD_APPLY_CONFIG, (entries) =>
    applyConfiguration(assertBoardEntries(entries)),
  );
  handle(IPC_CHANNELS.BOARD_GET_EVENTS, (key) =>
    command(`get ${assertBoardKey(key)}`),
  );
  handle(IPC_CHANNELS.BOARD_GET_TIMERS, (key) => {
    const timer = assertBoardKey(key);
    return Promise.all([
      command(`get ${timer}_start`),
      command(`get ${timer}_duration`),
      command(`get ${timer}_trigger`),
    ]);
  });
  handle(IPC_CHANNELS.BOARD_GET_INFO, () => command("status", { poll: true }));
  handle(IPC_CHANNELS.BOARD_GET_LOG_INFO, () => command("rec_info"));
  handle(IPC_CHANNELS.BOARD_DUMP, () => command("dump"));
  handle(IPC_CHANNELS.BOARD_RESTORE, () => restoreBoardConfiguration());
  handle(IPC_CHANNELS.BOARD_RESET, () => command("defaults"));
  handle(IPC_CHANNELS.BOARD_SAVE, () => command("save"));

  handle(IPC_CHANNELS.FLIGHT_LOG_LOAD, loadFlightLog);
  handle(IPC_CHANNELS.FLIGHT_LOG_CURRENT, () =>
    flightLogManager.publicSession(),
  );
  handle(IPC_CHANNELS.FLIGHT_LOG_DISCOVER_ONBOARD, async () => {
    const result = await flightLogManager.discoverOnboard();
    sendFlightLogEvent(IPC_CHANNELS.FLIGHT_LOG_ONBOARD_CHANGED, result);
    return result;
  });
  handle(IPC_CHANNELS.FLIGHT_LOG_CHOOSE_ONBOARD, chooseOnboardDrive);
  handle(IPC_CHANNELS.FLIGHT_LOG_REFRESH_ONBOARD, async () => {
    const result = await flightLogManager.refreshOnboard();
    sendFlightLogEvent(IPC_CHANNELS.FLIGHT_LOG_ONBOARD_CHANGED, result);
    return result;
  });
  handle(IPC_CHANNELS.FLIGHT_LOG_CLEAR_ONBOARD, () => {
    const result = flightLogManager.clearOnboard();
    sendFlightLogEvent(IPC_CHANNELS.FLIGHT_LOG_ONBOARD_CHANGED, result);
    return result;
  });
  handle(IPC_CHANNELS.FLIGHT_LOG_OPEN_ONBOARD, async (logId) => {
    cancelActiveHandoff();
    return flightLogManager.openOnboard(
      assertOpaqueId(logId, "Onboard flight-log ID"),
    );
  });
  handle(IPC_CHANNELS.FLIGHT_LOG_SAVE_ORIGINAL, saveOriginalFlightLog);
  handle(IPC_CHANNELS.FLIGHT_LOG_OPEN_IN_FLIGHTS, openFlightLogInFlights);
  handle(IPC_CHANNELS.FLIGHT_LOG_CANCEL_HANDOFF, () => {
    cancelActiveHandoff();
    return true;
  });
  handle(IPC_CHANNELS.FLIGHT_LOG_EXPORT_CSV, async (sessionId) => {
    const session = flightLogManager.getSession(
      assertOpaqueId(sessionId, "Flight-log session ID"),
    );
    return exportFlightLogToCSVs(
      session.flightLog,
      path.parse(session.name).name,
      trustedWindow,
      (destination) => flightLogManager.assertSaveDestination(destination),
    );
  });
  handle(IPC_CHANNELS.FLIGHT_LOG_EXPORT_HTML, async (payload) => {
    assertRecord(payload, "Flight-log HTML export");
    if (typeof payload.useImperialUnits !== "boolean") {
      throw new TypeError("Flight-log unit selection must be a boolean.");
    }
    const session = flightLogManager.getSession(
      assertOpaqueId(payload.sessionId, "Flight-log session ID"),
    );
    return exportFlightLogChartsToHTML(
      session.flightLog,
      payload.useImperialUnits,
      path.parse(session.name).name,
      trustedWindow,
      (destination) => flightLogManager.assertSaveDestination(destination),
    );
  });
}

export function cleanupFlightLogResources() {
  cancelActiveHandoff();
}
