import { contextBridge, ipcRenderer, webUtils } from "electron";

const CHANNELS = [
  "FETCH_SERIAL_PORTS",
  "CONNECT",
  "DISCONNECT",
  "CONNECTED",
  "DISCONNECTED",
  "CONNECTION_ERROR",
  "ALERT",
  "SET_ACTIVE",
  "SET_CONFIG",
  "SET_CONFIG_RESPONSE",
  "BOARD:STATIC_DATA",
  "BOARD:CONFIG",
  "BOARD:SET_CONFIG",
  "BOARD:EVENTS",
  "BOARD:TIMERS",
  "BOARD:INFO",
  "BOARD:DUMP",
  "BOARD:RESTORE",
  "BOARD:RESET_CONFIG",
  "BOARD:LOG_INFO",
  "BOARD:SAVE",
  "CLI_COMMAND",
  "LOAD_FLIGHTLOG",
  "EXPORT_FLIGHTLOG_CSVS",
  "EXPORT_FLIGHTLOG_HTML",
];

// Expose ipcRenderer to the client
contextBridge.exposeInMainWorld("renderer", {
  send: (channel, data) => {
    let validChannels = CHANNELS;
    if (validChannels.includes(channel)) {
      // console.log(channel +"  " + data);
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    let validChannels = CHANNELS;
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
});

// Expose webUtils to the client
contextBridge.exposeInMainWorld("webUtils", {
  getPathForFile: webUtils.getPathForFile,
});
