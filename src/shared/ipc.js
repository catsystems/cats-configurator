export const IPC_CHANNELS = Object.freeze({
  APP_ALERT: "app:alert",
  APP_OPEN_EXTERNAL: "app:open-external",
  UPDATES_CURRENT: "updates:current",
  UPDATES_CHECK: "updates:check",
  UPDATES_REVEAL: "updates:reveal",
  UPDATES_OPEN_RELEASE: "updates:open-release",
  UPDATES_STATE: "updates:state",
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
  BOARD_GET_CONFIGS: "board:get-configs",
  BOARD_GET_CONFIG: "board:get-config",
  BOARD_SET_CONFIG: "board:set-config",
  BOARD_APPLY_CONFIG: "board:apply-config",
  BOARD_GET_EVENTS: "board:get-events",
  BOARD_GET_TIMERS: "board:get-timers",
  BOARD_GET_INFO: "board:get-info",
  BOARD_GET_LOG_INFO: "board:get-log-info",
  BOARD_RESET: "board:reset",
  BOARD_SAVE: "board:save",
  PROFILE_CURRENT: "profile:current",
  PROFILE_EXPORT: "profile:export",
  PROFILE_OPEN: "profile:open",
  PROFILE_APPLY: "profile:apply",
  PREFLIGHT_RUN: "preflight:run",
  FLIGHT_LOG_LOAD: "flight-log:load",
  FLIGHT_LOG_CURRENT: "flight-log:current",
  FLIGHT_LOG_EXPORT_CSV: "flight-log:export-csv",
  FLIGHT_LOG_EXPORT_HTML: "flight-log:export-html",
  FLIGHT_LOG_DISCOVER_ONBOARD: "flight-log:discover-onboard",
  FLIGHT_LOG_CHOOSE_ONBOARD: "flight-log:choose-onboard",
  FLIGHT_LOG_REFRESH_ONBOARD: "flight-log:refresh-onboard",
  FLIGHT_LOG_CLEAR_ONBOARD: "flight-log:clear-onboard",
  FLIGHT_LOG_OPEN_ONBOARD: "flight-log:open-onboard",
  FLIGHT_LOG_REMOVE_ONBOARD: "flight-log:remove-onboard",
  FLIGHT_LOG_SAVE_ORIGINAL: "flight-log:save-original",
  FLIGHT_LOG_OPEN_IN_FLIGHTS: "flight-log:open-in-flights",
  FLIGHT_LOG_CANCEL_HANDOFF: "flight-log:cancel-handoff",
  FLIGHT_LOG_ONBOARD_CHANGED: "flight-log:onboard-changed",
  FLIGHT_LOG_HANDOFF_STATE: "flight-log:handoff-state",
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
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("Board number must be finite.");
  }
  if (typeof value === "string") {
    if (!value.length || value.length > 512 || /[\r\n#]/.test(value)) {
      throw new TypeError(
        "Board value must be a non-empty single line without # characters.",
      );
    }
  }
  return value;
}

export function assertBoardEntries(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw new TypeError("Board transaction must contain 1 to 128 values.");
  }
  return value.map((entry) => {
    assertRecord(entry, "Board transaction value");
    return {
      key: assertBoardKey(entry.key),
      value: assertBoardValue(entry.value),
    };
  });
}

export function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

export function assertOpaqueId(value, label = "Identifier") {
  assertNonEmptyString(value, label, 64);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new TypeError(`${label} is invalid.`);
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
