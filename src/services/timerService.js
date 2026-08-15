import { applyBoardValues } from "@/services/boardService.js";

export function getTimers() {
  return window.cats.board.getConfigs();
}

export function setTimers(data, original = {}) {
  return applyBoardValues(
    Object.keys(data)
      .filter((key) => data[key].value !== original[key]?.value)
      .map((key) => ({ key, value: data[key].value })),
  );
}
