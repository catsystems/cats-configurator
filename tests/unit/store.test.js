import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/index.js";

describe("application store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("maps configuration metadata and device state", () => {
    const store = useAppStore();
    store.setActiveState(1);
    store.setConfig({
      key: "main_altitude",
      value: 250,
      type: "NUMBER",
      allowedRange: [0, 1000],
    });

    expect(store.active).toBe(true);
    expect(store.config.main_altitude).toMatchObject({
      value: 250,
      section: "general",
    });
  });

  it("tracks event edits and unit-system state", () => {
    const store = useAppStore();
    store.setEvent({
      key: "event_test",
      values: [1, 100],
      actions: [{ index: 1, value: 100 }],
    });
    expect(store.isEventsChanged).toBe(false);

    store.editEventAction({
      key: "event_test",
      index: 0,
      action: { index: 1, value: 200 },
    });
    expect(store.isEventsChanged).toBe(true);

    store.toggleUnitSystem();
    expect(store.useImperialUnits).toBe(true);
  });
});
