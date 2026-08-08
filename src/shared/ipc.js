export const IPC_CHANNELS = Object.freeze({
  APP_ALERT: "app:alert",
  APP_OPEN_EXTERNAL: "app:open-external",
  SERIAL_LIST: "serial:list",
  SERIAL_CONNECT: "serial:connect",
  SERIAL_DISCONNECT: "serial:disconnect",
  SERIAL_SEND: "serial:send",
  SERIAL_CONNECTED: "serial:connected",
  SERIAL_DISCONNECTED: "serial:disconnected",
  SERIAL_ERROR: "serial:error",
  SERIAL_DATA: "serial:data",
  BOARD_ACTIVE: "board:active",
  BOARD_STATIC_DATA: "board:static-data",
  BOARD_CONFIG_DATA: "board:config-data",
  BOARD_CONFIG_SAVED: "board:config-saved",
  BOARD_DUMP_COMPLETE: "board:dump-complete",
  BOARD_GET_CONFIG: "board:get-config",
  BOARD_SET_CONFIG: "board:set-config",
  BOARD_GET_EVENTS: "board:get-events",
  BOARD_GET_TIMERS: "board:get-timers",
  BOARD_GET_INFO: "board:get-info",
  BOARD_GET_LOG_INFO: "board:get-log-info",
  BOARD_DUMP: "board:dump",
  BOARD_RESTORE: "board:restore",
  BOARD_RESET: "board:reset",
  BOARD_SAVE: "board:save",
  FLIGHT_LOG_LOAD: "flight-log:load",
  FLIGHT_LOG_EXPORT_CSV: "flight-log:export-csv",
  FLIGHT_LOG_EXPORT_HTML: "flight-log:export-html",
});

export function assertNonEmptyString(value, label, maxLength = 4096) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

export function assertBoardKey(value) {
  assertNonEmptyString(value, "Board key", 128);
  if (!/^[a-z0-9_]+$/i.test(value)) {
    throw new TypeError("Board key contains unsupported characters.");
  }
  return value;
}

export function assertBoardValue(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw new TypeError("Board value must be a string, number, or boolean.");
  }
  if (typeof value === "string" && /[\r\n]/.test(value)) {
    throw new TypeError("Board value must fit on one line.");
  }
  return value;
}

export function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

export function assertTrustedSender(event, trustedWindow) {
  if (
    !trustedWindow ||
    trustedWindow.isDestroyed() ||
    event.sender !== trustedWindow.webContents ||
    event.senderFrame !== trustedWindow.webContents.mainFrame
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}
