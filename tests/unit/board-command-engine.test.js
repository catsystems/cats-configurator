import { describe, expect, it, vi } from "vitest";
import {
  BoardCommandEngine,
  BoardCommandError,
} from "@/modules/board-command-engine.js";
import {
  normalizeBoardCommand,
  parsePromptCommand,
} from "@/modules/serial-parser.js";

function createHarness(options = {}) {
  const writes = [];
  const engine = new BoardCommandEngine({
    write: (command) => writes.push(command),
    parsePrompt: parsePromptCommand,
    normalizeCommand: normalizeBoardCommand,
    timeoutMs: 100,
    retries: 0,
    ...options,
  });
  return { engine, writes };
}

function respond(engine, command, output = []) {
  engine.receive(`^._.^:/> ${command}`);
  output.forEach((line) => engine.receive(line));
  engine.receive("^._.^:/> ");
}

describe("BoardCommandEngine", () => {
  it("serializes commands and accepts a trailing prompt", async () => {
    const { engine, writes } = createHarness();
    const first = engine.run("get timer1_start");
    const second = engine.run("get timer4_trigger");

    expect(writes).toEqual(["get timer1_start"]);
    respond(engine, "get timer1_start", [
      "timer1_start = LIFTOFF",
      "Allowed values: READY, LIFTOFF",
    ]);
    await expect(first).resolves.toMatchObject({ attempts: 1 });
    await vi.waitFor(() => expect(writes).toHaveLength(2));

    respond(engine, "get timer4_trigger", [
      "timer4_trigger = APOGEE",
      "Allowed values: APOGEE, TOUCHDOWN",
    ]);
    await expect(second).resolves.toMatchObject({
      output: ["timer4_trigger = APOGEE", "Allowed values: APOGEE, TOUCHDOWN"],
    });
  });

  it("completes after output settles when the board emits no trailing prompt", async () => {
    vi.useFakeTimers();
    const { engine } = createHarness({ settleMs: 25 });
    const result = engine.run("version");

    engine.receive("^._.^:/> version");
    engine.receive("Board: CATS Vega");
    engine.receive("Code version: 3.0.2");
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toMatchObject({
      output: ["Board: CATS Vega", "Code version: 3.0.2"],
    });
    vi.useRealTimers();
  });

  it("waits for slow command output after receiving the command echo", async () => {
    vi.useFakeTimers();
    const { engine } = createHarness({ settleMs: 25 });
    const result = engine.run("save");
    let completed = false;
    void result.then(() => {
      completed = true;
    });

    engine.receive("^._.^:/> save");
    await vi.advanceTimersByTimeAsync(50);
    expect(completed).toBe(false);

    engine.receive("Successfully written to flash");
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toMatchObject({
      output: ["Successfully written to flash"],
    });
    vi.useRealTimers();
  });

  it("accepts a warm-reconnect echo and splits batched response lines", async () => {
    vi.useFakeTimers();
    const { engine } = createHarness({ settleMs: 25 });
    const result = engine.run("get timer4_duration");

    engine.receive("get timer4_duration");
    engine.receive("timer4_duration = 1000\nAllowed range: 0 - 60000\n");
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toMatchObject({
      output: ["timer4_duration = 1000", "Allowed range: 0 - 60000"],
    });
    vi.useRealTimers();
  });

  it("runs transactions without allowing polls to interleave", async () => {
    const { engine, writes } = createHarness();
    const transaction = engine.transaction(async (execute) => {
      const first = execute("set timer4_duration = 1000");
      respond(engine, "set timer4_duration = 1000", [
        "timer4_duration set to 1000",
      ]);
      await first;
      const second = execute("save");
      respond(engine, "save", ["Successfully written to flash"]);
      await second;
      return "saved";
    });

    await expect(engine.poll("status")).resolves.toBeNull();
    await expect(transaction).resolves.toBe("saved");
    expect(writes).toEqual(["set timer4_duration = 1000", "save"]);
  });

  it("retries timed-out commands and reports protocol errors", async () => {
    vi.useFakeTimers();
    const { engine, writes } = createHarness({ retries: 1 });
    const command = engine.run("get main_altitude");

    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual(["get main_altitude", "get main_altitude"]);
    respond(engine, "get main_altitude", [
      "main_altitude = 200",
      "Allowed range: 10 - 65535",
    ]);
    await expect(command).resolves.toMatchObject({ attempts: 2 });

    const invalid = engine.run("set timer4_bad = 1");
    respond(engine, "set timer4_bad = 1", ["ERROR IN set: INVALID NAME"]);
    await expect(invalid).rejects.toBeInstanceOf(BoardCommandError);
    vi.useRealTimers();
  });

  it("cancels the active command and queued work on disconnect", async () => {
    const { engine } = createHarness();
    const active = engine.run("status");
    const queued = engine.run("get main_altitude");
    engine.cancel();

    await expect(active).rejects.toThrow("Board connection closed");
    await expect(queued).rejects.toThrow("Board connection closed");
  });
});
