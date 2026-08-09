import { describe, expect, it } from "vitest";
import {
  allowManualVegaConnection,
  createVegaPresenceState,
  getAutoConnectCandidate,
  getSerialPortIdentity,
  getSerialPortLabel,
  isVegaSerialPort,
  markVegaConnectionAttempt,
  normalizeUsbId,
  reconcileVegaCandidates,
  suppressVegaAutoConnect,
} from "@/modules/vega-autodetect.js";

function vega(path = "COM4", overrides = {}) {
  return {
    path,
    vendorId: "CAFE",
    productId: "4003",
    serialNumber: `serial-${path}`,
    locationId: `location-${path}`,
    ...overrides,
  };
}

describe("Vega serial auto-detection", () => {
  it("normalizes USB identifiers without accepting malformed values", () => {
    expect(normalizeUsbId("0xcafe")).toBe("CAFE");
    expect(normalizeUsbId("3")).toBe("0003");
    expect(normalizeUsbId(0x4003)).toBe("4003");
    expect(normalizeUsbId("not-an-id")).toBeNull();
  });

  it("matches only the supported Vega USB identity", () => {
    expect(isVegaSerialPort(vega())).toBe(true);
    expect(isVegaSerialPort(vega("COM5", { productId: "4002" }))).toBe(false);
    expect(isVegaSerialPort({ path: "COM6" })).toBe(false);
    expect(getSerialPortLabel(vega())).toBe("CATS Vega (COM4)");
    expect(getSerialPortLabel({ path: "COM6" })).toBe("COM6");
  });

  it("uses serial number, location, then path as the stable identity", () => {
    expect(getSerialPortIdentity(vega())).toBe("CAFE:4003:serial-COM4");
    expect(
      getSerialPortIdentity(
        vega("COM4", { serialNumber: undefined, locationId: "usb-1" }),
      ),
    ).toBe("CAFE:4003:usb-1");
    expect(
      getSerialPortIdentity(
        vega("COM4", { serialNumber: undefined, locationId: undefined }),
      ),
    ).toBe("CAFE:4003:COM4");
  });

  it("auto-connects only one unattempted Vega per presence interval", () => {
    const state = createVegaPresenceState();
    const [candidate] = reconcileVegaCandidates(state, [vega()]);

    expect(getAutoConnectCandidate(state, [candidate])).toBe(candidate);
    markVegaConnectionAttempt(state, candidate.port);
    expect(getAutoConnectCandidate(state, [candidate])).toBeNull();

    reconcileVegaCandidates(state, []);
    const [replugged] = reconcileVegaCandidates(state, [vega()]);
    expect(getAutoConnectCandidate(state, [replugged])).toBe(replugged);
  });

  it("requires selection when multiple Vegas are connected", () => {
    const state = createVegaPresenceState();
    const candidates = reconcileVegaCandidates(state, [
      vega("COM4"),
      vega("COM5"),
    ]);

    expect(getAutoConnectCandidate(state, candidates)).toBeNull();
  });

  it("suppresses manual disconnects until replug while permitting manual connect", () => {
    const state = createVegaPresenceState();
    const port = vega();
    let [candidate] = reconcileVegaCandidates(state, [port]);
    suppressVegaAutoConnect(state, port);

    expect(getAutoConnectCandidate(state, [candidate])).toBeNull();
    allowManualVegaConnection(state, port);
    expect(state.suppressedIds.size).toBe(0);

    suppressVegaAutoConnect(state, port);
    reconcileVegaCandidates(state, []);
    [candidate] = reconcileVegaCandidates(state, [port]);
    expect(getAutoConnectCandidate(state, [candidate])).toBe(candidate);
  });
});
