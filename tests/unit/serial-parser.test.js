import { describe, expect, it } from "vitest";
import {
  parseAllowedLength,
  parseAllowedRange,
  parseAllowedValues,
  parseCommand,
  parseConfigValue,
  parseData,
  parseEventData,
} from "@/modules/serial-parser.js";

describe("serial response parsing", () => {
  it("normalizes command confirmations", () => {
    expect(parseCommand("^._.^ > GET main_altitude")).toBe("get_main_altitude");
    expect(parseCommand("not a prompt")).toBeUndefined();
  });

  it("parses configuration metadata, including negative ranges", () => {
    expect(parseConfigValue("main_altitude = 250")).toEqual({
      key: "main_altitude",
      value: "250",
    });
    expect(parseAllowedValues("Allowed values: OFF, ON")).toEqual([
      "OFF",
      "ON",
    ]);
    expect(parseAllowedRange("Allowed range: -10 - 25.5")).toEqual([-10, 25.5]);
    expect(parseAllowedLength("Array length: 8")).toBe(8);
  });

  it("converts event data into configured actions", () => {
    expect(parseEventData("1,500,0,0", 4)).toMatchObject({
      values: [1, 500],
      actions: [{ index: 1, value: 500, name: "Delay" }],
    });
    expect(parseData("status", "Ready\nNominal\n")).toEqual({
      key: "status",
      value: ["Ready", "Nominal"],
    });
  });
});
