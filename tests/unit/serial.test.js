import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@/shared/ipc.js";

const serialState = vi.hoisted(() => ({
  instances: [],
  notifications: [],
  parser: null,
}));

vi.mock("electron", () => ({
  dialog: { showOpenDialogSync: vi.fn() },
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
    serialState.parser = null;
    sent = [];
    serial = await import("@/modules/serial.js");
    serial.setSerialWindow({
      isDestroyed: () => false,
      webContents: { send: (...args) => sent.push(args) },
    });
  });

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
    port.openSuccessfully();
    serialState.parser.emit("data", "version");
    serialState.parser.emit("data", "Board: CATS Vega\nFirmware: test");

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

  it("rejects and closes a responsive non-CATS device", () => {
    serial.connect("COM4");
    const port = serialState.instances[0];
    port.openSuccessfully();
    serialState.parser.emit("data", "version");
    serialState.parser.emit("data", "Board: Other");

    expect(sent).toContainEqual([
      IPC_CHANNELS.SERIAL_ERROR,
      "The selected serial device is not a CATS flight computer.",
    ]);
    expect(port.isOpen).toBe(false);
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
});
