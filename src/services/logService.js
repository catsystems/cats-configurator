import { LOG_KEYS } from "@/modules/settings.js";

export function getLogInfo() {
  window.cats.board.getLogInfo();
}

export function getLogData() {
  LOG_KEYS.forEach((key) => {
    window.cats.board.getConfig(key);
  });
}

export function setLogData({ speed, elements }) {
  window.cats.board.setConfig("rec_speed", speed);
  window.cats.board.setConfig("rec_elements", elements);
  window.cats.board.save();
}
