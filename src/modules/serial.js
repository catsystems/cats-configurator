import { Notification, app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { ReadlineParser, SerialPort } from "serialport";

import {
  BoardCommandEngine,
  BoardCommandError,
} from "./board-command-engine.js";
import {
  normalizeBoardCommand,
  parseConfigResponse,
  parseConfigResponses,
  parseData,
  parsePromptCommand,
} from "./serial-parser.js";
import { PROFILE_BOARD_KEYS } from "./settings.js";
import {
  changedProfileEntries,
  compareConfigurationProfile,
  parseBoardIdentity,
} from "../shared/configuration-profile.js";
import { assertBoardEntries, IPC_CHANNELS } from "../shared/ipc.js";

const CONFIG = { baudRate: 115200 };
const BOARD_IDENTIFICATION_TIMEOUT_MS = 5000;

let mainWindow;
let port;
let parser;
let commandEngine;
let currentNotification;
let communicationLogStream;

const useFakeSerial = process.env.CATS_FAKE_SERIAL === "1";
const fakeSerialStartedAt = Date.now();
const fakeSerialAppearAfterMs = Math.max(
  0,
  Number.parseInt(process.env.CATS_FAKE_SERIAL_APPEAR_AFTER_MS ?? "0", 10) || 0,
);
const fakeVegaCount = Math.max(
  0,
  Number.parseInt(process.env.CATS_FAKE_VEGA_COUNT ?? "0", 10) || 0,
);

const fakeConfigurations = {
  main_altitude: {
    value: 200,
    type: "NUMBER",
    allowedRange: [10, 65535],
  },
  acc_threshold: { value: 35, type: "NUMBER", allowedRange: [30, 80] },
  servo1_init_pos: { value: 0, type: "NUMBER", allowedRange: [0, 1000] },
  servo2_init_pos: { value: 0, type: "NUMBER", allowedRange: [0, 1000] },
  tele_enable: {
    value: "ON",
    type: "SELECT",
    allowedValues: ["OFF", "ON"],
  },
  tele_link_phrase: {
    value: "cats-test",
    type: "STRING",
    allowedRange: [4, 16],
  },
  tele_power_level: {
    value: 20,
    type: "NUMBER",
    allowedRange: [16, 30],
  },
  tele_adaptive_power: {
    value: "OFF",
    type: "SELECT",
    allowedValues: ["OFF", "ON"],
  },
  test_mode: {
    value: "OFF",
    type: "SELECT",
    allowedValues: ["OFF", "ON"],
  },
  tele_test_phrase: {
    value: "cats-test",
    type: "STRING",
    allowedRange: [4, 16],
  },
  rec_speed: {
    value: "100Hz",
    type: "SELECT",
    allowedValues: ["OFF", "10 Hz", "50 Hz", "100 Hz"],
  },
  rec_elements: {
    value: 4294967295,
    type: "NUMBER",
    allowedRange: [0, 4294967295],
  },
};

const fakeEventKeys = new Set([
  "ev_liftoff",
  "ev_burnout",
  "ev_apogee",
  "ev_main_deployment",
  "ev_touchdown",
  "ev_custom1",
  "ev_custom2",
]);
const fakeValues = new Map();

function initialFakeConfig(key) {
  if (fakeConfigurations[key]) return { key, ...fakeConfigurations[key] };
  if (fakeEventKeys.has(key)) {
    const hasRecorderAction = key === "ev_liftoff";
    return {
      key,
      value: hasRecorderAction ? "7,2" : "0,0",
      type: "EVENT",
      arrayLength: 16,
    };
  }
  const timerMatch = key.match(/^(timer[1-4])_(start|duration|trigger)$/);
  if (!timerMatch) return null;
  const [, timer, field] = timerMatch;
  if (field === "duration") {
    return {
      key,
      value: timer === "timer1" ? 1000 : 0,
      type: "NUMBER",
      allowedRange: [0, 1200000],
    };
  }
  return {
    key,
    value: field === "start" ? "LIFTOFF" : "APOGEE",
    type: "SELECT",
    allowedValues: ["CALIBRATE", "READY", "LIFTOFF", "BURNOUT", "APOGEE"],
  };
}

function fakeConfigForKey(key) {
  const config = initialFakeConfig(key);
  if (!config) return null;
  if (!fakeValues.has(key)) fakeValues.set(key, config.value);
  return { ...config, value: fakeValues.get(key) };
}

function fakeConfigLines(config) {
  const lines = [`${config.key} = ${config.value}`];
  if (config.type === "SELECT") {
    lines.push(`Allowed values: ${config.allowedValues.join(", ")}`);
  } else if (config.type === "NUMBER") {
    lines.push(`Allowed range: ${config.allowedRange.join(" - ")}`);
  } else if (config.type === "STRING") {
    lines.push(`String length: ${config.allowedRange.join(" - ")}`);
  } else if (config.type === "EVENT") {
    lines.push(`Array length: ${config.arrayLength}`);
  }
  return lines;
}

function coerceFakeValue(config, value) {
  return config.type === "NUMBER" ? Number(value) : String(value);
}

function fakeOutputForCommand(boardCommand) {
  if (boardCommand === "ls /flights") return ["file flight_00007"];
  if (boardCommand.startsWith("rm ")) {
    return [`File '${boardCommand.slice(3)}' removed!`];
  }
  if (/^get\s*$/i.test(boardCommand)) {
    return PROFILE_BOARD_KEYS.flatMap((key) => [
      ...fakeConfigLines(fakeConfigForKey(key)),
      "",
    ]);
  }
  const getMatch = boardCommand.match(/^get ([a-z0-9_]+)$/i);
  if (getMatch) {
    const config = fakeConfigForKey(getMatch[1]);
    return config ? fakeConfigLines(config) : ["ERROR IN get: INVALID NAME"];
  }

  const setMatch = boardCommand.match(/^set ([a-z0-9_]+)\s*=\s*(.*)$/i);
  if (setMatch) {
    const [, key, value] = setMatch;
    const config = fakeConfigForKey(key);
    if (!config) return ["ERROR IN set: INVALID NAME"];
    fakeValues.set(key, coerceFakeValue(config, value));
    return [`${key} set to ${fakeValues.get(key)}`];
  }

  if (boardCommand === "version") {
    return ["Board: CATS Vega", "Firmware: test"];
  }
  if (boardCommand === "status") {
    return [
      "CATS test device",
      "State: READY",
      "Nominal",
      "h: 0 m, v: 0 m/s, a: 0 m/s^2",
    ];
  }
  if (boardCommand === "rec_info") {
    return ["Flash usage: 1024 / 1048576 bytes"];
  }
  if (/^sim(?:\s|$)/i.test(boardCommand)) {
    return [
      "[100]: height: 1.000000, velocity: 2.000000, offset: 0.100000",
      "Simulation Successful.",
    ];
  }
  if (boardCommand === "save") return ["Successfully written to flash"];
  if (boardCommand === "defaults") return ["Reset to default values"];
  if (boardCommand === "dump") {
    const values = [...fakeValues.entries()].map(
      ([key, value]) => `set ${key} = ${value}`,
    );
    return ["#Configuration dump", ...values, "#End of configuration dump"];
  }
  return [`test> ${boardCommand}`];
}

function feedFakeCommand(boardCommand) {
  const lines = [
    `^._.^:/> ${boardCommand}`,
    ...fakeOutputForCommand(boardCommand),
    "^._.^:/>",
  ];
  queueMicrotask(() =>
    lines.forEach((line) => {
      writeCommunicationLog("RX", line);
      commandEngine?.receive(line);
    }),
  );
}

function createCommandEngine(write) {
  return new BoardCommandEngine({
    write: (boardCommand) => {
      writeCommunicationLog("TX", boardCommand);
      return write(boardCommand);
    },
    parsePrompt: parsePromptCommand,
    normalizeCommand: normalizeBoardCommand,
    timeoutMs: 2500,
    retries: 1,
  });
}

function writeCommunicationLog(direction, message) {
  if (!communicationLogStream?.writable) return;
  const text = String(message).replace(/[\r\n]+/g, "\\n");
  communicationLogStream.write(
    `${new Date().toISOString()} ${direction} ${text}\n`,
  );
}

function startCommunicationLog(serialPath) {
  if (communicationLogStream) {
    writeCommunicationLog("SESSION", "Connection replaced");
    communicationLogStream.end();
  }

  try {
    const logDirectory = app.getPath("logs");
    fs.mkdirSync(logDirectory, { recursive: true });
    const stream = fs.createWriteStream(
      path.join(logDirectory, "vega-communication.log"),
      { flags: "a", encoding: "utf8" },
    );
    communicationLogStream = stream;
    stream.on("error", (error) => {
      console.error("Could not write Vega communication log:", error);
      if (communicationLogStream === stream) communicationLogStream = null;
    });
    writeCommunicationLog("SESSION", `Connecting to ${serialPath}`);
  } catch (error) {
    communicationLogStream = null;
    console.error("Could not open Vega communication log:", error);
  }
}

function stopCommunicationLog(message) {
  if (!communicationLogStream) return;
  writeCommunicationLog("SESSION", message);
  const stream = communicationLogStream;
  communicationLogStream = null;
  stream.end();
}

function writeSerialCommand(candidatePort, boardCommand) {
  return new Promise((resolve, reject) => {
    candidatePort.write(`${boardCommand}\n`, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function setSerialWindow(window) {
  mainWindow = window;
}

async function getList() {
  if (useFakeSerial) {
    if (Date.now() - fakeSerialStartedAt < fakeSerialAppearAfterMs) return [];
    if (fakeVegaCount > 0) {
      return Array.from({ length: fakeVegaCount }, (_value, index) => ({
        path: fakeVegaCount === 1 ? "CATS-FAKE" : `CATS-FAKE-${index + 1}`,
        manufacturer: "CATS Systems",
        friendlyName: "CATS Vega",
        vendorId: "CAFE",
        productId: "4003",
        serialNumber: `CATS-FAKE-${index + 1}`,
        locationId: `fake-${index + 1}`,
      }));
    }
    return [{ path: "CATS-FAKE", manufacturer: "CATS Systems" }];
  }
  return SerialPort.list();
}

function connect(serialPath) {
  if (useFakeSerial) {
    startCommunicationLog(serialPath);
    commandEngine?.cancel("Board connection replaced.");
    commandEngine = createCommandEngine(feedFakeCommand);
    queueMicrotask(() => {
      sendToRenderer(IPC_CHANNELS.SERIAL_CONNECTED);
      sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, {
        key: "version",
        value: ["Board: CATS Vega", "Firmware: test"],
      });
      sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, true);
    });
    return;
  }

  if (port?.isOpen || port?.opening) {
    sendToRenderer(
      IPC_CHANNELS.SERIAL_ERROR,
      "A serial connection is already in progress.",
    );
    return;
  }

  startCommunicationLog(serialPath);

  const candidatePort = new SerialPort(
    { ...CONFIG, path: serialPath },
    (error) => {
      if (!error) return;
      if (port === candidatePort) port = null;
      commandEngine?.cancel(error);
      commandEngine = null;
      writeCommunicationLog("ERROR", error.message);
      stopCommunicationLog("Connection failed");
      sendToRenderer(IPC_CHANNELS.SERIAL_ERROR, error.message);
    },
  );
  port = candidatePort;
  commandEngine = createCommandEngine((boardCommand) =>
    writeSerialCommand(candidatePort, boardCommand),
  );
  parser = candidatePort.pipe(
    new ReadlineParser({ delimiter: "\n", encoding: "utf8" }),
  );
  parser.on("data", onData);

  candidatePort.on("error", (error) => {
    writeCommunicationLog("ERROR", error.message);
    sendToRenderer(IPC_CHANNELS.SERIAL_ERROR, error.message);
    commandEngine?.cancel(error);
    if (candidatePort.isOpen) candidatePort.close();
    else if (!candidatePort.opening && port === candidatePort) {
      port = null;
      parser = null;
      commandEngine = null;
      stopCommunicationLog("Connection failed");
    }
  });
  candidatePort.on("open", () => {
    writeCommunicationLog("SESSION", "Port opened");
    writeCommunicationLog("TX", "<wake>");
    candidatePort.write("\n");
    sendToRenderer(IPC_CHANNELS.SERIAL_CONNECTED);
    void identifyBoard();
  });
  candidatePort.on("close", () => {
    if (port === candidatePort) port = null;
    parser = null;
    commandEngine?.cancel();
    commandEngine = null;
    stopCommunicationLog("Port closed");
    notify({ title: "Port is disconnected." });
    sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, false);
    sendToRenderer(IPC_CHANNELS.SERIAL_DISCONNECTED);
  });
}

async function identifyBoard() {
  try {
    const response = await requireCommandEngine().run("version", {
      timeoutMs: BOARD_IDENTIFICATION_TIMEOUT_MS,
      retries: 0,
    });
    const parsedData = parseData("version", response.output.join("\n"));
    sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, parsedData);
    if (!response.output.some((line) => /Board:\s*CATS/i.test(line))) {
      throw new Error(
        "The selected serial device is not a CATS flight computer.",
      );
    }
    notify({
      title: `Connected to: ${port.path}`,
      body: response.output.join("\n"),
    });
    sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, true);
  } catch (error) {
    const message =
      error instanceof BoardCommandError && /timed out/i.test(error.message)
        ? "CATS Vega did not respond within five seconds."
        : error.message;
    sendToRenderer(IPC_CHANNELS.SERIAL_ERROR, message);
    disconnect();
  }
}

