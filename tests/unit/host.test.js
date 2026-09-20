import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), channels: [] }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class {
    constructor() {
      native.channels.push(this);
    }
  },
}));

beforeEach(async () => {
  vi.resetModules();
  native.channels.length = 0;
  native.invoke.mockReset().mockResolvedValue(null);
  await import("@/host.js");
});

describe("Tauri host bridge", () => {
  it("exposes only firmware selections and streams state with unsubscribe", async () => {
    const request = { deviceId: "device", assetId: 42, safetyConfirmed: true };
    await window.cats.firmware.start(request);
    expect(native.invoke).toHaveBeenLastCalledWith("firmware_start", {
      request,
    });
    const callback = vi.fn();
    const unsubscribe = window.cats.firmware.onState(callback);
    native.channels[0].onmessage({
      channel: "firmware:state",
      payload: { busy: true },
    });
    expect(callback).toHaveBeenCalledWith({ busy: true });
    unsubscribe();
    native.channels[0].onmessage({
      channel: "firmware:state",
      payload: { busy: false },
    });
    expect(callback).toHaveBeenCalledOnce();
  });
  it("initializes native events and forwards arguments to root host commands", async () => {
    expect(native.invoke).toHaveBeenCalledWith("initialize_host", {
      events: native.channels[0],
    });
    await window.cats.serial.connect("COM4");
    expect(native.invoke).toHaveBeenLastCalledWith("serial_connect", {
      portPath: "COM4",
    });
    await window.cats.flightLog.exportHtml("session-1", true);
    expect(native.invoke).toHaveBeenLastCalledWith("flight_log_export_html", {
      sessionId: "session-1",
      useImperialUnits: true,
    });
    expect(window.cats.updates).toBeUndefined();
  });

  it("delivers native events and removes subscriptions", () => {
    const callback = vi.fn();
    const unsubscribe = window.cats.board.onActive(callback);
    native.channels[0].onmessage({ channel: "board:active", payload: true });
    expect(callback).toHaveBeenCalledWith(true);
    unsubscribe();
    native.channels[0].onmessage({ channel: "board:active", payload: false });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("preserves native error codes and messages", async () => {
    native.invoke.mockRejectedValueOnce({
      code: "serial_busy",
      message: "Port is in use.",
    });
    await expect(window.cats.serial.connect("COM4")).rejects.toMatchObject({
      code: "serial_busy",
      message: "Port is in use.",
    });
  });
});
