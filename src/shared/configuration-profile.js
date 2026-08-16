import {
  CONFIG_KEYS,
  CONFIG_SETTINGS,
  EVENT_KEYS,
  LOG_ELEMENTS,
  LOG_KEYS,
  PROFILE_BOARD_KEYS,
  TIMER_FIELDS,
  TIMER_KEYS,
} from "../modules/settings.js";
import { parseConfiguredActions } from "./preflight.js";

export const PROFILE_FORMAT = "cats-configurator-profile";
export const PROFILE_SCHEMA_VERSION = 1;

const profileKeys = PROFILE_BOARD_KEYS.filter((key) => !LOG_KEYS.includes(key));
const knownKeys = new Set(profileKeys);

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertProfileValue(value, label) {
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw new TypeError(`${label} must be a string, number, or boolean.`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  if (
    typeof value === "string" &&
    (value.length > 512 || /[\r\n]/.test(value))
  ) {
    throw new TypeError(
      `${label} must be a single line of at most 512 characters.`,
    );
  }
  return value;
}

function sectionEntries(section, prefix) {
  return Object.entries(section).map(([key, value]) => ({
    key: prefix ? `${prefix}_${key}` : key,
    value: assertProfileValue(value, `Profile value ${key}`),
  }));
}

export function parseBoardIdentity(lines = []) {
  const valueAfter = (label) =>
    lines
      .find((line) => line.startsWith(label))
      ?.slice(label.length)
      .trim() ?? null;
  return {
    model: valueAfter("Board:"),
    firmwareVersion: valueAfter("Code version:") ?? valueAfter("Firmware:"),
    telemetryFirmwareVersion: valueAfter("Telemetry Code version:"),
  };
}

export function createConfigurationProfile(
  snapshot,
  { appVersion, createdAt = new Date().toISOString() } = {},
) {
  assertRecord(snapshot, "Board snapshot");
  const values = assertRecord(snapshot.values, "Board snapshot values");
  const timerValue = (timer, field) => values[`${timer}_${field}`];

  return {
    format: PROFILE_FORMAT,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    createdAt,
    source: {
      boardModel: snapshot.board?.model ?? null,
      firmwareVersion: snapshot.board?.firmwareVersion ?? null,
      telemetryFirmwareVersion:
        snapshot.board?.telemetryFirmwareVersion ?? null,
      configuratorVersion: appVersion ?? null,
    },
    configuration: Object.fromEntries(
      CONFIG_KEYS.filter((key) => key in values).map((key) => [
        key,
        values[key],
      ]),
    ),
    events: Object.fromEntries(
      EVENT_KEYS.filter((key) => key in values).map((key) => [
        key,
        values[key],
      ]),
    ),
    timers: Object.fromEntries(
      TIMER_KEYS.map((timer) => [
        timer,
        Object.fromEntries(
          TIMER_FIELDS.filter((field) => `${timer}_${field}` in values).map(
            (field) => [field, timerValue(timer, field)],
          ),
        ),
      ]),
    ),
    logging: {},
  };
}

export function validateConfigurationProfile(profile) {
  assertRecord(profile, "Configuration profile");
  if (profile.format !== PROFILE_FORMAT) {
    throw new TypeError("This file is not a CATS Configurator profile.");
  }
  if (!Number.isInteger(profile.schemaVersion) || profile.schemaVersion < 1) {
    throw new TypeError("Profile schemaVersion must be a positive integer.");
  }
  if (typeof profile.createdAt !== "string") {
    throw new TypeError("Profile createdAt must be a string.");
  }
  const source = assertRecord(profile.source, "Profile source");
  for (const key of [
    "boardModel",
    "firmwareVersion",
    "telemetryFirmwareVersion",
    "configuratorVersion",
  ]) {
    if (source[key] !== null && typeof source[key] !== "string") {
      throw new TypeError(`Profile source ${key} must be a string or null.`);
    }
  }
  assertRecord(profile.configuration, "Profile configuration");
  assertRecord(profile.events, "Profile events");
  assertRecord(profile.timers, "Profile timers");
  assertRecord(profile.logging, "Profile logging");
  const entries = flattenConfigurationProfile(profile);
  const duplicate = entries.find(
    ({ key }, index) =>
      entries.findIndex((entry) => entry.key === key) !== index,
  );
  if (duplicate) {
    throw new TypeError(`Profile contains duplicate field ${duplicate.key}.`);
  }
  return profile;
}

export function flattenConfigurationProfile(profile) {
  const entries = [
    ...sectionEntries(profile.configuration, ""),
    ...sectionEntries(profile.events, ""),
  ];
  for (const [timer, fields] of Object.entries(profile.timers)) {
    assertRecord(fields, `Profile timer ${timer}`);
    entries.push(...sectionEntries(fields, timer));
  }
  return entries;
}

function valuesMatch(left, right) {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left) === Number(right);
  }
  if (typeof left === "boolean" || typeof right === "boolean") {
    const normalize = (value) =>
      typeof value === "boolean" ? value : String(value).toUpperCase() === "ON";
    return normalize(left) === normalize(right);
  }
  return String(left).trim() === String(right).trim();
}