function disconnect() {
  writeCommunicationLog("SESSION", "Disconnect requested");
  commandEngine?.cancel();
  if (useFakeSerial) {
    commandEngine = null;
    stopCommunicationLog("Port closed");
    queueMicrotask(() => {
      sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, false);
      sendToRenderer(IPC_CHANNELS.SERIAL_DISCONNECTED);
    });
    return;
  }
  if (port && port.isOpen) port.close();
}

function onData(data) {
  const line = data.endsWith("\r") ? data.slice(0, -1) : data;
  writeCommunicationLog("RX", line);
  if (commandEngine?.receive(line)) return;
  if (line.includes("CATS is now ready")) void identifyBoard();
}

function requireCommandEngine() {
  if (!commandEngine) throw new Error("Serial port is not connected.");
  return commandEngine;
}

function emitConfig(config) {
  sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_DATA, config);
  return config;
}

function emitConfigs(configs) {
  sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_DATA, configs);
  return configs;
}

async function collectBoardConfigurations(execute) {
  let configs = [];
  try {
    const response = await execute("get");
    configs = parseConfigResponses(response.output);
  } catch (error) {
    if (!(error instanceof BoardCommandError)) throw error;
  }

  const configsByKey = new Map(
    configs
      .filter(({ key, type }) => key && type)
      .map((config) => [config.key, config]),
  );
  const unsupportedKeys = [];

  for (const key of PROFILE_BOARD_KEYS) {
    if (configsByKey.has(key)) continue;
    try {
      const response = await execute(`get ${key}`);
      const config = parseConfigResponse(response.output);
      configsByKey.set(key, config);
    } catch (error) {
      if (
        error instanceof BoardCommandError &&
        /invalid name/i.test(error.message)
      ) {
        unsupportedKeys.push(key);
        continue;
      }
      throw error;
    }
  }

  return {
    configs: PROFILE_BOARD_KEYS.flatMap((key) =>
      configsByKey.has(key) ? [configsByKey.get(key)] : [],
    ),
    unsupportedKeys,
  };
}

