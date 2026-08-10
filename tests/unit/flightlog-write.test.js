import { beforeEach, describe, expect, it, vi } from "vitest";

const { showOpenDialog } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: { showOpenDialog },
}));

import {
  exportFlightLogChartsToHTML,
  exportFlightLogToCSVs,
} from "@/modules/flightlog.js";

describe("flight-log write destinations", () => {
  beforeEach(() => {
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["C:/mounted-cats-drive"],
    });
  });

  it.each([
    ["CSV", (guard) => exportFlightLogToCSVs({}, "flight", {}, guard)],
    [
      "HTML",
      (guard) => exportFlightLogChartsToHTML({}, false, "flight", {}, guard),
    ],
  ])(
    "validates the %s export destination before writing",
    async (_name, run) => {
      const guard = vi
        .fn()
        .mockRejectedValue(new Error("Flight logs cannot be written here."));

      await expect(run(guard)).rejects.toThrow(/cannot be written/i);
      expect(guard).toHaveBeenCalledOnce();
    },
  );
});
