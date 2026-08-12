import process from "node:process";
import { ReadlineParser, SerialPort } from "serialport";

import { BoardCommandEngine } from "../../src/modules/board-command-engine.js";
import {
  normalizeBoardCommand,
  parseConfigResponse,
  parsePromptCommand,
} from "../../src/modules/serial-parser.js";
import { PROFILE_BOARD_KEYS } from "../../src/modules/settings.js";
import {
  compareConfigurationProfile,
  createConfigurationProfile,
  parseBoardIdentity,
  validateConfigurationProfile,
} from "../../src/shared/configuration-profile.js";

const portPath = process.argv[2];
if (!portPath) {
  console.error("Usage: npm run test:hardware:profile -- COM4");
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

  const profile = createConfigurationProfile(snapshot, {
    appVersion: "hardware-test",
  });
  validateConfigurationProfile(profile);
  const comparison = compareConfigurationProfile(profile, snapshot);
  if (comparison.compatibility.blocked) {
    throw new Error("A profile captured from this board is not compatible.");
  }
  if (comparison.compatibility.changedCount !== 0) {
    throw new Error("A newly captured profile differs from its source board.");
  }
  if (comparison.rows.length !== PROFILE_BOARD_KEYS.length) {
    throw new Error("The captured profile does not contain every board field.");
  }

  console.log(
    "Read-only profile capture passed on " +
      portPath +
      ": " +
      comparison.rows.length +
      " fields from " +
      snapshot.board.model +
      " " +
      snapshot.board.firmwareVersion +
      ".",
  );
} finally {
  engine.cancel();
  await new Promise((resolve) => port.close(() => resolve()));
}
