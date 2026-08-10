import assert from "node:assert/strict";
import packageJson from "../package.json" with { type: "json" };

const [tagName] = process.argv.slice(2);
assert.ok(tagName, "release tag is required");

const normalizedTag = tagName.replace(/^v(?=\d)/i, "");
assert.equal(
  normalizedTag,
  packageJson.version,
  `release tag ${tagName} does not match package version ${packageJson.version}`,
);

console.log(`Release tag ${tagName} matches package version.`);
