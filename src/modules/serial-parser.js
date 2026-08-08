import { EVENT_SETTINGS } from "./settings.js";

export function parseCommand(data) {
  const commandParts = data.split(">");
  if (commandParts.length < 2) return undefined;
  commandParts.shift();

  return commandParts
    .join("")
    .toLowerCase()
    .trim()
    .replace(/[^\w \-_]/g, "")
    .replace(/ +/g, "_");
}

export function parseData(key, data) {
  return {
    key,
    value: data.trim().split("\n"),
  };
}

export function parseConfigValue(data) {
  const [key, value] = data.split(" = ");
  return { key, value };
}

export function parseAllowedValues(data) {
  const [, values = ""] = data.split(":");
  return values.replace(/ +/g, "").split(",");
}

export function parseAllowedRange(data) {
  const [, range = ""] = data.split(":");
  const match = range
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return [];
  return [Number(match[1]), Number(match[2])];
}

export function parseAllowedLength(data) {
  const [, length = ""] = data.split(":");
  return Number(length.trim());
}

export function parseEventData(value, maxLength) {
  const valuesArray = value.split(",").map(Number);
  const values = [];
  const actions = [];

  for (
    let index = 0;
    index < valuesArray.length && index < maxLength;
    index += 2
  ) {
    if (valuesArray[index] === 0) continue;

    const actionIndex = valuesArray[index];
    const actionValue = valuesArray[index + 1];
    const config = EVENT_SETTINGS[actionIndex];
    if (!config) continue;

    actions.push({ ...config, index: actionIndex, value: actionValue });
    values.push(actionIndex, actionValue);
  }

  return { values, actions };
}
