import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC_CHANNELS } from "./shared/ipc.js";

function subscribe(channel, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("IPC subscription callback must be a function.");
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/**
 * @typedef {object} OnboardLogSummary
 * @property {string} id Opaque identifier scoped to the selected CATS drive.
 * @property {string} name Safe base filename ending in `.cfl`.
 * @property {number} size Original byte length.
 * @property {number|null} logNumber Numeric firmware log number when present.
 */

/**
 * @typedef {object} FlightLogSessionSummary
 * @property {string} id Opaque identifier for the active log.
 * @property {"local"|"onboard"} source How the log entered Configurator.
 * @property {string} name Original base filename.
 * @property {number} size Original byte length.
 * @property {object} flightLog Parsed flight-log data.
 */

/**
 * @typedef {object} HandoffState
 * @property {string} id Opaque browser-handoff identifier.
 * @property {"waiting"|"transferring"|"complete"|"expired"|"cancelled"|"failed"} status
 * @property {string} message Human-readable progress or failure message.
 */

/**
 * Narrow renderer API. No Electron primitives or arbitrary channel access are
 * exposed to application code.
 */
const cats = {
  app: {
    openExternal: (url) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_OPEN_EXTERNAL, url),
    onAlert: (callback) => subscribe(IPC_CHANNELS.APP_ALERT, callback),
  },
  serial: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_LIST),
    connect: (portPath) =>
      ipcRenderer.invoke(IPC_CHANNELS.SERIAL_CONNECT, portPath),
    disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_DISCONNECT),
    send: (command) => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_SEND, command),
    onConnected: (callback) =>
      subscribe(IPC_CHANNELS.SERIAL_CONNECTED, callback),
    onDisconnected: (callback) =>
      subscribe(IPC_CHANNELS.SERIAL_DISCONNECTED, callback),
    onError: (callback) => subscribe(IPC_CHANNELS.SERIAL_ERROR, callback),
    onData: (callback) => subscribe(IPC_CHANNELS.SERIAL_DATA, callback),
  },
  board: {
    getConfig: (key) => ipcRenderer.invoke(IPC_CHANNELS.BOARD_GET_CONFIG, key),
    setConfig: (key, value) =>
      ipcRenderer.invoke(IPC_CHANNELS.BOARD_SET_CONFIG, { key, value }),
    getEvents: (key) => ipcRenderer.invoke(IPC_CHANNELS.BOARD_GET_EVENTS, key),
    getTimers: (key) => ipcRenderer.invoke(IPC_CHANNELS.BOARD_GET_TIMERS, key),
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.BOARD_GET_INFO),
    getLogInfo: () => ipcRenderer.invoke(IPC_CHANNELS.BOARD_GET_LOG_INFO),
    dump: () => ipcRenderer.invoke(IPC_CHANNELS.BOARD_DUMP),
    restore: () => ipcRenderer.invoke(IPC_CHANNELS.BOARD_RESTORE),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.BOARD_RESET),
    save: () => ipcRenderer.invoke(IPC_CHANNELS.BOARD_SAVE),
    onActive: (callback) => subscribe(IPC_CHANNELS.BOARD_ACTIVE, callback),
    onStaticData: (callback) =>
      subscribe(IPC_CHANNELS.BOARD_STATIC_DATA, callback),
    onConfig: (callback) => subscribe(IPC_CHANNELS.BOARD_CONFIG_DATA, callback),
    onConfigSaved: (callback) =>
      subscribe(IPC_CHANNELS.BOARD_CONFIG_SAVED, callback),
    onDumpComplete: (callback) =>
      subscribe(IPC_CHANNELS.BOARD_DUMP_COMPLETE, callback),
  },
  flightLog: {
    pathForDroppedFile: (file) => webUtils.getPathForFile(file),
    load: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_LOAD, filePath),
    current: () => ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_CURRENT),
    exportCsv: (sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_EXPORT_CSV, sessionId),
    exportHtml: (sessionId, useImperialUnits) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_EXPORT_HTML, {
        sessionId,
        useImperialUnits,
      }),
    discoverOnboard: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_DISCOVER_ONBOARD),
    chooseOnboardDrive: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_CHOOSE_ONBOARD),
    refreshOnboard: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_REFRESH_ONBOARD),
    clearOnboard: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_CLEAR_ONBOARD),
    openOnboard: (logId) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_OPEN_ONBOARD, logId),
    saveOriginal: (sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_SAVE_ORIGINAL, sessionId),
    openInFlights: (sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_OPEN_IN_FLIGHTS, sessionId),
    cancelFlightsHandoff: () =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_CANCEL_HANDOFF),
    onOnboardChanged: (callback) =>
      subscribe(IPC_CHANNELS.FLIGHT_LOG_ONBOARD_CHANGED, callback),
    onHandoffState: (callback) =>
      subscribe(IPC_CHANNELS.FLIGHT_LOG_HANDOFF_STATE, callback),
  },
};

contextBridge.exposeInMainWorld("cats", cats);
