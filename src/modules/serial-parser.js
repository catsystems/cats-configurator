import { EVENT_SETTINGS } from "./settings.js";

export function parseCommand(data) {
  const command = parsePromptCommand(data);
  if (command === null) return undefined;
  return command
    .toLowerCase()
    .trim()
    .replace(/[^\w \-_]/g, "")
    .replace(/ +/g, "_");
}

export function parsePromptCommand(data) {
  if (typeof data !== "string" || !data.includes("^._.^")) return null;
  const separator = data.lastIndexOf(">");
  if (separator < 0) return "";
  return data.slice(separator + 1).trim();
}

export function normalizeBoardCommand(command) {
  return command
    .trim()
    .toLowerCase()
    .replace(/\s*=\s*/g, "=")
    .replace(/\s+/g, " ");
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

export function parseConfigResponse(lines) {
  const valueLine = lines.find((line) => line.includes(" = "));
  if (!valueLine)
    throw new Error("Board did not return a configuration value.");

  let config = parseConfigValue(valueLine);
  const allowedValues = lines.find((line) => line.includes("Allowed values:"));
  const allowedRange = lines.find((line) => line.includes("Allowed range:"));
  const stringLength = lines.find((line) => line.includes("String length:"));
  const arrayLength = lines.find((line) => line.includes("Array length:"));

  if (allowedValues) {
    config.type = "SELECT";
    config.allowedValues = parseAllowedValues(allowedValues);
  } else if (allowedRange) {
    config.type = "NUMBER";
    config.value = Number(config.value);
    config.allowedRange = parseAllowedRange(allowedRange);
  } else if (stringLength) {
    config.type = "STRING";
    config.value = String(config.value);
    config.allowedRange = parseAllowedRange(stringLength);
  } else if (arrayLength) {
    config.type = "EVENT";
    config.arrayLength = parseAllowedLength(arrayLength);
    Object.assign(config, parseEventData(config.value, config.arrayLength));
  }

  return config;
}