async function readBoardConfigurations() {
  const result = await requireCommandEngine().transaction((execute) =>
    collectBoardConfigurations(execute),
  );
  emitConfigs(result.configs);
  return result;
}

function processCommandResponse(boardCommand, output) {
  if (boardCommand === "version") {
    const parsed = parseData("version", output.join("\n"));
    sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, parsed);
    return parsed;
  }
  if (["status", "rec_info"].includes(boardCommand)) {
    const parsed = parseData(boardCommand, output.join("\n"));
    sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, parsed);
    return parsed;
  }
  if (boardCommand.startsWith("get ")) {
    return emitConfig(parseConfigResponse(output));
  }
  if (boardCommand === "get") {
    return emitConfigs(parseConfigResponses(output));
  }
  if (boardCommand === "defaults") {
    notify({ title: "Config reset to default" });
  }
  return output;
}

async function command(boardCommand, { poll = false } = {}) {
  const engine = requireCommandEngine();
  const response = poll
    ? await engine.poll(boardCommand)
    : await engine.run(boardCommand);
  if (!response) return null;
  return processCommandResponse(boardCommand, response.output);
}

async function cliCommand(boardCommand) {
  const normalizedCommand = normalizeBoardCommand(boardCommand);
  const isSimulation =
    normalizedCommand === "sim" || normalizedCommand.startsWith("sim ");
  if (useFakeSerial && isSimulation) {
    sendToRenderer(IPC_CHANNELS.SERIAL_DATA, `test> ${boardCommand}`);
  }
  let response;
  try {
    response = await requireCommandEngine().run(boardCommand, {
      timeoutMs: isSimulation ? 5 * 60_000 : 5000,
      retries: 0,
      waitForPrompt: isSimulation,
      resetTimeoutOnOutput: isSimulation,
      onOutput: isSimulation
        ? (line) => sendToRenderer(IPC_CHANNELS.SERIAL_DATA, line)
        : undefined,
    });
  } catch (error) {
    const expectedRebootDisconnect =
      normalizedCommand === "reboot" &&
      error instanceof BoardCommandError &&
      error.message === "Board connection closed.";
    if (expectedRebootDisconnect) return [];
    throw error;
  }
  if (useFakeSerial && !isSimulation) {
    sendToRenderer(IPC_CHANNELS.SERIAL_DATA, `test> ${boardCommand}`);
  }
  if (!isSimulation) {
    response.output.forEach((line) =>
      sendToRenderer(IPC_CHANNELS.SERIAL_DATA, line),
    );
  }
  return response.output;
}

