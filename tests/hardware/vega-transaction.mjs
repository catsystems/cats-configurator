import process from "node:process";
import { ReadlineParser, SerialPort } from "serialport";

import { BoardCommandEngine } from "../../src/modules/board-command-engine.js";
import {
  normalizeBoardCommand,
  parseConfigResponse,
  parsePromptCommand,
} from "../../src/modules/serial-parser.js";

const portPath = process.argv[2];
if (!portPath) {
  console.error("Usage: npm run test:hardware:transaction -- COM4");
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
      port.write(`${command}\n`, (error) =>
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

const keys = ["timer4_start", "timer4_duration", "timer4_trigger"];
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  port.write("\n");
  await delay(250);
  const version = await engine.run("version");
  if (!version.output.some((line) => /Board:\s*CATS Vega/i.test(line))) {
    throw new Error(`No CATS Vega identity received from ${portPath}.`);
  }

  const result = await engine.transaction(async (execute) => {
    const original = new Map();
    for (const key of keys) {
      const response = await execute(`get ${key}`);
      const config = parseConfigResponse(response.output);
      original.set(key, config.value);
    }

    for (const key of keys) {
      const value = original.get(key);
      const response = await execute(`set ${key} = ${value}`);
      if (!response.output.some((line) => /\bset to\b/i.test(line))) {
        throw new Error(`Board did not acknowledge ${key}.`);
      }
    }

    const save = await execute("save");
    if (!save.output.some((line) => /written to flash/i.test(line))) {
      throw new Error("Board did not confirm the flash save.");
    }

    const verified = {};
    for (const key of keys) {
      const response = await execute(`get ${key}`);
      const config = parseConfigResponse(response.output);
      if (String(config.value) !== String(original.get(key))) {
        throw new Error(`${key} changed during the same-value transaction.`);
      }
      verified[key] = config.value;
    }
    return verified;
  });

  console.log(`Transactional timer 4 verification passed on ${portPath}.`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  engine.cancel();
  await new Promise((resolve) => port.close(() => resolve()));
}
