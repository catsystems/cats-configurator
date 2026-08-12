import { Notification, dialog } from "electron";
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
  parseData,
  parsePromptCommand,
} from "./serial-parser.js";
import { IPC_CHANNELS } from "../shared/ipc.js";

const CONFIG = { baudRate: 115200 };
const BOARD_IDENTIFICATION_TIMEOUT_MS = 5000;

let mainWindow;
let port;
let parser;
let commandEngine;
let currentNotification;

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
  acc_threshold: { value: 35, type: "NUMBER", allowedRange: [1, 100] },
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
    allowedRange: [1, 32],
  },
  tele_power_level: {
    value: 20,
    type: "NUMBER",
    allowedRange: [-20, 22],
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
    allowedRange: [1, 32],
  },
  rec_speed: {
    value: "100 Hz",
    type: "SELECT",
    allowedValues: ["OFF", "10 Hz", "50 Hz", "100 Hz"],
  },
  rec_elements: {
    value: 65504,
    type: "NUMBER",
    allowedRange: [0, 131071],
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
      arrayLength: 8,
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
      allowedRange: [0, 60000],
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
  queueMicrotask(() => lines.forEach((line) => commandEngine?.receive(line)));
}

function createCommandEngine(write) {
  return new BoardCommandEngine({
    write,
    parsePrompt: parsePromptCommand,
    normalizeCommand: normalizeBoardCommand,
    timeoutMs: 2500,
    retries: 1,
  });
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

  const candidatePort = new SerialPort(
    { ...CONFIG, path: serialPath },
    (error) => {
      if (!error) return;
      if (port === candidatePort) port = null;
      commandEngine?.cancel(error);
      commandEngine = null;
      sendToRenderer(IPC_CHANNELS.SERIAL_ERROR, error.message);
    },
  );
  port = candidatePort;
  commandEngine = createCommandEngine((boardCommand) =>
    writeSerialCommand(candidatePort, boardCommand),
  );
  parser = candidatePort.pipe(
    new ReadlineParser({ delimiter: "\r\n", encoding: "utf8" }),
  );
  parser.on("data", onData);

  candidatePort.on("error", (error) => {
    sendToRenderer(IPC_CHANNELS.SERIAL_ERROR, error.message);
    commandEngine?.cancel(error);
    if (candidatePort.isOpen) candidatePort.close();
    else if (!candidatePort.opening && port === candidatePort) {
      port = null;
      parser = null;
      commandEngine = null;
    }
  });
  candidatePort.on("open", () => {
    candidatePort.write("\n");
    sendToRenderer(IPC_CHANNELS.SERIAL_CONNECTED);
    void identifyBoard();
  });
  candidatePort.on("close", () => {
    if (port === candidatePort) port = null;
    parser = null;
    commandEngine?.cancel();
    commandEngine = null;
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
  commandEngine?.cancel();
  if (useFakeSerial) {
    commandEngine = null;
    queueMicrotask(() => {
      sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, false);
      sendToRenderer(IPC_CHANNELS.SERIAL_DISCONNECTED);
    });
    return;
  }
  if (port && port.isOpen) port.close();
}

function onData(data) {
  if (commandEngine?.receive(data)) return;
  if (data.includes("CATS is now ready")) void identifyBoard();
}

function requireCommandEngine() {
  if (!commandEngine) throw new Error("Serial port is not connected.");
  return commandEngine;
}

function emitConfig(config) {
  sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_DATA, config);
  return config;
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
  if (boardCommand === "dump") {
    const start = output.indexOf("#Configuration dump");
    const end = output.indexOf("#End of configuration dump");
    const lines = output.slice(start + 1, end < 0 ? undefined : end);
    saveDumpDataToFile(lines.join("\n"));
    sendToRenderer(IPC_CHANNELS.BOARD_DUMP_COMPLETE);
    return lines;
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
  const response = await requireCommandEngine().run(boardCommand, {
    timeoutMs: 5000,
    retries: 0,
  });
  if (useFakeSerial) {
    sendToRenderer(IPC_CHANNELS.SERIAL_DATA, `test> ${boardCommand}`);
  }
  response.output.forEach((line) =>
    sendToRenderer(IPC_CHANNELS.SERIAL_DATA, line),
  );
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
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError(
      "Configuration transaction requires at least one value.",
    );
  }
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
        const response = await execute(`set ${entry.key} = ${entry.value}`);
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

async function restoreBoardConfiguration() {
  const selection = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "CATS configuration", extensions: ["txt"] }],
  });
  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true };
  }

  const data = await fs.promises.readFile(selection.filePaths[0], "utf8");
  const commands = data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  await requireCommandEngine().transaction(async (execute) => {
    for (const boardCommand of commands) await execute(boardCommand);
    if (!commands.includes("save")) await execute("save");
  });
  return { canceled: false };
}

function saveDumpDataToFile(data) {
  const paths = dialog.showOpenDialogSync({ properties: ["openDirectory"] });
  if (!paths) throw new Error("No directory selected for backup.");
  fs.writeFileSync(path.join(paths[0], "backup_cats_config.txt"), data);
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
  cliCommand,
  command,
  connect,
  disconnect,
  getList,
  restoreBoardConfiguration,
  setSerialWindow,
};