function valuesMatch(expected, actual) {
  if (typeof expected === "number") return Number(actual) === expected;
  if (typeof expected === "boolean") {
    return String(actual).toUpperCase() === (expected ? "ON" : "OFF");
  }
  return String(actual).trim() === String(expected).trim();
}

async function applyConfiguration(entries) {
  entries = assertBoardEntries(entries);
  const duplicateKeys = entries
    .map(({ key }) => key)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateKeys.length) {
    throw new TypeError(
      `Configuration transaction repeats ${duplicateKeys[0]}.`,
    );
  }

  const result = await requireCommandEngine().transaction(async (execute) => {
    const results = entries.map(({ key, value }) => ({
      key,
      expected: value,
      actual: null,
      status: "pending",
      message: null,
    }));

    for (const [index, entry] of entries.entries()) {
      try {
        const boardValue =
          typeof entry.value === "boolean"
            ? entry.value
              ? "ON"
              : "OFF"
            : entry.value;
        const response = await execute(`set ${entry.key} = ${boardValue}`);
        if (!response.output.some((line) => /\bset to\b/i.test(line))) {
          throw new Error("Board did not acknowledge the new value.");
        }
        results[index].status = "written";
      } catch (error) {
        results[index].status = "failed";
        results[index].message = error.message;
        return { ok: false, saved: false, results };
      }
    }

    try {
      const save = await execute("save");
      if (!save.output.some((line) => /written to flash/i.test(line))) {
        throw new Error("Board did not confirm the flash save.");
      }
    } catch (error) {
      results.forEach((field) => {
        if (field.status === "written") {
          field.status = "failed";
          field.message = error.message;
        }
      });
      return { ok: false, saved: false, results };
    }

    for (const [index, entry] of entries.entries()) {
      try {
        const response = await execute(`get ${entry.key}`);
        const config = emitConfig(parseConfigResponse(response.output));
        results[index].actual = config.value;
        results[index].status = valuesMatch(entry.value, config.value)
          ? "verified"
          : "mismatch";
        if (results[index].status === "mismatch") {
          results[index].message = "Read-back value does not match.";
        }
      } catch (error) {
        results[index].status = "failed";
        results[index].message = error.message;
      }
    }

    return {
      ok: results.every(({ status }) => status === "verified"),
      saved: true,
      results,
    };
  });

  if (result.ok) sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_SAVED, result);
  return result;
}

