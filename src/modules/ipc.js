import { app, dialog, ipcMain } from "electron";
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
  applyConfigurationProfile,
  cliCommand,
  command,
  connect,
  disconnect,
  getList,
  readBoardConfigurations,
  readBoardSnapshot,
  removeBoardFlightLog,
  resetBoardConfiguration,
} from "./serial.js";
import {
  compareConfigurationProfile,
  createConfigurationProfile,
  validateConfigurationProfile,
} from "../shared/configuration-profile.js";
import { buildPreflightReport } from "../shared/preflight.js";
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
const MAX_PROFILE_BYTES = 1024 * 1024;

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

async function exportConfigurationProfile() {
  const date = new Date().toISOString().slice(0, 10);
  const selection = await dialog.showSaveDialog(trustedWindow, {
    title: "Export CATS configuration profile",
    defaultPath: `cats-vega-profile-${date}.json`,
    filters: [{ name: "CATS configuration profile", extensions: ["json"] }],
  });
  if (selection.canceled || !selection.filePath) return { canceled: true };
  const profile = createConfigurationProfile(await readBoardSnapshot(), {
    appVersion: app.getVersion(),
  });
  await fs.writeFile(
    selection.filePath,
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  return { canceled: false, profile };
}

async function currentConfigurationProfile() {
  const snapshot = await readBoardSnapshot();
  const profile = createConfigurationProfile(snapshot, {
    appVersion: app.getVersion(),
  });
  return {
    profile,
    ...compareConfigurationProfile(profile, snapshot),
  };
}

async function openConfigurationProfile() {
  const selection = await dialog.showOpenDialog(trustedWindow, {
    title: "Open CATS configuration profile",
    properties: ["openFile"],
    filters: [{ name: "CATS configuration profile", extensions: ["json"] }],
  });
  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true };
  }
  const filePath = selection.filePaths[0];
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_PROFILE_BYTES) {
    throw new Error("Configuration profile is larger than 1 MB.");
  }
  let profile;
  try {
    profile = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error("Configuration profile is not valid JSON.", {
      cause: error,
    });
  }
  validateConfigurationProfile(profile);
  const comparison = compareConfigurationProfile(
    profile,
    await readBoardSnapshot(),
  );
  return { canceled: false, profile, ...comparison };
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

  handle(IPC_CHANNELS.BOARD_GET_CONFIGS, readBoardConfigurations);
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
  handle(IPC_CHANNELS.BOARD_RESET, resetBoardConfiguration);
  handle(IPC_CHANNELS.BOARD_SAVE, () => command("save"));
  handle(IPC_CHANNELS.PROFILE_CURRENT, currentConfigurationProfile);
  handle(IPC_CHANNELS.PROFILE_EXPORT, exportConfigurationProfile);
  handle(IPC_CHANNELS.PROFILE_OPEN, openConfigurationProfile);
  handle(IPC_CHANNELS.PROFILE_APPLY, (profile) => {
    validateConfigurationProfile(profile);
    return applyConfigurationProfile(profile);
  });
  handle(IPC_CHANNELS.PREFLIGHT_RUN, async () =>
    buildPreflightReport(await readBoardSnapshot()),
  );

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
  handle(IPC_CHANNELS.FLIGHT_LOG_REMOVE_ONBOARD, async (logId) => {
    const id = assertOpaqueId(logId, "Onboard flight-log ID");
    const log = flightLogManager.getOnboardLog(id);
    const removal = await removeBoardFlightLog(log.name);
    const result = flightLogManager.removeOnboard(id);
    sendFlightLogEvent(IPC_CHANNELS.FLIGHT_LOG_ONBOARD_CHANGED, result);
    return { ...result, removal };
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
