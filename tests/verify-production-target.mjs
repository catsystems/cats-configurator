import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve("out");
const productionOrigin = "https://flights.catsystems.io";
const stagingOrigin =
  "https://cats-flights-stage-7k2m9x4p.peppy-ridge-7142.chatgpt.site";

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
  contents.some((content) => content.includes(stagingOrigin)),
  false,
  "Production output contains the CATS Flights staging origin.",
);
assert.equal(
  contents.some((content) => content.includes(productionOrigin)),
  true,
  "Production output does not contain the CATS Flights production origin.",
);

console.log("Production CATS Flights target isolation verified.");
