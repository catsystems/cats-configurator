import { describe, expect, it } from "vitest";
import {
  changedProfileEntries,
  compareConfigurationProfile,
  createConfigurationProfile,
  parseBoardIdentity,
  PROFILE_FORMAT,
  validateConfigurationProfile,
} from "@/shared/configuration-profile.js";
import { PROFILE_BOARD_KEYS } from "@/modules/settings.js";

function snapshot(overrides = {}) {
  return {
    board: {
      model: "CATS Vega",
      firmwareVersion: "3.0.2",
      telemetryFirmwareVersion: "1.1.3",
    },
    values: Object.fromEntries(
      PROFILE_BOARD_KEYS.map((key, index) => [key, index]),
    ),
    unsupportedKeys: [],
    ...overrides,
  };
}

describe("versioned configuration profiles", () => {
  it("creates a structured bundle with all board sections", () => {
    const profile = createConfigurationProfile(snapshot(), {
      appVersion: "1.3.2",
      createdAt: "2026-08-12T08:00:00.000Z",
    });

    expect(profile).toMatchObject({
      format: PROFILE_FORMAT,
      schemaVersion: 1,
      source: {
        boardModel: "CATS Vega",
        firmwareVersion: "3.0.2",
        configuratorVersion: "1.3.2",
      },
    });
    expect(Object.keys(profile.configuration)).toHaveLength(10);
    expect(Object.keys(profile.events)).toHaveLength(7);
    expect(Object.keys(profile.timers)).toEqual([
      "timer1",
      "timer2",
      "timer3",
      "timer4",
    ]);
    expect(Object.keys(profile.logging)).toHaveLength(2);
  });

  it("shows changes and firmware compatibility warnings", () => {
    const board = snapshot();
    const profile = createConfigurationProfile(board, {
      createdAt: "2026-08-12T08:00:00.000Z",
    });
    profile.configuration.main_altitude = 999;
    profile.source.firmwareVersion = "2.9.0";

    const comparison = compareConfigurationProfile(profile, board);
    expect(comparison.compatibility).toMatchObject({
      blocked: false,
      canApply: true,
      changedCount: 1,
    });
    expect(comparison.compatibility.warnings[0].message).toContain(
      "differs from connected firmware",
    );
    expect(changedProfileEntries(comparison)).toEqual([
      { key: "main_altitude", value: 999 },
    ]);
  });

  it("blocks a board-model or schema mismatch", () => {
    const board = snapshot();
    const profile = createConfigurationProfile(board, {
      createdAt: "2026-08-12T08:00:00.000Z",
    });
    profile.source.boardModel = "CATS Other";
    profile.schemaVersion = 2;

    expect(
      compareConfigurationProfile(profile, board).compatibility,
    ).toMatchObject({ blocked: true, canApply: false });
  });

  it("reports missing and unsupported fields without applying them", () => {
    const board = snapshot({ unsupportedKeys: ["tele_enable"] });
    const profile = createConfigurationProfile(board, {
      createdAt: "2026-08-12T08:00:00.000Z",
    });
    delete profile.configuration.main_altitude;
    profile.configuration.future_setting = "ON";

    const comparison = compareConfigurationProfile(profile, board);
    expect(
      comparison.rows.find(({ key }) => key === "main_altitude").status,
    ).toBe("missing");
    expect(
      comparison.rows.find(({ key }) => key === "tele_enable").status,
    ).toBe("unsupported");
    expect(
      comparison.rows.find(({ key }) => key === "future_setting").status,
    ).toBe("unsupported");
    expect(changedProfileEntries(comparison)).toEqual([]);
  });

  it("rejects malformed or ambiguous profiles", () => {
    expect(() => validateConfigurationProfile({ format: "other" })).toThrow(
      "not a CATS Configurator profile",
    );
    const profile = createConfigurationProfile(snapshot(), {
      createdAt: "2026-08-12T08:00:00.000Z",
    });
    profile.logging.main_altitude = 20;
    expect(() => validateConfigurationProfile(profile)).toThrow(
      "duplicate field main_altitude",
    );
    delete profile.logging.main_altitude;
    profile.configuration.main_altitude = "200\nsave";
    expect(() => validateConfigurationProfile(profile)).toThrow("single line");
  });

  it("parses current and legacy firmware identity labels", () => {
    expect(
      parseBoardIdentity([
        "Board: CATS Vega",
        "Code version: 3.0.2-dev",
        "Telemetry Code version: 1.1.3",
      ]),
    ).toEqual({
      model: "CATS Vega",
      firmwareVersion: "3.0.2-dev",
      telemetryFirmwareVersion: "1.1.3",
    });
    expect(parseBoardIdentity(["Firmware: test"]).firmwareVersion).toBe("test");
  });
});
