import { CONFIG_SETTINGS, TELEMETRY_SETTINGS } from "@/modules/settings.js";

export function getConfigs() {
  Object.keys(CONFIG_SETTINGS).forEach((key) =>
    window.renderer.send("BOARD:CONFIG", key)
  );
}

export function getTelemetry() {
  Object.keys(TELEMETRY_SETTINGS).forEach((key) =>
    window.renderer.send("BOARD:CONFIG", key)
  );
}

export function setConfigs(data) {
  Object.keys(CONFIG_SETTINGS).forEach((key) => {
    window.renderer.send("BOARD:SET_CONFIG", [key, data[key].value]);
  });

  window.renderer.send("BOARD:SAVE");
}
