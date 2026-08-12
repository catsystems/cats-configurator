import { CONFIG_SETTINGS } from "@/modules/settings.js";
import { applyBoardValues } from "@/services/boardService.js";

export function getConfigs() {
  return Promise.all(
    Object.keys(CONFIG_SETTINGS).map((key) => window.cats.board.getConfig(key)),
  );
}

export function setConfigs(data, original = {}) {
  const entries = Object.keys(CONFIG_SETTINGS)
    .filter((key) => key in data)
    .filter((key) => data[key].value !== original[key]?.value)
    .map((key) => ({ key, value: data[key].value }));
  return applyBoardValues(entries);
}
