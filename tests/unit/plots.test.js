import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

const plotlyMock = vi.hoisted(() => ({
  newPlot: vi.fn((element) => {
    element.classList.add("js-plotly-plot");
    return Promise.resolve(element);
  }),
  purge: vi.fn(),
}));

vi.mock("plotly.js-dist-min", () => ({ default: plotlyMock }));

import { makePlots } from "@/modules/plots.js";

function flightLogFixture() {
  return reactive({
    lastTs: 1,
    flightStates: [{ ts: 0, state: 2 }],
    eventInfo: [],
    flightInfo: [{ ts: 1, height: 100, velocity: 20 }],
    imu: [{ ts: 1, Ax: 1, Ay: 2, Az: 3, Gx: 4, Gy: 5, Gz: 6 }],
    baro: [{ ts: 1, T: 20, P: 1013 }],
    filteredDataInfo: [{ ts: 1, filteredAltitudeAGL: 90 }],
    voltageInfo: [{ ts: 1, voltage: 3.7 }],
  });
}

describe("flight-log plots", () => {
  it("replots reactive log data across unit changes without cloning or mutation", async () => {
    const flightLog = flightLogFixture();
    const container = document.createElement("div");

    await makePlots(flightLog, container, false);
    expect(container.querySelectorAll(".js-plotly-plot")).toHaveLength(8);

    await makePlots(flightLog, container, true);
    expect(container.querySelectorAll(".js-plotly-plot")).toHaveLength(8);
    expect(plotlyMock.newPlot.mock.calls[8][1][0].y[0]).toBeCloseTo(328.084);
    expect(flightLog.flightInfo[0].height).toBe(100);

    await makePlots(flightLog, container, false);
    expect(container.querySelectorAll(".js-plotly-plot")).toHaveLength(8);
    expect(plotlyMock.purge).toHaveBeenCalledTimes(16);
  });
});
