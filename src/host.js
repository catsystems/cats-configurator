import { Channel, invoke } from "@tauri-apps/api/core";

const listeners = new Map();
const events = new Channel();

events.onmessage = ({ channel, payload }) => {
  for (const listener of listeners.get(channel) ?? []) listener(payload);
};

const ready = invoke("initialize_host", { events });

function subscribe(channel, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Host subscription callback must be a function.");
  }
  const channelListeners = listeners.get(channel) ?? new Set();
  channelListeners.add(callback);
  listeners.set(channel, channelListeners);
  return () => {
    channelListeners.delete(callback);
    if (channelListeners.size === 0) listeners.delete(channel);
  };
}

async function call(command, arguments_ = {}) {
  await ready;
  try {
    return await invoke(command, arguments_);
  } catch (failure) {
    const message =
      typeof failure === "string"
        ? failure
        : failure?.message || "The native host request failed.";
    const error = new Error(message);
    if (failure?.code) error.code = failure.code;
    throw error;
  }
}

window.cats = {
  app: {
    openExternal: (url) => call("app_open_external", { url }),
    onAlert: (callback) => subscribe("app:alert", callback),
  },
  serial: {
    list: () => call("serial_list"),
    connect: (portPath) => call("serial_connect", { portPath }),
    disconnect: () => call("serial_disconnect"),
    send: (command) => call("serial_send", { command }),
    onConnected: (callback) => subscribe("serial:connected", callback),
    onDisconnected: (callback) => subscribe("serial:disconnected", callback),
    onError: (callback) => subscribe("serial:error", callback),
    onData: (callback) => subscribe("serial:data", callback),
  },
  board: {
    getConfigs: () => call("board_get_configs"),
    getConfig: (key) => call("board_get_config", { key }),
    setConfig: (key, value) => call("board_set_config", { key, value }),
    applyConfig: (entries) => call("board_apply_config", { entries }),
    getEvents: (key) => call("board_get_events", { key }),
    getTimers: (key) => call("board_get_timers", { key }),
    getInfo: () => call("board_get_info"),
    getLogInfo: () => call("board_get_log_info"),
    reset: () => call("board_reset"),
    save: () => call("board_save"),
    onActive: (callback) => subscribe("board:active", callback),
    onStaticData: (callback) => subscribe("board:static-data", callback),
    onConfig: (callback) => subscribe("board:config-data", callback),
    onConfigSaved: (callback) => subscribe("board:config-saved", callback),
  },
  profiles: {
    current: () => call("profile_current"),
    export: () => call("profile_export"),
    open: () => call("profile_open"),
    apply: (profile) => call("profile_apply", { profile }),
  },
  preflight: {
    run: () => call("preflight_run"),
  },
  flightLog: {
    load: (filePath) => call("flight_log_load", { filePath }),
    chooseLocal: () => call("flight_log_choose_local"),
    current: () => call("flight_log_current"),
    exportCsv: (sessionId) => call("flight_log_export_csv", { sessionId }),
    exportHtml: (sessionId, useImperialUnits) =>
      call("flight_log_export_html", { sessionId, useImperialUnits }),
    discoverOnboard: () => call("flight_log_discover_onboard"),
    chooseOnboardDrive: () => call("flight_log_choose_onboard"),
    refreshOnboard: () => call("flight_log_refresh_onboard"),
    clearOnboard: () => call("flight_log_clear_onboard"),
    openOnboard: (logId) => call("flight_log_open_onboard", { logId }),
    removeOnboard: (logId) => call("flight_log_remove_onboard", { logId }),
    saveOriginal: (sessionId) =>
      call("flight_log_save_original", { sessionId }),
    openInFlights: (sessionId) =>
      call("flight_log_open_in_flights", { sessionId }),
    cancelFlightsHandoff: () => call("flight_log_cancel_handoff"),
    onOnboardChanged: (callback) =>
      subscribe("flight-log:onboard-changed", callback),
    onHandoffState: (callback) =>
      subscribe("flight-log:handoff-state", callback),
  },
};
