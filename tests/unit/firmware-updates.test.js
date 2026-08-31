import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FirmwareUpdates from "@/views/FirmwareUpdates.vue";
import AppBar from "@/components/AppBar.vue";
import { useAppStore } from "@/store";
import vuetify from "@/plugins/vuetify";

const snapshot = () => ({
  busy: false,
  cancellable: false,
  stage: "idle",
  message: "Ready",
  platformSupported: true,
  devices: [
    {
      id: "gs-1",
      target: "ground-station",
      label: "Ground Station (COM4)",
      version: "1.2.1",
      versionSource: "serial",
    },
  ],
  available: [
    {
      id: 42,
      target: "ground-station",
      version: "1.2.2",
      notes: "<script>not executable</script>",
    },
  ],
  telemetryVersion: "1.1.3",
});

describe("firmware updates", () => {
  it("does not let an older command response unlock a newer device operation", () => {
    setActivePinia(createPinia());
    const store = useAppStore();
    store.setFirmwareSnapshot({ revision: 5, busy: true, stage: "copying" });
    store.setFirmwareSnapshot({ revision: 4, busy: false, stage: "idle" });
    expect(store.firmwareBusy).toBe(true);
    expect(store.firmware.stage).toBe("copying");
  });
  let pinia;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    window.cats = {
      firmware: {
        current: vi.fn(async () => snapshot()),
        check: vi.fn(async () => snapshot()),
        start: vi.fn(async () => ({
          ...snapshot(),
          busy: true,
          cancellable: true,
          stage: "downloading",
        })),
        retry: vi.fn(async () => snapshot()),
        cancel: vi.fn(async () => snapshot()),
      },
    };
  });
  async function render() {
    const wrapper = mount(FirmwareUpdates, {
      global: { plugins: [pinia, vuetify] },
    });
    await flushPromises();
    return wrapper;
  }

  it("works disconnected and shows unavailability and disabled telemetry", async () => {
    const wrapper = await render();
    expect(useAppStore().active).toBe(false);
    expect(wrapper.text()).toContain("Firmware Updates");
    expect(wrapper.text()).toContain("1.1.3");
    expect(wrapper.text()).toContain("Legacy filenames");
    expect(wrapper.vm.canUpdate("ground-station")).toBe(true);
    expect(wrapper.vm.canUpdate("vega")).toBe(false);
    expect(wrapper.find("script").exists()).toBe(false);
    wrapper.unmount();
  });
  it("clearly identifies a hardware-test installer", async () => {
    const wrapper = await render();
    useAppStore().setFirmwareSnapshot({ ...snapshot(), hardwareTest: true });
    await flushPromises();
    expect(wrapper.text()).toContain("Hardware-test build");
    expect(wrapper.text()).toContain("have not yet passed hardware acceptance");
    expect(wrapper.vm.canUpdate("ground-station")).toBe(true);
    wrapper.unmount();
  });
  it("requires explicit safety and unknown-file-version confirmation", async () => {
    const wrapper = await render();
    useAppStore().firmware.devices[0].versionSource = "file-unverified";
    wrapper.vm.confirm("ground-station");
    await wrapper.vm.start();
    expect(window.cats.firmware.start).not.toHaveBeenCalled();
    wrapper.vm.safetyConfirmed = true;
    expect(wrapper.vm.confirmed).toBe(false);
    wrapper.vm.unknownConfirmed = true;
    await wrapper.vm.start();
    expect(window.cats.firmware.start).toHaveBeenCalledWith({
      deviceId: "gs-1",
      assetId: 42,
      noUnsavedChanges: true,
      safetyConfirmed: true,
      reinstallConfirmed: false,
      unknownVersionConfirmed: true,
    });
    expect(wrapper.vm.canUpdate("ground-station")).toBe(false);
    wrapper.unmount();
  });
  it("blocks unsaved changes, same-version reinstall and unaccepted platforms", async () => {
    const wrapper = await render();
    const store = useAppStore();
    store.firmware.devices[0].version = "1.2.2+local";
    wrapper.vm.confirm("ground-station");
    wrapper.vm.safetyConfirmed = true;
    expect(wrapper.vm.confirmed).toBe(false);
    wrapper.vm.reinstallConfirmed = true;
    expect(wrapper.vm.confirmed).toBe(true);
    store.changedTab = "config";
    expect(wrapper.vm.confirmed).toBe(false);
    expect(wrapper.vm.canUpdate("ground-station")).toBe(false);
    store.changedTab = null;
    store.firmware.platformSupported = false;
    expect(wrapper.vm.canUpdate("ground-station")).toBe(false);
    wrapper.unmount();
  });
  it("does not autoselect ambiguous devices and presents recovery failures", async () => {
    const wrapper = await render();
    const state = snapshot();
    state.devices.push({ ...state.devices[0], id: "gs-2" });
    wrapper.vm.selected = {};
    useAppStore().setFirmwareSnapshot({
      ...state,
      stage: "failed",
      failedStage: "copying",
      canRetry: true,
      error: { message: "Copy interrupted" },
    });
    await flushPromises();
    expect(wrapper.vm.device("ground-station")).toBeUndefined();
    expect(wrapper.text()).toContain("Copy interrupted");
    expect(wrapper.text()).toContain("Retry validated update");
    wrapper.unmount();
  });
  it("suspends automatic connections and manual disconnect during an update", async () => {
    const refreshPorts = vi.fn();
    const context = { firmwareBusy: true, refreshPorts };
    await AppBar.methods.scanPorts.call(context);
    expect(refreshPorts).not.toHaveBeenCalled();
    window.cats.serial = { disconnect: vi.fn() };
    await AppBar.methods.disconnect.call(context);
    expect(window.cats.serial.disconnect).not.toHaveBeenCalled();
  });
  it("labels a post-write retry as a connection check", async () => {
    const wrapper = await render();
    useAppStore().setFirmwareSnapshot({
      ...snapshot(),
      stage: "failed",
      failedStage: "reconnecting",
      canRetry: true,
      retryConnectionOnly: true,
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Retry connection check");
    expect(wrapper.text()).not.toContain("Retry validated update");
    await wrapper.vm.retry();
    expect(window.cats.firmware.retry).toHaveBeenCalledOnce();
    expect(window.cats.firmware.start).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
