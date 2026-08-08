import process from "node:process";
import { ReadlineParser, SerialPort } from "serialport";

const portPath = process.argv[2];
if (!portPath) {
  console.error("Usage: npm run test:hardware -- COM4");
  process.exit(2);
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const port = new SerialPort({
  path: portPath,
  baudRate: 115200,
  autoOpen: false,
});
const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));
const lines = [];
parser.on("data", (line) => lines.push(line));

await new Promise((resolve, reject) => {
  port.open((error) => (error ? reject(error) : resolve()));
});

try {
  port.write("\n");
  await delay(150);
  port.write("version\n");
  await delay(1200);
  port.write("status\n");
  await delay(1200);
} finally {
  await new Promise((resolve) => port.close(() => resolve()));
}

console.log(lines.join("\n"));
if (!lines.some((line) => /Board:\s*CATS/i.test(line))) {
  console.error(`No CATS board identity received from ${portPath}.`);
  process.exit(1);
}