export function profileSectionForKey(key) {
  if (CONFIG_KEYS.includes(key)) return "Configuration";
  if (EVENT_KEYS.includes(key)) return "Events";
  if (LOG_KEYS.includes(key)) return "Logging";
  if (TIMER_KEYS.some((timer) => key.startsWith(`${timer}_`))) return "Timers";
  return "Unknown";
}

export function profileLabelForKey(key) {
  if (CONFIG_SETTINGS[key]?.name) return CONFIG_SETTINGS[key].name;
  if (key === "rec_speed") return "Recording Rate";
  if (key === "rec_elements") return "Recorded Data";
  if (key.startsWith("ev_")) {
    return `${key
      .slice(3)
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())} Actions`;
  }
  const timer = key.match(/^timer(\d+)_(.+)$/);
  if (timer) {
    const field = timer[2].replace(/\b\w/g, (letter) => letter.toUpperCase());
    return `Timer ${timer[1]} ${field}`;
  }
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRecordingElements(value) {
  let mask;
  try {
    mask = BigInt(String(value));
  } catch {
    return String(value);
  }
  if (mask === 0n) return "No recorded data";
  if (mask === 0xffffffffn) return "All available data";

  const enabled = LOG_ELEMENTS.filter(
    ({ dec }) => (mask & BigInt(dec)) !== 0n,
  ).map(({ name }) => name);
  const knownMask = LOG_ELEMENTS.reduce(
    (result, { dec }) => result | BigInt(dec),
    0n,
  );
  const hasUnknownFlags = (mask & ~knownMask) !== 0n;
  const summary = enabled.join(", ") || "No known data";
  return hasUnknownFlags ? `${summary} + unknown/reserved flags` : summary;
}

export function formatProfileValue(key, value) {
  if (value === null || value === undefined) return "—";
  if (EVENT_KEYS.includes(key)) {
    const actions = parseConfiguredActions(value);
    return actions.length
      ? actions.map(({ summary }) => summary).join(" → ")
      : "No actions";
  }
  if (key === "rec_elements") return formatRecordingElements(value);
  return String(value);
}

export function compareConfigurationProfile(profile, snapshot) {
  validateConfigurationProfile(profile);
  assertRecord(snapshot, "Board snapshot");
  const boardValues = assertRecord(snapshot.values, "Board snapshot values");
  const unsupported = new Set(snapshot.unsupportedKeys ?? []);
  const profileEntries = flattenConfigurationProfile(profile);
  const profileValues = new Map(
    profileEntries.map(({ key, value }) => [key, value]),
  );
  const keys = [...new Set([...profileKeys, ...profileValues.keys()])];
  const rows = keys.map((key) => {
    const known = knownKeys.has(key);
    const hasProfile = profileValues.has(key);
    const hasBoard = key in boardValues && !unsupported.has(key);
    let status;
    if (!known || !hasBoard) status = "unsupported";
    else if (!hasProfile) status = "missing";
    else if (valuesMatch(profileValues.get(key), boardValues[key])) {
      status = "same";
    } else status = "changed";
    return {
      key,
      section: profileSectionForKey(key),
      label: profileLabelForKey(key),
      boardValue: hasBoard ? boardValues[key] : null,
      profileValue: hasProfile ? profileValues.get(key) : null,
      status,
    };
  });

  const warnings = [];
  let blocked = false;
  if (profile.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    blocked = true;
    warnings.push({
      severity: "error",
      message: `Profile schema ${profile.schemaVersion} is not supported by this Configurator (schema ${PROFILE_SCHEMA_VERSION}).`,
    });
  }
  const profileModel = profile.source.boardModel;
  const boardModel = snapshot.board?.model;
  if (profileModel && boardModel && profileModel !== boardModel) {
    blocked = true;
    warnings.push({
      severity: "error",
      message: `Profile board ${profileModel} does not match connected board ${boardModel}.`,
    });
  }
  const profileFirmware = profile.source.firmwareVersion;
  const boardFirmware = snapshot.board?.firmwareVersion;
  if (profileFirmware && boardFirmware && profileFirmware !== boardFirmware) {
    warnings.push({
      severity: "warning",
      message: `Profile firmware ${profileFirmware} differs from connected firmware ${boardFirmware}. Review the diff before applying.`,
    });
  }
  const unsupportedCount = rows.filter(
    ({ status }) => status === "unsupported",
  ).length;
  const missingCount = rows.filter(({ status }) => status === "missing").length;
  if (unsupportedCount) {
    warnings.push({
      severity: "warning",
      message: `${unsupportedCount} profile field${unsupportedCount === 1 ? " is" : "s are"} unsupported and will not be applied.`,
    });
  }
  if (missingCount) {
    warnings.push({
      severity: "warning",
      message: `${missingCount} board field${missingCount === 1 ? " is" : "s are"} missing from the profile and will remain unchanged.`,
    });
  }

  return {
    rows,
    compatibility: {
      blocked,
      canApply: !blocked,
      warnings,
      changedCount: rows.filter(({ status }) => status === "changed").length,
    },
  };
}

export function changedProfileEntries(comparison) {
  return comparison.rows
    .filter(({ status }) => status === "changed")
    .map(({ key, profileValue }) => ({ key, value: profileValue }));
}