async function resetBoardConfiguration() {
  const result = await requireCommandEngine().transaction(async (execute) => {
    const defaults = await execute("defaults");
    if (
      !defaults.output.some((line) => /reset to default values/i.test(line))
    ) {
      throw new Error("Board did not confirm the default configuration.");
    }
    const save = await execute("save");
    if (!save.output.some((line) => /written to flash/i.test(line))) {
      throw new Error("Board did not confirm the flash save.");
    }
    return { ok: true, saved: true };
  });
  sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_SAVED, result);
  return result;
}

function parseMountedFlightLogName(name) {
  const match = /^fl(\d{1,3})\.cfl$/i.exec(name);
  if (!match) {
    throw new Error("The selected onboard file is not a Vega flight log.");
  }
  const aliasNumber = Number.parseInt(match[1], 10);
  if (aliasNumber > 255) {
    throw new Error("The selected Vega flight-log number is invalid.");
  }
  return aliasNumber;
}

function confirmRemoval(output, filePath, { allowMissing = false } = {}) {
  const text = output.join("\n");
  if (/Removal of file .* failed/i.test(text)) {
    throw new Error(`The Vega could not remove ${filePath}.`);
  }
  if (/Cannot remove .*not a file/i.test(text)) {
    if (allowMissing) return;
    throw new Error(`${filePath} is no longer present on the Vega.`);
  }
  if (!/File '.*' removed!/i.test(text)) {
    throw new Error(`The Vega did not confirm removal of ${filePath}.`);
  }
}

