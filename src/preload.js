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
    exportCsv: (flightLog) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_EXPORT_CSV, flightLog),
    exportHtml: (flightLog, useImperialUnits) =>
      ipcRenderer.invoke(IPC_CHANNELS.FLIGHT_LOG_EXPORT_HTML, {
        flightLog,
        useImperialUnits,
      }),
  },
};

contextBridge.exposeInMainWorld("cats", cats);
