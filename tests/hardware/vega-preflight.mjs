import process from "node:process";
import { ReadlineParser, SerialPort } from "serialport";

import { BoardCommandEngine } from "../../src/modules/board-command-engine.js";
import {
  normalizeBoardCommand,
  parseConfigResponse,
  parsePromptCommand,
} from "../../src/modules/serial-parser.js";
import { PROFILE_BOARD_KEYS } from "../../src/modules/settings.js";
import { parseBoardIdentity } from "../../src/shared/configuration-profile.js";
import { buildPreflightReport } from "../../src/shared/preflight.js";

const portPath = process.argv[2];
if (!portPath) {
  console.error("Usage: npm run test:hardware:preflight -- COM4");
  process.exit(2);
}

const port = new SerialPort({
  path: portPath,
  baudRate: 115200,
  autoOpen: false,
});
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
const engine = new BoardCommandEngine({
  write: (command) =>
    new Promise((resolve, reject) => {
      port.write(command + "\n", (error) =>
        error ? reject(error) : resolve(),
      );
    }),
  parsePrompt: parsePromptCommand,
  normalizeCommand: normalizeBoardCommand,
  timeoutMs: 5000,
  retries: 0,
  settleMs: 150,
});
parser.on("data", (line) => engine.receive(line));

await new Promise((resolve, reject) => {
  port.open((error) => (error ? reject(error) : resolve()));
});

try {
  port.write("\n");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const snapshot = await engine.transaction(async (execute) => {
    const version = await execute("version");
    const values = {};
    for (const key of PROFILE_BOARD_KEYS) {
      const response = await execute("get " + key);
      values[key] = parseConfigResponse(response.output).value;
    }
    return {
      board: parseBoardIdentity(version.output),
      values,
      unsupportedKeys: [],
    };
  });

  const report = buildPreflightReport(snapshot);
  if (!["READY", "WARNING"].includes(report.status)) {
    throw new Error("Preflight did not produce a valid overall result.");
  }
  if (report.checks.length < 6 || report.timeline.length < 7) {
    throw new Error("Preflight report is incomplete.");
  }

  console.log(
    "Read-only preflight passed on " +
      portPath +
      ": " +
      report.status +
      " (" +
      report.summary.warningCount +
      " warnings, " +
      report.summary.readyCount +
      " ready).",
  );
  for (const item of report.checks.filter(({ status }) => status !== "ready")) {
    console.log(
      item.status.toUpperCase() + ": " + item.title + " — " + item.detail,
    );
  }
} finally {
  engine.cancel();
  await new Promise((resolve) => port.close(() => resolve()));
}