async function removeBoardFlightLog(name) {
  const aliasNumber = parseMountedFlightLogName(name);
  return requireCommandEngine().transaction(async (execute) => {
    const listing = await execute("ls /flights");
    const internalNumbers = listing.output.flatMap((line) =>
      [...line.matchAll(/flight_(\d{5})/g)].map((match) => match[1]),
    );
    const matches = [
      ...new Set(
        internalNumbers.filter(
          (number) => (Number.parseInt(number, 10) & 0xff) === aliasNumber,
        ),
      ),
    ];
    if (matches.length === 0) {
      return {
        ok: true,
        alreadyMissing: true,
        flightPath: null,
        statsPath: null,
        configPath: null,
        statsName: `st${String(aliasNumber).padStart(3, "0")}.txt`,
      };
    }
    if (matches.length > 1) {
      throw new Error(
        `The mounted name ${name} matches more than one Vega flight. Reboot the Vega and try again.`,
      );
    }

    const internalNumber = matches[0];
    const flightPath = `/flights/flight_${internalNumber}`;
    const statsPath = `/stats/stats_${internalNumber}.txt`;
    const configPath = `/configs/flight_${internalNumber}.cfg`;
    const statsRemoval = await execute(`rm ${statsPath}`);
    confirmRemoval(statsRemoval.output, statsPath, { allowMissing: true });
    const configRemoval = await execute(`rm ${configPath}`);
    confirmRemoval(configRemoval.output, configPath, { allowMissing: true });
    const flightRemoval = await execute(`rm ${flightPath}`);
    confirmRemoval(flightRemoval.output, flightPath);

    return {
      ok: true,
      flightPath,
      statsPath,
      configPath,
      statsName: `st${String(aliasNumber).padStart(3, "0")}.txt`,
    };
  });
}

async function readBoardSnapshot() {
  return requireCommandEngine().transaction(async (execute) => {
    const version = await execute("version");
    const { configs, unsupportedKeys } =
      await collectBoardConfigurations(execute);
    const values = Object.fromEntries(
      configs.map(({ key, value }) => [key, value]),
    );

    return {
      board: parseBoardIdentity(version.output),
      values,
      unsupportedKeys,
    };
  });
}

async function applyConfigurationProfile(profile) {
  const before = await readBoardSnapshot();
  const comparison = compareConfigurationProfile(profile, before);
  if (comparison.compatibility.blocked) {
    throw new Error(
      comparison.compatibility.warnings
        .filter(({ severity }) => severity === "error")
        .map(({ message }) => message)
        .join(" "),
    );
  }

  const entries = changedProfileEntries(comparison);
  const transaction = entries.length
    ? await applyConfiguration(entries)
    : { ok: true, saved: false, results: [] };
  const transactionResults = new Map(
    transaction.results.map((result) => [result.key, result]),
  );
  const results = comparison.rows.map((row) => {
    if (row.status === "same") return { key: row.key, status: "unchanged" };
    if (row.status !== "changed") return { key: row.key, status: row.status };
    return (
      transactionResults.get(row.key) ?? {
        key: row.key,
        status: "pending",
      }
    );
  });

  let refreshedComparison = comparison;
  if (transaction.ok && entries.length) {
    refreshedComparison = compareConfigurationProfile(
      profile,
      await readBoardSnapshot(),
    );
  }
  return {
    ok: transaction.ok,
    saved: transaction.saved,
    results,
    ...refreshedComparison,
  };
}

function notify(payload) {
  if (currentNotification) currentNotification.close();
  currentNotification = new Notification(payload);
  currentNotification.show();
}

function sendToRenderer(channel, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, message);
  }
}

export {
  applyConfiguration,
  applyConfigurationProfile,
  cliCommand,
  command,
  connect,
  disconnect,
  getList,
  readBoardConfigurations,
  readBoardSnapshot,
  removeBoardFlightLog,
  resetBoardConfiguration,
  setSerialWindow,
};
