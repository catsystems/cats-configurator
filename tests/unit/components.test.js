import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App.vue";
import Config from "@/views/Config.vue";
import AppBar from "@/components/AppBar.vue";
import EditEventActionDialog from "@/components/EditEventActionDialog.vue";
import AppFooter from "@/components/Footer.vue";
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
    globalThis.__APP_VERSION__ = "1.3.0";
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
      assetName: "cats-configurator Setup 1.4.0.exe",
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
        getConfig: vi.fn(),
        getInfo: vi.fn(),
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
});
