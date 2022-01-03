import { LOG_KEYS } from "@/modules/settings.js";

export function getLogInfo() {
  window.renderer.send("BOARD:LOG_INFO");
}

export function getLogData() {
  LOG_KEYS.forEach((key) => {
    window.renderer.send("BOARD:CONFIG", key);
  });
}

export function setLogData({ speed, elements }) {
  window.renderer.send("BOARD:SET_CONFIG", ["rec_speed", speed]);
  window.renderer.send("BOARD:SET_CONFIG", ["rec_elements", elements]);
  window.renderer.send("BOARD:SAVE");
}
