import { describe, expect, it } from "vitest";
import {
  convertAccelerationToImperial,
  convertLengthToImperial,
  convertLengthToMetric,
  convertPressureToImperial,
  convertTemperatureToImperial,
  getDisplayValue,
} from "@/utils/unitConversions.js";

describe("unit conversions", () => {
  it("round-trips lengths and converts common telemetry values", () => {
    const feet = convertLengthToImperial(100);
    expect(convertLengthToMetric(feet)).toBeCloseTo(100, 8);
    expect(convertAccelerationToImperial(9.81)).toBeCloseTo(32.185, 2);
    expect(convertPressureToImperial(101.325)).toBeCloseTo(14.696, 2);
    expect(convertTemperatureToImperial(20)).toBe(68);
  });

  it("formats converted values with their unit", () => {
    expect(
      getDisplayValue(100, "altitude", { numeric: false, decimals: 1 }),
    ).toBe("328.1ft");
    expect(getDisplayValue(undefined, "altitude")).toBe("-");
  });
});
