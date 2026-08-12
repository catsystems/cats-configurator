import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IPC_CHANNELS } from "@/shared/ipc.js";

const serialState = vi.hoisted(() => ({
  instances: [],
  notifications: [],
  openDialogResult: { canceled: true, filePaths: [] },
  parser: null,
}));

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(() => serialState.openDialogResult),
    showOpenDialogSync: vi.fn(),
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

  class MockReadlineParser extends EventEmitter {}

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
    serialState.openDialogResult = { canceled: true, filePaths: [] };
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

  it("writes, saves, and verifies timer 4 as one transaction", async () => {
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
      respond(command, output);
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

  it("restores text backups through verified configuration writes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cats-restore-"));
    const backupPath = path.join(directory, "backup.txt");
    await fs.writeFile(backupPath, "set timer4_duration = 1200\n");
    serialState.openDialogResult = {
      canceled: false,
      filePaths: [backupPath],
    };
    serial.connect("COM4");
    const port = serialState.instances[0];
    await identify(port);

    try {
      const restore = serial.restoreBoardConfiguration();
      for (const [command, output] of [
        ["set timer4_duration = 1200", ["timer4_duration set to 1200"]],
        ["save", ["Successfully written to flash"]],
        [
          "get timer4_duration",
          ["timer4_duration = 1200", "Allowed range: 0 - 1200000"],
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

      await expect(restore).resolves.toMatchObject({
        canceled: false,
        ok: true,
        saved: true,
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects non-configuration commands in text backups", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cats-restore-"));
    const backupPath = path.join(directory, "backup.txt");
    await fs.writeFile(backupPath, "reboot\n");
    serialState.openDialogResult = {
      canceled: false,
      filePaths: [backupPath],
    };

    try {
      await expect(serial.restoreBoardConfiguration()).rejects.toThrow(
        "Only configuration values can be restored",
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
