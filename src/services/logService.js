import { applyBoardValues } from "@/services/boardService.js";

export function getLogInfo() {
  window.cats.board.getLogInfo();
}

export function getLogData() {
  return window.cats.board.getConfigs();
}

export function setLogData({ speed, elements }, original = {}) {
  const entries = [
    { key: "rec_speed", value: speed },
    { key: "rec_elements", value: elements },
  ].filter(({ key, value }) => value !== original[key]?.value);
  return applyBoardValues(entries);
}
