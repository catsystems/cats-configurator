import { describe, expect, it } from "vitest";
import {
  parseAllowedLength,
  parseAllowedRange,
  parseAllowedValues,
  parseCommand,
  parseConfigResponse,
  parseConfigResponses,
  parseConfigValue,
  parseData,
  parseEventData,
  parsePromptCommand,
} from "@/modules/serial-parser.js";

describe("serial response parsing", () => {
  it("normalizes command confirmations", () => {
    expect(parseCommand("^._.^ > GET main_altitude")).toBe("get_main_altitude");
    expect(parseCommand("not a prompt")).toBeUndefined();
    expect(parsePromptCommand("^._.^:/> set timer4_duration = 1000")).toBe(
      "set timer4_duration = 1000",
    );
    expect(parsePromptCommand("^._.^:/> ")).toBe("");
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

  it("parses a complete configuration response", () => {
    expect(
      parseConfigResponse([
        "timer4_duration = 1000",
        "Allowed range: 0 - 60000",
      ]),
    ).toEqual({
      key: "timer4_duration",
      value: 1000,
      type: "NUMBER",
      allowedRange: [0, 60000],
    });
    expect(
      parseConfigResponse(["ev_apogee = 2,1,7,2", "Array length: 8"]),
    ).toMatchObject({
      key: "ev_apogee",
      type: "EVENT",
      values: [2, 1, 7, 2],
    });
  });

  it("parses every configuration from a bulk get response", () => {
    expect(
      parseConfigResponses([
        "main_altitude = 200",
        "Allowed range: 10 - 65535",
        "",
        "tele_enable = ON",
        "Allowed values: OFF, ON",
        "",
        "ev_apogee = 2,1,7,2",
        "Array length: 8",
        "set_by_user: TRUE",
      ]),
    ).toEqual([
      {
        key: "main_altitude",
        value: 200,
        type: "NUMBER",
        allowedRange: [10, 65535],
      },
      {
        key: "tele_enable",
        value: "ON",
        type: "SELECT",
        allowedValues: ["OFF", "ON"],
      },
      expect.objectContaining({
        key: "ev_apogee",
        type: "EVENT",
        values: [2, 1, 7, 2],
      }),
    ]);
  });

  it("rejects duplicate values in a bulk get response", () => {
    expect(() =>
      parseConfigResponses([
        "main_altitude = 200",
        "Allowed range: 10 - 65535",
        "main_altitude = 250",
        "Allowed range: 10 - 65535",
      ]),
    ).toThrow("duplicate configuration value: main_altitude");
  });
});
