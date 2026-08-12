import { describe, expect, it } from "vitest";
import {
  assertBoardKey,
  assertBoardEntries,
  assertBoardValue,
  assertNonEmptyString,
  assertOpaqueId,
  assertRecord,
} from "@/shared/ipc.js";

describe("IPC contract validation", () => {
  it("accepts board-safe values", () => {
    expect(assertBoardKey("timer1_duration")).toBe("timer1_duration");
    expect(assertBoardValue(1000)).toBe(1000);
    expect(
      assertBoardEntries([{ key: "timer4_duration", value: 1000 }]),
    ).toEqual([{ key: "timer4_duration", value: 1000 }]);
    expect(assertRecord({ key: "value" }, "Payload")).toEqual({ key: "value" });
  });

  it("rejects command injection and malformed payloads", () => {
    expect(() => assertBoardKey("timer\nreset")).toThrow();
    expect(() => assertBoardValue("value\nsave")).toThrow();
    expect(() => assertBoardValue("value#save")).toThrow();
    expect(() => assertBoardValue("")).toThrow();
    expect(() => assertBoardValue(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => assertBoardEntries([])).toThrow();
    expect(() => assertNonEmptyString("", "Value")).toThrow();
    expect(() => assertRecord([], "Payload")).toThrow();
    expect(() => assertOpaqueId("../../flight.cfl")).toThrow();
  });

  it("accepts only opaque UUID identifiers", () => {
    expect(assertOpaqueId("9e1be0e4-164a-4f0a-9a14-56be3d18fdf5")).toBe(
      "9e1be0e4-164a-4f0a-9a14-56be3d18fdf5",
    );
  });
});
