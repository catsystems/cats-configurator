import { CONFIG_SETTINGS } from "@/modules/settings.js";

export function getConfigs() {
  Object.keys(CONFIG_SETTINGS).forEach((key) =>
    window.cats.board.getConfig(key),
  );
}

export function setConfigs(data) {
  Object.keys(CONFIG_SETTINGS).forEach((key) => {
    if (key in data) {
      window.cats.board.setConfig(key, data[key].value);
    }
  });

  window.cats.board.save();
}
