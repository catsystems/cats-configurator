import { TIMER_KEYS } from "@/modules/settings.js";

export function getTimers() {
  TIMER_KEYS.forEach((key) => window.cats.board.getTimers(key));
}

export function setTimers(data) {
  // console.log("SETTING TIMERS");
  Object.keys(data).forEach((key) => {
    // console.log("SETTING TIMER " + key);
    window.cats.board.setConfig(key, data[key].value);
  });

  window.cats.board.save();
}
