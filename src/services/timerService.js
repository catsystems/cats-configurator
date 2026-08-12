import { TIMER_KEYS } from "@/modules/settings.js";
import { applyBoardValues } from "@/services/boardService.js";

export function getTimers() {
  return Promise.all(TIMER_KEYS.map((key) => window.cats.board.getTimers(key)));
}

export function setTimers(data, original = {}) {
  return applyBoardValues(
    Object.keys(data)
      .filter((key) => data[key].value !== original[key]?.value)
      .map((key) => ({ key, value: data[key].value })),
  );
}
