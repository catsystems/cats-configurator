import { LOG_KEYS } from "@/modules/settings.js";
import { applyBoardValues } from "@/services/boardService.js";

export function getLogInfo() {
  window.cats.board.getLogInfo();
}

export function getLogData() {
  return Promise.all(LOG_KEYS.map((key) => window.cats.board.getConfig(key)));
}

export function setLogData({ speed, elements }) {
  return applyBoardValues([
    { key: "rec_speed", value: speed },
    { key: "rec_elements", value: elements },
  ]);
}
