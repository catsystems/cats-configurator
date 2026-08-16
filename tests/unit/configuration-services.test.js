import { beforeEach, describe, expect, it, vi } from "vitest";
import { setConfigs } from "@/services/configService.js";
import { setEvents } from "@/services/eventService.js";
import { setLogData } from "@/services/logService.js";
import { setTimers } from "@/services/timerService.js";

describe("configuration save services", () => {
  beforeEach(() => {
    window.cats = {
      board: {
        applyConfig: vi.fn().mockResolvedValue({ ok: true, results: [] }),
      },
    };
  });

  it("writes only changed configuration values", async () => {
    await setConfigs(
      {
        main_altitude: { value: 300 },
        acc_threshold: { value: 35 },
      },
      {
        main_altitude: { value: 200 },
        acc_threshold: { value: 35 },
      },
    );

    expect(window.cats.board.applyConfig).toHaveBeenCalledWith([
      { key: "main_altitude", value: 300 },
    ]);
  });

  it("pads changed events so removed firmware actions are cleared", async () => {
    await setEvents({
      ev_liftoff: {
        arrayLength: 16,
        values: [7, 2],
        actions: [{ index: 7, value: 2 }],
      },
      ev_apogee: {
        arrayLength: 16,
        values: [2, 1, 1, 2000, 2, 0],
        actions: [{ index: 2, value: 1 }],
      },
    });

    expect(window.cats.board.applyConfig).toHaveBeenCalledWith([
      {
        key: "ev_apogee",
        value: "2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0",
      },
    ]);
  });

  it("writes only changed timer and logging values", async () => {
    await setTimers(
      {
        timer1_start: { value: "LIFTOFF" },
        timer1_duration: { value: 1200 },
        timer1_trigger: { value: "APOGEE" },
      },
      {
        timer1_start: { value: "LIFTOFF" },
        timer1_duration: { value: 1000 },
        timer1_trigger: { value: "APOGEE" },
      },
    );
    expect(window.cats.board.applyConfig).toHaveBeenLastCalledWith([
      { key: "timer1_duration", value: 1200 },
    ]);

    await setLogData(
      { speed: "100Hz", elements: 16368 },
      {
        rec_speed: { value: "100Hz" },
        rec_elements: { value: 4294967295 },
      },
    );
    expect(window.cats.board.applyConfig).toHaveBeenLastCalledWith([
      { key: "rec_elements", value: 16368 },
    ]);
  });

  it("does not start a board transaction when nothing changed", async () => {
    await setLogData(
      { speed: "100Hz", elements: 4294967295 },
      {
        rec_speed: { value: "100Hz" },
        rec_elements: { value: 4294967295 },
      },
    );

    expect(window.cats.board.applyConfig).not.toHaveBeenCalled();
  });
});
