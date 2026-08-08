import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Config from "@/views/Config.vue";
import EditEventActionDialog from "@/components/EditEventActionDialog.vue";
import Snackbar from "@/components/Snackbar.vue";
import UnitSwitch from "@/components/UnitSwitch.vue";
import vuetify from "@/plugins/vuetify.js";
import { useAppStore } from "@/store/index.js";

describe("renderer state components", () => {
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
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
