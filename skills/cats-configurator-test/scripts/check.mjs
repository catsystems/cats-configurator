import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const usage = `Usage (from the CATS Configurator checkout):
  node skills/cats-configurator-test/scripts/check.mjs baseline
  node skills/cats-configurator-test/scripts/check.mjs vega --port PORT [--log FILE.cfl]
  node skills/cats-configurator-test/scripts/check.mjs gs
  node skills/cats-configurator-test/scripts/check.mjs fixture`;

const cargoTest = [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--locked",
];

function run(label, command, args, env = process.env) {
  console.log(`\n${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) console.error(result.error.message);
  const passed = result.status === 0;
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) process.exitCode = 1;
  return passed;
}

function npmInvocation(args) {
  // These arguments are fixed script names or flags with no user input.
  return process.platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", ["/d", "/c", `npm ${args.join(" ")}`]]
    : ["npm", args];
}

function baseline() {
  const [npm, versionArgs] = npmInvocation(["--version"]);
  const hasNpm = spawnSync(npm, versionArgs, { stdio: "ignore" }).status === 0;
  function check(script, localEntry, args = []) {
    if (hasNpm) return run(script, ...npmInvocation(["run", script]));
    return run(script, process.execPath, [localEntry, ...args]);
  }

  check("lint", "node_modules/eslint/bin/eslint.js", [
    ".",
    "--max-warnings",
    "0",
  ]);
  check("format:check", "node_modules/prettier/bin/prettier.cjs", [
    "--check",
    ".",
  ]);
  check("test", "node_modules/vitest/vitest.mjs", ["run"]);
  run("Native Rust tests", "cargo", cargoTest);
  check("verify:release-contract", "tests/verify-release-contract.mjs");
  if (check("build:frontend", "node_modules/vite/bin/vite.js", ["build"])) {
    check("verify:production-target", "tests/verify-production-target.mjs");
  }
}

function runHardwareChecks(label, cases, env = process.env) {
  const args = [...cargoTest, "--lib", "--", "--ignored", "--exact", ...cases];
  // libtest accepts a filter with zero matches, so verify the allowlist first.
  const listed = spawnSync("cargo", [...args, "--list"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env,
  });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) throw new Error(`Could not list ${label}.`);
  const selected = listed.stdout
    .split(/\r?\n/)
    .filter((line) => line.endsWith(": test"));
  if (
    selected.length !== cases.length ||
    cases.some((name) => !selected.includes(`${name}: test`))
  ) {
    throw new Error(
      `Expected tests for ${label} have changed. Check the current Rust test names.`,
    );
  }
  run(label, "cargo", [...args, "--nocapture", "--test-threads=1"], env);
}

function vega(args) {
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" }, log: { type: "string" } },
  });
  if (!values.port?.trim()) {
    throw new Error("Identify the connected test Vega and supply --port PORT.");
  }
  const cases = [
    "serial::tests::hardware_smoke_is_read_only",
    "serial::tests::hardware_connect_disconnect_cycles_are_reliable",
    "profile::tests::hardware_profile_and_preflight_are_read_only",
  ];
  const env = { ...process.env, CATS_VEGA_PORT: values.port };
  if (values.log) {
    const logPath = resolve(values.log);
    if (
      !logPath.toLowerCase().endsWith(".cfl") ||
      !statSync(logPath).isFile()
    ) {
      throw new Error("--log must point to a .cfl file.");
    }
    env.CATS_VEGA_LOG_PATH = logPath;
    cases.push("flight_log::tests::hardware_mounted_log_parses_read_only");
  } else {
    console.log("SKIP mounted Vega log parser (provide --log FILE.cfl).");
  }
  runHardwareChecks("Vega read-only hardware checks", cases, env);
}

function groundStation() {
  runHardwareChecks("Ground Station version.json read-only check", [
    "firmware::hardware::tests::gs_version_json_read_only",
  ]);
}

function makeFixture() {
  const folder = mkdtempSync(join(tmpdir(), "cats-configurator-test-"));
  const samples = [
    [1000, 0, 0, 0],
    [1500, 12, 4, 1],
    [2000, 4, -2, 0],
  ];
  const records = samples.map(
    ([milliseconds, height, velocity, acceleration]) => {
      // Each flight-information record is an eight-byte header and three f32s.
      const record = Buffer.alloc(20);
      record.writeUInt32LE(milliseconds, 0);
      record.writeUInt32LE(0x40, 4);
      record.writeFloatLE(height, 8);
      record.writeFloatLE(velocity, 12);
      record.writeFloatLE(acceleration, 16);
      return record;
    },
  );
  const flightLog = join(folder, "synthetic-configurator-test.cfl");
  const invalidLog = join(folder, "invalid-configurator-test.cfl");
  writeFileSync(flightLog, Buffer.concat([Buffer.from("3.1.0\0"), ...records]));
  writeFileSync(invalidLog, Buffer.alloc(0));
  console.log(JSON.stringify({ flightLog, invalidLog }, null, 2));
}

try {
  const [mode = "--help", ...args] = process.argv.slice(2);
  if (mode === "--help" || mode === "-h") {
    console.log(usage);
  } else {
    if (!["baseline", "vega", "gs", "fixture"].includes(mode)) {
      throw new Error(`Unknown mode ${mode}.\n${usage}`);
    }
    if (mode !== "vega" && args.length) {
      throw new Error(`${mode} takes no arguments.\n${usage}`);
    }
    if (mode !== "fixture") {
      const project = JSON.parse(readFileSync("package.json", "utf8"));
      if (project.name !== "cats-configurator") {
        throw new Error("Run this check from the CATS Configurator repo root.");
      }
    }
    if (mode === "baseline") baseline();
    if (mode === "vega") vega(args);
    if (mode === "gs") groundStation();
    if (mode === "fixture") makeFixture();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
