import { describe, expect, it } from "vitest";
import {
  assertBoardKey,
  assertBoardValue,
  assertNonEmptyString,
  assertRecord,
} from "@/shared/ipc.js";

describe("IPC contract validation", () => {
  it("accepts board-safe values", () => {
    expect(assertBoardKey("timer1_duration")).toBe("timer1_duration");
    expect(assertBoardValue(1000)).toBe(1000);
    expect(assertRecord({ key: "value" }, "Payload")).toEqual({ key: "value" });
  });

  it("rejects command injection and malformed payloads", () => {
    expect(() => assertBoardKey("timer\nreset")).toThrow();
    expect(() => assertBoardValue("value\nsave")).toThrow();
    expect(() => assertNonEmptyString("", "Value")).toThrow();
    expect(() => assertRecord([], "Payload")).toThrow();
  });
});
