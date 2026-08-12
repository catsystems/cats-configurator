import { TIMER_KEYS } from "@/modules/settings.js";
import { applyBoardValues } from "@/services/boardService.js";

export function getTimers() {
  return Promise.all(TIMER_KEYS.map((key) => window.cats.board.getTimers(key)));
}

export function setTimers(data) {
  return applyBoardValues(
    Object.keys(data).map((key) => ({ key, value: data[key].value })),
  );
}
