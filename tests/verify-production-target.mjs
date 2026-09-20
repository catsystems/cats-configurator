import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CATS_FLIGHTS_ORIGIN,
  CATS_FLIGHTS_HOME_URL,
  CATS_FLIGHTS_ANALYZE_URL,
} from "../src/shared/flights.js";

const outputRoot = path.resolve("dist");
const productionOrigin = "https://catsystems.io";
assert.equal(CATS_FLIGHTS_ORIGIN, productionOrigin);
assert.equal(CATS_FLIGHTS_HOME_URL, `${productionOrigin}/flights`);
assert.equal(CATS_FLIGHTS_ANALYZE_URL, `${productionOrigin}/flights/analyze`);

async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(candidate);
      return /\.(?:css|html|js)$/.test(entry.name) ? [candidate] : [];
    }),
  );
  return files.flat();
}

const files = await sourceFiles(outputRoot);
const contents = await Promise.all(
  files.map((file) => fs.readFile(file, "utf8")),
);
assert.equal(
  contents.some((content) => content.includes(productionOrigin)),
  true,
  "Built output does not contain the CATS Flights production origin.",
);
assert.equal(
  contents.some((content) => content.includes("https://flights.catsystems.io")),
  false,
  "Built output still contains the old CATS Flights origin.",
);

console.log("CATS Flights production origin verified.");
