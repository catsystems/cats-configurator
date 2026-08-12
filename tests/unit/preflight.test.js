import { describe, expect, it } from "vitest";
import {
  buildPreflightReport,
  parseConfiguredActions,
  simulateFlightSequence,
} from "@/shared/preflight.js";

function safeSnapshot(overrides = {}) {
  const values = {
    main_altitude: 200,
    test_mode: "OFF",
    rec_speed: "100 Hz",
    rec_elements: 65504,
    ev_liftoff: "7,2",
    ev_burnout: "0,0",
    ev_apogee: "2,1",
    ev_main_deployment: "3,1",
    ev_touchdown: "7,0",
    ev_custom1: "0,0",
    ev_custom2: "0,0",
  };
  for (let index = 1; index <= 4; index += 1) {
    values[`timer${index}_start`] = "CALIBRATE";
    values[`timer${index}_duration`] = 0;
    values[`timer${index}_trigger`] = "CALIBRATE";
  }
  return {
    board: { model: "CATS Vega", firmwareVersion: "3.0.2" },
    values: { ...values, ...overrides },
  };
}

describe("guided preflight and event simulation", () => {
  it("marks a coherent flight configuration ready", () => {
    const report = buildPreflightReport(safeSnapshot());

    expect(report.status).toBe("READY");
    expect(report.summary).toMatchObject({
      blockedCount: 0,
      warningCount: 0,
    });
    expect(report.checks.every(({ status }) => status === "ready")).toBe(true);
    expect(report.timeline.map(({ title }) => title)).toEqual([
      "Liftoff",
      "Burnout / Max V",
      "Apogee",
      "Main Deployment",
      "Touchdown",
      "Custom 1",
      "Custom 2",
    ]);
  });

  it("blocks test mode, disabled recording, and conflicting deployment", () => {
    const report = buildPreflightReport(
      safeSnapshot({
        test_mode: "ON",
        rec_speed: "OFF",
        ev_liftoff: "2,1",
        ev_apogee: "2,1",
        ev_main_deployment: "2,1",
      }),
    );

    expect(report.status).toBe("BLOCKED");
    expect(report.checks.find(({ id }) => id === "testing-mode").status).toBe(
      "blocked",
    );
    expect(report.checks.find(({ id }) => id === "recording").status).toBe(
      "blocked",
    );
    expect(
      report.checks.find(({ id }) => id === "pyro-conflicts").detail,
    ).toContain("Pyro 1");
    expect(
      report.checks.find(({ id }) => id === "deployment-plan").detail,
    ).toContain("too early");
  });

  it("detects impossible event ordering and cyclic timer chains", () => {
    const reversed = buildPreflightReport(
      safeSnapshot({
        timer1_start: "APOGEE",
        timer1_duration: 1000,
        timer1_trigger: "LIFTOFF",
      }),
    );
    expect(
      reversed.checks.find(({ id }) => id === "event-order"),
    ).toMatchObject({ status: "blocked" });

    const cyclic = buildPreflightReport(
      safeSnapshot({
        timer1_start: "CUSTOM_1",
        timer1_duration: 1000,
        timer1_trigger: "CUSTOM_2",
        timer2_start: "CUSTOM_2",
        timer2_duration: 1000,
        timer2_trigger: "CUSTOM_1",
      }),
    );
    expect(cyclic.checks.find(({ id }) => id === "timer-chains")).toMatchObject(
      { status: "blocked", detail: "Active timer triggers form a cycle." },
    );
  });

  it("warns when recording is never stopped", () => {
    const report = buildPreflightReport(safeSnapshot({ ev_touchdown: "0,0" }));
    expect(report.status).toBe("WARNING");
    expect(
      report.checks.find(({ id }) => id === "recorder-stop"),
    ).toMatchObject({ status: "warning" });
  });

  it("decodes event actions and places active timers in the timeline", () => {
    expect(parseConfiguredActions("1,500,7,2")).toMatchObject([
      { name: "Delay", value: 500 },
      { name: "Recorder", value: 2, summary: "Recorder: LOG" },
    ]);
    const timeline = simulateFlightSequence(
      safeSnapshot({
        timer1_start: "LIFTOFF",
        timer1_duration: 750,
        timer1_trigger: "APOGEE",
      }).values,
    );
    expect(timeline.find(({ id }) => id === "timer1")).toMatchObject({
      kind: "timer",
      detail: "LIFTOFF + 750 ms → APOGEE",
    });
  });
});
