import { TIMER_KEYS } from "@/modules/settings.js";

export function getTimers() {
  TIMER_KEYS.forEach((key) => window.renderer.send("BOARD:TIMERS", key));
}

export function setTimers(data) {
  Object.keys(data).forEach((key) => {
    window.renderer.send("BOARD:SET_CONFIG", [key, data[key].value]);
  });

  window.renderer.send("BOARD:SAVE");
}
