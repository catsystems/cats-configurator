import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { isProxy, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App.vue";
import Config from "@/views/Config.vue";
import AppBar from "@/components/AppBar.vue";
import EditEventActionDialog from "@/components/EditEventActionDialog.vue";
import AppFooter from "@/components/Footer.vue";
import FlightLogWorkspace from "@/components/FlightLogWorkspace.vue";
import Profiles from "@/views/Profiles.vue";
import Preflight from "@/views/Preflight.vue";
import Logs from "@/views/Logs.vue";
import Timers from "@/views/Timers.vue";
import Cli from "@/views/Cli.vue";
import Snackbar from "@/components/Snackbar.vue";
import UnitSwitch from "@/components/UnitSwitch.vue";
import UpdateDialog from "@/components/UpdateDialog.vue";
import vuetify from "@/plugins/vuetify.js";
import { useAppStore } from "@/store/index.js";

describe("renderer state components", () => {
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    globalThis.__APP_VERSION__ = "1.3.1";
    window.cats = {
      updates: {
        check: vi.fn(),
        reveal: vi.fn(),
        openRelease: vi.fn(),
      },
    };
  });

  it("toggles the shared unit system through UnitSwitch", async () => {
    const wrapper = mount(UnitSwitch, {
      global: { plugins: [pinia, vuetify] },
    });
    const store = useAppStore();

    wrapper.vm.useImperialUnitsState = true;
    await nextTick();
    expect(store.useImperialUnits).toBe(true);
    expect(wrapper.findComponent({ name: "VSwitch" }).classes()).toContain(
      "unit-switch--active",
    );
  });

  it("renders and dismisses store-backed snackbar messages", async () => {
    const store = useAppStore();
    const wrapper = mount(Snackbar, {
      global: { plugins: [pinia, vuetify] },
    });

    store.showErrorSnackbar("Connection failed");
    await nextTick();
    expect(document.body.textContent).toContain("Connection failed");

    wrapper.vm.handleSnackbarInput(false);
    expect(store.snackbar.isVisible).toBe(false);
    wrapper.unmount();
  });

  it("shows update progress in the footer and supports a manual check", async () => {
    const wrapper = mount(AppFooter, {
      global: {
        plugins: [pinia, vuetify],
        stubs: {
          VFooter: { template: "<footer><slot /></footer>" },
        },
      },
    });
    const store = useAppStore();

    store.setUpdateState({ status: "downloading", progress: 42 });
    await nextTick();
    expect(wrapper.text()).toContain("Downloading update 42%");

    store.setUpdateState({ status: "ready", progress: 100 });
    await nextTick();
    expect(wrapper.text()).toContain("Update ready");
    await wrapper.get("button").trigger("click");
    expect(window.cats.updates.check).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("reveals verified updates and opens validated release pages", async () => {
    const wrapper = mount(UpdateDialog, {
      attachTo: document.body,
      global: {
        plugins: [pinia, vuetify],
        stubs: {
          VDialog: {
            props: ["modelValue"],
            template: '<div v-if="modelValue"><slot /></div>',
          },
        },
      },
    });
    const store = useAppStore();
    store.setUpdateState({
      status: "ready",
      availableVersion: "1.4.0",
      assetName: "cats-configurator-Setup-1.4.0.exe",
      message: "Ready",
    });
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain("Configurator update");
    expect(document.body.textContent).toContain("downloaded and verified");
    await wrapper.vm.openRelease();
    expect(window.cats.updates.openRelease).toHaveBeenCalledOnce();
    await wrapper.vm.reveal();
    expect(window.cats.updates.reveal).toHaveBeenCalledOnce();
    expect(store.snackbar.message).toContain("verified update file");
    wrapper.unmount();
  });

  it("falls back to the release page for unsupported downloads", async () => {
    const wrapper = mount(UpdateDialog, {
      attachTo: document.body,
      global: {
        plugins: [pinia, vuetify],
        stubs: {
          VDialog: {
            props: ["modelValue"],
            template: '<div v-if="modelValue"><slot /></div>',
          },
        },
      },
    });
    const store = useAppStore();
    store.setUpdateState({
      status: "unsupported",
      availableVersion: "1.4.0",
      message: "No automatic download is available for this platform.",
    });
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain(
      "could not prepare a verified download",
    );
    expect(document.body.textContent).toContain("Open release page");
    wrapper.unmount();
  });

  it("keeps automatic update failures quiet and reports manual results", () => {
    const context = {
      setUpdateState: vi.fn(),
      showSuccessSnackbar: vi.fn(),
      showErrorSnackbar: vi.fn(),
    };

    App.methods.handleUpdateState.call(context, {
      status: "error",
      message: "Network unavailable",
      manual: false,
    });
    expect(context.setUpdateState).toHaveBeenCalledOnce();
    expect(context.showErrorSnackbar).not.toHaveBeenCalled();

    App.methods.handleUpdateState.call(context, {
      status: "up-to-date",
      manual: true,
    });
    expect(context.showSuccessSnackbar).toHaveBeenCalledWith(
      "CATS Configurator is up to date.",
    );

    App.methods.handleUpdateState.call(context, {
      status: "error",
      message: "Network unavailable",
      manual: true,
    });
    expect(context.showErrorSnackbar).toHaveBeenCalledWith(
      "Network unavailable",
    );
  });

  it("disposes Vega polling and serial subscriptions with the app bar", () => {
    const unsubscribe = vi.fn();
    const clearInterval = vi
      .spyOn(window, "clearInterval")
      .mockImplementation(() => {});

    AppBar.beforeUnmount.call({
      portScanTimer: 42,
      subscriptions: [unsubscribe, unsubscribe],
    });

    expect(clearInterval).toHaveBeenCalledWith(42);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("renders reactive configuration data without cloning Pinia proxies", async () => {
    const unsubscribe = vi.fn();
    window.cats = {
      board: {
        getConfigs: vi.fn(),
        getInfo: vi.fn(),
        getLogInfo: vi.fn(),
        onDumpComplete: vi.fn(() => unsubscribe),
      },
      serial: {
        onDisconnected: vi.fn(() => unsubscribe),
      },
    };

    const wrapper = mount(Config, {
      global: { plugins: [pinia, vuetify] },
    });
    const store = useAppStore();
    store.setConfig({
      key: "main_altitude",
      value: 200,
      type: "NUMBER",
      allowedRange: [10, 65535],
    });
    await nextTick();
    await nextTick();

    expect(wrapper.text()).toContain("General");
    expect(wrapper.text()).toContain("Main Altitude");
    expect(wrapper.get('input[type="number"]').element.value).toBe("200");
    wrapper.unmount();
  });

  it("saves timer values after editing reactive form data", async () => {
    window.cats = {
      board: {
        applyConfig: vi.fn().mockResolvedValue({ ok: true, results: [] }),
        getConfigs: vi.fn().mockResolvedValue(),
      },
    };
    const context = {
      $refs: {
        form: { validate: vi.fn().mockResolvedValue({ valid: true }) },
      },
      data: reactive({
        timer1_active: { value: true },
        timer1_start: { value: "LIFTOFF" },
        timer1_duration: { value: 1000 },
        timer1_trigger: { value: "APOGEE" },
      }),
      timerKeys: ["timer1"],
      saveLoading: false,
      showErrorSnackbar: vi.fn(),
    };

    await Timers.methods.onSave.call(context);

    expect(window.cats.board.applyConfig).toHaveBeenCalledWith([
      { key: "timer1_start", value: "LIFTOFF" },
      { key: "timer1_duration", value: 1000 },
      { key: "timer1_trigger", value: "APOGEE" },
    ]);
    expect(context.showErrorSnackbar).not.toHaveBeenCalled();
    expect(context.saveLoading).toBe(false);
  });

  it("navigates and selects from connected-session CLI history", async () => {
    const unsubscribe = vi.fn();
    window.cats = {
      serial: {
        send: vi.fn().mockResolvedValue([]),
        onData: vi.fn(() => unsubscribe),
      },
    };
    const wrapper = mount(Cli, {
      attachTo: document.body,
      global: { plugins: [pinia, vuetify] },
    });
    const input = wrapper.get("input");
    expect(input.attributes("placeholder")).toContain("Up: previous");
    expect(input.attributes("placeholder")).toContain("Ctrl+R: history");

    await input.setValue("status");
    await input.trigger("keydown", { key: "Enter" });
    await input.setValue("get timer4_duration");
    await input.trigger("keydown", { key: "Enter" });

    expect(window.cats.serial.send).toHaveBeenNthCalledWith(1, "status");
    expect(window.cats.serial.send).toHaveBeenNthCalledWith(
      2,
      "get timer4_duration",
    );
    expect(wrapper.vm.cmd).toBe("");

    await input.trigger("keydown", { key: "ArrowUp" });
    expect(wrapper.vm.cmd).toBe("get timer4_duration");
    await input.trigger("keydown", { key: "ArrowUp" });
    expect(wrapper.vm.cmd).toBe("status");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.vm.cmd).toBe("get timer4_duration");
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.vm.cmd).toBe("");

    await input.trigger("keydown", { key: "r", ctrlKey: true });
    await nextTick();
    await nextTick();
    expect(wrapper.vm.historyOpen).toBe(true);
    expect(document.body.textContent).toContain("Command history");
    expect(document.body.textContent).toContain("get timer4_duration");

    const historyDialog = document.querySelector(".history-dialog");
    historyDialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await nextTick();
    historyDialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await nextTick();
    expect(wrapper.vm.cmd).toBe("status");
    expect(wrapper.vm.historyOpen).toBe(false);

    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("preserves the firmware's full recording mask while showing known data", async () => {
    window.cats = {
      board: {
        getLogInfo: vi.fn(),
        getConfigs: vi.fn(),
      },
    };
    const wrapper = mount(Logs, {
      global: { plugins: [pinia, vuetify] },
    });
    const store = useAppStore();
    store.setLog({ key: "rec_speed", value: "100Hz" });
    store.setLog({ key: "rec_elements", value: 4294967295 });
    store.setStaticData({
      key: "rec_info",
      value: [
        "Space:",
        "  Total: 1024 KB",
        "   Used: 256 KB (25.00%)",
        "   Free: 768 KB (75.00%)",
      ],
    });
    await nextTick();
    await nextTick();

    expect(wrapper.vm.recElements).toHaveLength(10);
    expect(wrapper.vm.logElements.every(({ description }) => description)).toBe(
      true,
    );
    expect(
      wrapper.vm.logElements.find(({ name }) => name === "Flight Info")
        .description,
    ).toBe("Estimated altitude, velocity, and acceleration.");
    const tooltip = wrapper.findAllComponents({ name: "VTooltip" })[0];
    expect(tooltip.props("offset")).toBe("2");
    expect(tooltip.props("contentClass")).toBe("logging-element-tooltip");
    expect(wrapper.vm.rec_elements).toBe(4294967295);
    expect(wrapper.text()).toContain("Free space: 75.00%");
    expect(wrapper.text()).not.toContain("Estimated logging time: Unavailable");
    expect(store.changedTab).toBeNull();
    wrapper.unmount();
  });

  it("renders event action labels instead of object serialization", async () => {
    const wrapper = mount(EditEventActionDialog, {
      props: {
        event: { filled: false },
        value: { index: 7, value: 2 },
        saveFunction: vi.fn(),
        closeFunction: vi.fn(),
      },
      global: { plugins: [vuetify] },
    });
    await nextTick();

    const selects = wrapper.findAllComponents({ name: "VSelect" });
    expect(selects).toHaveLength(2);
    expect(selects[1].props("itemTitle")).toBe("text");
    expect(selects[1].props("itemValue")).toBe("value");
    expect(wrapper.text()).toContain("LOG");
    expect(wrapper.text()).not.toContain("[object Object]");
    wrapper.unmount();
  });

  it("renders profile differences and reports per-field apply results", async () => {
    const profile = {
      source: { boardModel: "CATS Vega", firmwareVersion: "3.0.2" },
      schemaVersion: 1,
      createdAt: "2026-08-12T08:00:00.000Z",
    };
    const changedRow = {
      key: "main_altitude",
      section: "Configuration",
      label: "Main Altitude",
      boardValue: 200,
      profileValue: 300,
      status: "changed",
    };
    const timerRows = [
      {
        key: "timer1_start",
        section: "Timers",
        label: "Timer 1 Start",
        boardValue: "LIFTOFF",
        profileValue: "CALIBRATE",
        status: "changed",
      },
      {
        key: "timer1_duration",
        section: "Timers",
        label: "Timer 1 Duration",
        boardValue: 1000,
        profileValue: 0,
        status: "changed",
      },
      {
        key: "timer1_trigger",
        section: "Timers",
        label: "Timer 1 Trigger",
        boardValue: "APOGEE",
        profileValue: "CALIBRATE",
        status: "changed",
      },
    ];
    window.cats = {
      board: {
        applyConfig: vi.fn().mockImplementation(async (entries) => ({
          ok: true,
          results: entries.map(({ key, value }) => ({
            key,
            actual: value,
            status: "verified",
          })),
        })),
      },
      profiles: {
        current: vi.fn().mockResolvedValue({
          profile,
          rows: [
            {
              ...changedRow,
              profileValue: 200,
              status: "same",
            },
          ],
          compatibility: {
            warnings: [],
            canApply: true,
            changedCount: 0,
          },
        }),
        open: vi.fn().mockResolvedValue({
          canceled: false,
          profile,
          rows: [changedRow, ...timerRows],
          compatibility: {
            warnings: [],
            canApply: true,
            changedCount: 4,
          },
        }),
        apply: vi.fn().mockImplementation(async (appliedProfile) => {
          expect(isProxy(appliedProfile)).toBe(false);
          return {
            ok: true,
            rows: [{ ...changedRow, boardValue: 300, status: "same" }],
            compatibility: {
              warnings: [],
              canApply: true,
              changedCount: 0,
            },
            results: [{ key: "main_altitude", status: "verified" }],
          };
        }),
      },
    };
    const wrapper = mount(Profiles, {
      global: { plugins: [pinia, vuetify] },
    });

    await vi.waitFor(() =>
      expect(window.cats.profiles.current).toHaveBeenCalled(),
    );
    await nextTick();
    expect(wrapper.text()).toContain(
      "Showing 1 board setting read from the connected board",
    );
    expect(wrapper.text()).toContain("200 m");

    await wrapper.vm.openProfile();
    await nextTick();
    expect(wrapper.text()).toContain("Main Altitude");
    expect(wrapper.text()).toContain("2 profile entries differ from the board");
    expect(wrapper.text()).toContain("Apply Profile to Board");
    const timerRow = wrapper.vm.comparisonRows.find(
      ({ key }) => key === "timer1",
    );
    expect(timerRow.fields).toHaveLength(3);
    expect(wrapper.text()).toContain("LIFTOFF → APOGEE · 1000 ms");
    expect(wrapper.text()).toContain("Disabled");
    expect(wrapper.text()).not.toContain("CALIBRATE → CALIBRATE");

    const store = useAppStore();
    store.toggleUnitSystem();
    await nextTick();
    expect(wrapper.text()).toContain("656 ft");
    expect(wrapper.text()).toContain("984 ft");

    await wrapper.vm.applyProfileRow(timerRow);
    expect(window.cats.board.applyConfig).toHaveBeenCalledWith([
      { key: "timer1_start", value: "CALIBRATE" },
      { key: "timer1_duration", value: 0 },
      { key: "timer1_trigger", value: "CALIBRATE" },
    ]);
    expect(wrapper.vm.changedEntryCount).toBe(1);

    wrapper.vm.viewMode = "board";
    await nextTick();
    expect(wrapper.text()).toContain("Current board value");
    wrapper.vm.viewMode = "comparison";
    await nextTick();

    await wrapper.vm.applyProfile();
    await nextTick();
    expect(window.cats.profiles.apply).toHaveBeenCalledWith(profile);
    expect(wrapper.text()).toContain("verified");
    expect(useAppStore().snackbar.message).toBe(
      "Profile applied and verified.",
    );
    expect(window.cats.profiles.current).toHaveBeenCalledTimes(3);
    wrapper.unmount();

    const cachedWrapper = mount(Profiles, {
      global: { plugins: [pinia, vuetify] },
    });
    await nextTick();
    expect(window.cats.profiles.current).toHaveBeenCalledTimes(3);
    expect(cachedWrapper.text()).toContain(
      "Showing 1 board setting read from the connected board",
    );
    cachedWrapper.unmount();
  });

  it("renders and reuses a cached guided preflight report", async () => {
    window.cats = {
      preflight: {
        run: vi.fn().mockResolvedValue({
          status: "WARNING",
          generatedAt: "2026-08-12T08:00:00.000Z",
          board: { model: "CATS Vega", firmwareVersion: "3.0.2" },
          summary: { warningCount: 1, readyCount: 1 },
          checks: [
            {
              id: "testing-mode",
              category: "Board mode",
              status: "warning",
              title: "Testing mode is enabled",
              detail: "Disable testing mode before flight.",
            },
          ],
          timeline: [
            {
              id: "ev_liftoff",
              kind: "event",
              title: "Liftoff",
              detail: "Flight event: LIFTOFF",
              settings: ["Liftoff detection: 35 m/s²"],
              actions: ["Recorder: LOG"],
            },
            {
              id: "timer1",
              kind: "timer",
              title: "Timer 1",
              detail: "LIFTOFF + 1000 ms → APOGEE",
              settings: [],
              actions: ["Trigger event: APOGEE"],
            },
          ],
        }),
      },
    };
    const wrapper = mount(Preflight, {
      global: { plugins: [pinia, vuetify] },
    });

    await vi.waitFor(() =>
      expect(window.cats.preflight.run).toHaveBeenCalled(),
    );
    await nextTick();
    expect(wrapper.text()).toContain("WARNING");
    expect(wrapper.text()).toContain("Preflight Check");
    expect(wrapper.text()).toContain("Testing mode is enabled");
    expect(wrapper.text()).toContain("Event & Timer Simulator");
    expect(wrapper.text()).toContain("Flight Event Sequence");
    expect(wrapper.text()).toContain("Timer Chains");
    expect(wrapper.text()).toContain("Liftoff detection: 35 m/s²");
    expect(wrapper.text()).toContain("Recorder: LOG");
    expect(wrapper.text()).toContain("LIFTOFF + 1000 ms → APOGEE");
    expect(wrapper.text()).not.toContain("Checks performed");

    useAppStore().toggleUnitSystem();
    await nextTick();
    expect(wrapper.text()).toContain("Liftoff detection: 115 ft/s²");
    expect(wrapper.text()).not.toContain("Liftoff detection: 35 m/s²");
    wrapper.unmount();

    const cachedWrapper = mount(Preflight, {
      global: { plugins: [pinia, vuetify] },
    });
    await nextTick();
    expect(window.cats.preflight.run).toHaveBeenCalledOnce();
    expect(cachedWrapper.text()).toContain("WARNING");
    cachedWrapper.unmount();
  });

  it("clears the previous flight-log session when a new file fails", async () => {
    const replaceChildren = vi.fn();
    window.cats = {
      flightLog: {
        pathForDroppedFile: vi.fn(() => "C:/logs/broken.cfl"),
        load: vi.fn().mockRejectedValue(new Error("File is empty")),
      },
    };
    const context = {
      session: { id: "previous" },
      flightLog: { flightInfo: [] },
      fileLoading: false,
      errorString: "",
      $refs: { flightLogPlotContainer: { replaceChildren } },
    };

    await FlightLogWorkspace.methods.loadFlightLog.call(context, {});

    expect(context.session).toBeNull();
    expect(context.flightLog).toBeNull();
    expect(context.errorString).toBe("File is empty");
    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(context.fileLoading).toBe(false);
  });
});
