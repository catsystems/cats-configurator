import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@/shared/ipc.js";
import { PROFILE_BOARD_KEYS } from "@/modules/settings.js";

const serialState = vi.hoisted(() => ({
  instances: [],
  notifications: [],
  parser: null,
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => process.env.TEMP),
  },
  Notification: class {
    constructor(payload) {
      serialState.notifications.push(payload);
    }

    show() {}
    close() {}
  },
}));

vi.mock("serialport", async () => {
  const { EventEmitter } = await vi.importActual("node:events");

  class MockReadlineParser extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
    }
  }

  class MockSerialPort extends EventEmitter {
    constructor(options, callback) {
      super();
      this.path = options.path;
      this.isOpen = false;
      this.opening = true;
      this.callback = callback;
      this.write = vi.fn();
      serialState.instances.push(this);
    }

    pipe(parser) {
      serialState.parser = parser;
      return parser;
    }

    openSuccessfully() {
      this.opening = false;
      this.isOpen = true;
      this.callback?.(null);
      this.emit("open");
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.emit("close");
    }

    static async list() {
      return [];
    }
  }

  return { SerialPort: MockSerialPort, ReadlineParser: MockReadlineParser };
});

describe("serial board identification", () => {
  let serial;
  let sent;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    serialState.instances.length = 0;
    serialState.notifications.length = 0;
    serialState.parser = null;
    sent = [];
    serial = await import("@/modules/serial.js");
    serial.setSerialWindow({
      isDestroyed: () => false,
      webContents: { send: (...args) => sent.push(args) },
    });
  });

  function respond(command, output) {
    serialState.parser.emit("data", `^._.^:/> ${command}`);
    output.forEach((line) => serialState.parser.emit("data", line));
    serialState.parser.emit("data", "^._.^:/>");
  }

  function configOutput(key) {
    if (key.startsWith("ev_")) {
      return [`${key} = 0,0`, "Array length: 16"];
    }
    if (key.endsWith("_duration")) {
      return [`${key} = 1000`, "Allowed range: 0 - 1200000"];
    }
    if (/^timer[1-4]_(start|trigger)$/.test(key)) {
      return [`${key} = READY`, "Allowed values: CALIBRATE, READY, LIFTOFF"];
    }
    if (["tele_link_phrase", "tele_test_phrase"].includes(key)) {
      return [`${key} = cats1234`, "String length: 4 - 16"];
    }
    if (
      ["tele_enable", "tele_adaptive_power", "test_mode", "rec_speed"].includes(
        key,
      )
    ) {
      return [`${key} = OFF`, "Allowed values: OFF, ON"];
    }
    return [`${key} = 0`, "Allowed range: 0 - 4294967295"];
  }

  async function identify(port) {
    port.openSuccessfully();
    respond("version", ["Board: CATS Vega", "Firmware: test"]);
    await vi.waitFor(() =>
      expect(sent).toContainEqual([IPC_CHANNELS.BOARD_ACTIVE, true]),
    );
  }

  it("times out and closes a silent serial device", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    port.openSuccessfully();

    await vi.advanceTimersByTimeAsync(5000);

    expect(sent).toContainEqual([
      IPC_CHANNELS.SERIAL_ERROR,
      "CATS Vega did not respond within five seconds.",
    ]);
    expect(sent).toContainEqual([IPC_CHANNELS.SERIAL_DISCONNECTED, undefined]);
    expect(port.isOpen).toBe(false);
  });

  it("accepts a CATS version response and cancels the timeout", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    await vi.advanceTimersByTimeAsync(5000);

    expect(sent).toContainEqual([IPC_CHANNELS.BOARD_ACTIVE, true]);
    expect(
      sent.some(
        ([channel, message]) =>
          channel === IPC_CHANNELS.SERIAL_ERROR &&
          message.includes("did not respond"),
      ),
    ).toBe(false);
    expect(port.isOpen).toBe(true);
    serial.disconnect();
  });

  it("loads all settings with one bulk get and falls back only for a missing key", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const missingKey = PROFILE_BOARD_KEYS.at(-1);
    const read = serial.readBoardConfigurations();
    await vi.waitFor(() =>
      expect(port.write).toHaveBeenCalledWith("get\n", expect.any(Function)),
    );
    respond(
      "get",
      PROFILE_BOARD_KEYS.filter((key) => key !== missingKey).flatMap(
        configOutput,
      ),
    );
    await vi.waitFor(() =>
      expect(port.write).toHaveBeenCalledWith(
        `get ${missingKey}\n`,
        expect.any(Function),
      ),
    );
    respond(`get ${missingKey}`, configOutput(missingKey));

    await expect(read).resolves.toMatchObject({
      configs: expect.arrayContaining([
        expect.objectContaining({ key: missingKey }),
      ]),
      unsupportedKeys: [],
    });
    expect(sent).toContainEqual([
      IPC_CHANNELS.BOARD_CONFIG_DATA,
      expect.arrayContaining([expect.objectContaining({ key: missingKey })]),
    ]);
    expect(
      port.write.mock.calls.filter(([command]) => command.startsWith("get ")),
    ).toHaveLength(1);
  });

  it("removes a Vega flight log and its matching stats file", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const removal = serial.removeBoardFlightLog("fl7.cfl");
    for (const [command, output] of [
      ["ls /flights", ["file 22 flight_00007"]],
      ["rm /stats/stats_00007.txt", ["File '/stats/stats_00007.txt' removed!"]],
      [
        "rm /configs/flight_00007.cfg",
        ["File '/configs/flight_00007.cfg' removed!"],
      ],
      ["rm /flights/flight_00007", ["File '/flights/flight_00007' removed!"]],
    ]) {
      await vi.waitFor(() =>
        expect(port.write).toHaveBeenCalledWith(
          `${command}\n`,
          expect.any(Function),
        ),
      );
      respond(command, output);
    }

    await expect(removal).resolves.toEqual({
      ok: true,
      flightPath: "/flights/flight_00007",
      statsPath: "/stats/stats_00007.txt",
      configPath: "/configs/flight_00007.cfg",
      statsName: "st007.txt",
    });
  });

  it("refuses an ambiguous wrapped Vega flight-log alias", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const removal = serial.removeBoardFlightLog("fl1.cfl");
    await vi.waitFor(() =>
      expect(port.write).toHaveBeenCalledWith(
        "ls /flights\n",
        expect.any(Function),
      ),
    );
    respond("ls /flights", ["flight_00001", "flight_00257"]);

    await expect(removal).rejects.toThrow(/more than one Vega flight/i);
    expect(
      port.write.mock.calls.some(([command]) => command.startsWith("rm ")),
    ).toBe(false);
  });

  it("treats a stale mounted alias as already removed", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const removal = serial.removeBoardFlightLog("fl10.cfl");
    await vi.waitFor(() =>
      expect(port.write).toHaveBeenCalledWith(
        "ls /flights\n",
        expect.any(Function),
      ),
    );
    respond("ls /flights", ["dir .", "dir .."]);

    await expect(removal).resolves.toEqual({
      ok: true,
      alreadyMissing: true,
      flightPath: null,
      statsPath: null,
      configPath: null,
      statsName: "st010.txt",
    });
    expect(
      port.write.mock.calls.some(([command]) => command.startsWith("rm ")),
    ).toBe(false);
  });

  it("does not trust the Vega's success line after a removal failure", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const removal = serial.removeBoardFlightLog("fl7.cfl");
    for (const [command, output] of [
      ["ls /flights", ["flight_00007"]],
      [
        "rm /stats/stats_00007.txt",
        [
          "Removal of file '/stats/stats_00007.txt' failed with -5",
          "File '/stats/stats_00007.txt' removed!",
        ],
      ],
    ]) {
      await vi.waitFor(() =>
        expect(port.write).toHaveBeenCalledWith(
          `${command}\n`,
          expect.any(Function),
        ),
      );
      respond(command, output);
    }

    await expect(removal).rejects.toThrow(/could not remove/i);
    expect(
      port.write.mock.calls.some(
        ([command]) => command === "rm /flights/flight_00007\n",
      ),
    ).toBe(false);
  });

  it("rejects and closes a responsive non-CATS device", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    port.openSuccessfully();
    respond("version", ["Board: Other"]);

    await vi.waitFor(() => {
      expect(sent).toContainEqual([
        IPC_CHANNELS.SERIAL_ERROR,
        "The selected serial device is not a CATS flight computer.",
      ]);
      expect(port.isOpen).toBe(false);
    });
  });

  it("closes an errored connection and cancels identification", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    port.openSuccessfully();
    port.emit("error", new Error("Serial link failed"));

    await vi.advanceTimersByTimeAsync(5000);

    expect(sent).toContainEqual([
      IPC_CHANNELS.SERIAL_ERROR,
      "Serial link failed",
    ]);
    expect(port.isOpen).toBe(false);
    expect(
      sent.some(
        ([channel, message]) =>
          channel === IPC_CHANNELS.SERIAL_ERROR &&
          message.includes("did not respond"),
      ),
    ).toBe(false);
  });

  it("accepts the expected disconnect after a CLI reboot command", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const reboot = serial.cliCommand("reboot");
    await vi.waitFor(() =>
      expect(port.write).toHaveBeenCalledWith("reboot\n", expect.any(Function)),
    );
    port.close();

    await expect(reboot).resolves.toEqual([]);
    expect(sent).toContainEqual([IPC_CHANNELS.SERIAL_DISCONNECTED, undefined]);
  });

  it("streams simulation output and allows up to five minutes of inactivity", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const simulation = serial.cliCommand("sim");
    await vi.waitFor(() =>
      expect(port.write).toHaveBeenCalledWith("sim\n", expect.any(Function)),
    );
    expect(serialState.parser.options.delimiter).toBe("\n");
    serialState.parser.emit("data", "^._.^:/> sim\r");
    serialState.parser.emit(
      "data",
      "[100]: height: 1.000000, velocity: 2.000000, offset: 0.100000\r",
    );

    expect(sent).toContainEqual([
      IPC_CHANNELS.SERIAL_DATA,
      "[100]: height: 1.000000, velocity: 2.000000, offset: 0.100000",
    ]);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    serialState.parser.emit(
      "data",
      "[200]: height: 2.000000, velocity: 3.000000, offset: 0.200000",
    );
    serialState.parser.emit("data", "^._.^:/> \r");

    await expect(simulation).resolves.toHaveLength(2);
    expect(
      sent.filter(([channel]) => channel === IPC_CHANNELS.SERIAL_DATA),
    ).toEqual([
      [
        IPC_CHANNELS.SERIAL_DATA,
        "[100]: height: 1.000000, velocity: 2.000000, offset: 0.100000",
      ],
      [
        IPC_CHANNELS.SERIAL_DATA,
        "[200]: height: 2.000000, velocity: 3.000000, offset: 0.200000",
      ],
    ]);
  });

  it("waits for a delayed flash save before verifying a transaction", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const transaction = serial.applyConfiguration([
      { key: "timer4_start", value: "LIFTOFF" },
      { key: "timer4_duration", value: 1000 },
      { key: "timer4_trigger", value: "APOGEE" },
    ]);

    for (const [command, output] of [
      ["set timer4_start = LIFTOFF", ["timer4_start set to LIFTOFF"]],
      ["set timer4_duration = 1000", ["timer4_duration set to 1000"]],
      ["set timer4_trigger = APOGEE", ["timer4_trigger set to APOGEE"]],
      ["save", ["Successfully written to flash"]],
      [
        "get timer4_start",
        ["timer4_start = LIFTOFF", "Allowed values: READY, LIFTOFF, APOGEE"],
      ],
      [
        "get timer4_duration",
        ["timer4_duration = 1000", "Allowed range: 0 - 60000"],
      ],
      [
        "get timer4_trigger",
        ["timer4_trigger = APOGEE", "Allowed values: READY, LIFTOFF, APOGEE"],
      ],
    ]) {
      await vi.waitFor(() =>
        expect(port.write).toHaveBeenCalledWith(
          `${command}\n`,
          expect.any(Function),
        ),
      );
      if (command === "save") {
        serialState.parser.emit("data", `^._.^:/> ${command}`);
        await vi.advanceTimersByTimeAsync(100);
        output.forEach((line) => serialState.parser.emit("data", line));
        await vi.advanceTimersByTimeAsync(75);
      } else {
        respond(command, output);
      }
    }

    await expect(transaction).resolves.toMatchObject({
      ok: true,
      saved: true,
      results: [
        { key: "timer4_start", status: "verified" },
        { key: "timer4_duration", status: "verified" },
        { key: "timer4_trigger", status: "verified" },
      ],
    });
  });

  it("translates boolean profile values to the board's ON/OFF protocol", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const transaction = serial.applyConfiguration([
      { key: "test_mode", value: true },
    ]);
    for (const [command, output] of [
      ["set test_mode = ON", ["test_mode set to ON"]],
      ["save", ["Successfully written to flash"]],
      ["get test_mode", ["test_mode = ON", "Allowed values: OFF, ON"]],
    ]) {
      await vi.waitFor(() =>
        expect(port.write).toHaveBeenCalledWith(
          `${command}\n`,
          expect.any(Function),
        ),
      );
      respond(command, output);
    }

    await expect(transaction).resolves.toMatchObject({
      ok: true,
      results: [{ key: "test_mode", status: "verified" }],
    });
  });

  it("persists reset defaults before reporting success", async () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    const reset = serial.resetBoardConfiguration();
    for (const [command, output] of [
      ["defaults", ["Reset to default values"]],
      ["save", ["Successfully written to flash"]],
    ]) {
      await vi.waitFor(() =>
        expect(port.write).toHaveBeenCalledWith(
          `${command}\n`,
          expect.any(Function),
        ),
      );
      respond(command, output);
    }

    await expect(reset).resolves.toEqual({ ok: true, saved: true });
    expect(sent).toContainEqual([
      IPC_CHANNELS.BOARD_CONFIG_SAVED,
      { ok: true, saved: true },
    ]);
  });
});
