import { describe, expect, it } from "vitest";
import { parseFlightLog } from "@/modules/logparser.js";

function flightInfoFixture() {
  const buffer = Buffer.alloc(22);
  buffer.write("v", 0, "ascii");
  buffer.writeUInt8(0, 1);
  buffer.writeUInt32LE(1000, 2);
  buffer.writeUInt32LE(1 << 6, 6);
  buffer.writeFloatLE(123.5, 10);
  buffer.writeFloatLE(45.25, 14);
  buffer.writeFloatLE(9.81, 18);
  return buffer.toString("binary");
}

describe("CFL parser", () => {
  it("parses and time-normalizes a flight-info record", () => {
    const flightLog = parseFlightLog(flightInfoFixture());

    expect(flightLog.flightInfo).toHaveLength(1);
    expect(flightLog.flightInfo[0]).toMatchObject({
      ts: 0,
      height: 123.5,
      velocity: 45.25,
    });
    expect(flightLog.flightInfo[0].acceleration).toBeCloseTo(9.81, 4);
    expect(flightLog.firstTs).toBe(0);
    expect(flightLog.lastTs).toBe(0);
  });
});
