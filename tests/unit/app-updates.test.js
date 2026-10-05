import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppUpdates from "@/components/AppUpdates.vue";
import AppBar from "@/components/AppBar.vue";
import vuetify from "@/plugins/vuetify.js";
import { useAppStore } from "@/store/index.js";

describe("application updates", () => {
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    globalThis.__APP_VERSION__ = "2.0.1";
    window.cats = {
      app: {
        checkUpdate: vi.fn().mockResolvedValue(null),
        installUpdate: vi.fn().mockResolvedValue(undefined),
        onUpdateProgress: vi.fn(() => vi.fn()),
        openExternal: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  function render() {
    return mount(AppUpdates, {
      global: {
        plugins: [pinia, vuetify],
        stubs: {
          VDialog: {
            props: ["modelValue", "persistent"],
            template:
              '<div v-if="modelValue" :data-persistent="persistent"><slot /></div>',
          },
        },
      },
    });
  }

  it("checks at startup without showing a message when up to date", async () => {
    const wrapper = render();
    await flushPromises();
    expect(window.cats.app.checkUpdate).toHaveBeenCalledOnce();
    expect(wrapper.vm.dialog).toBe(false);
    expect(useAppStore().snackbar.isVisible).toBe(false);
    expect(wrapper.text()).toContain("App version:");
    expect(wrapper.text()).not.toContain("Check for updates");
    await wrapper.get("button.app-version").trigger("click");
    await flushPromises();
    expect(window.cats.app.checkUpdate).toHaveBeenCalledTimes(2);
    expect(useAppStore().snackbar.message).toBe("Configurator is up to date.");
    wrapper.unmount();
  });

  it("offers a new version and waits for explicit installation", async () => {
    window.cats.app.checkUpdate.mockResolvedValue({
      version: "2.0.2",
      canInstall: true,
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("2.0.2 is available");
    expect(window.cats.app.installUpdate).not.toHaveBeenCalled();
    let finish;
    window.cats.app.installUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const button = wrapper
      .findAll("button")
      .find((button) => button.text() === "Install and restart");
    await button.trigger("click");
    expect(window.cats.app.installUpdate).toHaveBeenCalledOnce();
    expect(useAppStore().appUpdating).toBe(true);
    expect(wrapper.get("[data-persistent]").attributes("data-persistent")).toBe(
      "true",
    );
    expect(wrapper.text()).toContain("Preparing update…");
    const progress = window.cats.app.onUpdateProgress.mock.calls[0][0];
    progress({ stage: "downloading", progress: null });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Downloading…");
    expect(
      wrapper
        .findComponent(".v-card-text .v-progress-linear")
        .props("indeterminate"),
    ).toBe(true);
    for (const percentage of [0, 45, 100]) {
      progress({ stage: "downloading", progress: percentage });
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain(`Downloading ${percentage}%`);
      const bar = wrapper.findComponent(".v-card-text .v-progress-linear");
      expect(bar.props("modelValue")).toBe(percentage);
      expect(bar.props("indeterminate")).toBe(false);
    }
    progress({ stage: "installing", progress: 100 });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Verifying and installing…");
    finish();
    await flushPromises();
    expect(useAppStore().appUpdating).toBe(false);
    progress({ stage: "downloading", progress: 10 });
    expect(wrapper.vm.progress).toBe(100);
    wrapper.unmount();
    expect(
      window.cats.app.onUpdateProgress.mock.results[0].value,
    ).toHaveBeenCalledOnce();
  });

  it("opens official release notes and shows browser launch errors", async () => {
    window.cats.app.checkUpdate.mockResolvedValue({
      version: "2.0.2",
      canInstall: true,
    });
    const wrapper = render();
    await flushPromises();
    const notes = wrapper
      .findAll("button")
      .find((button) => button.text() === "View release notes");
    await notes.trigger("click");
    await flushPromises();
    expect(window.cats.app.openExternal).toHaveBeenCalledWith(
      "https://github.com/catsystems/cats-configurator/releases/latest",
    );
    expect(window.cats.app.installUpdate).not.toHaveBeenCalled();
    window.cats.app.openExternal.mockRejectedValueOnce(
      new Error("Browser could not be opened"),
    );
    await notes.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Browser could not be opened");
    wrapper.unmount();
  });

  it("keeps automatic check failures quiet and reports manual failures", async () => {
    window.cats.app.checkUpdate.mockRejectedValue(new Error("Offline"));
    const wrapper = render();
    await flushPromises();
    expect(useAppStore().snackbar.isVisible).toBe(false);
    await wrapper.vm.check(true);
    expect(useAppStore().snackbar.message).toContain("Offline");
    expect(wrapper.vm.checking).toBe(false);
    wrapper.unmount();
  });

  it("allows installation while connected and explains the automatic disconnect", async () => {
    window.cats.app.checkUpdate.mockResolvedValue({
      version: "2.0.2",
      canInstall: true,
    });
    useAppStore().active = true;
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("Configurator will disconnect the device");
    const button = wrapper
      .findAll("button")
      .find((button) => button.text() === "Install and restart");
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    expect(window.cats.app.installUpdate).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("blocks installation while editing or updating firmware", async () => {
    window.cats.app.checkUpdate.mockResolvedValue({
      version: "2.0.2",
      canInstall: true,
    });
    const wrapper = render();
    await flushPromises();
    const store = useAppStore();
    for (const state of [
      { active: false, changedTab: "config", firmware: null },
      { active: false, changedTab: null, firmware: { busy: true } },
    ]) {
      store.$patch(state);
      await wrapper.vm.install();
      expect(wrapper.vm.blocked).not.toBe("");
    }
    expect(window.cats.app.installUpdate).not.toHaveBeenCalled();
    store.firmware = null;
    await wrapper.vm.install();
    expect(window.cats.app.installUpdate).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("shows installation failures and allows retry", async () => {
    window.cats.app.checkUpdate.mockResolvedValue({
      version: "2.0.2",
      canInstall: true,
    });
    window.cats.app.installUpdate.mockRejectedValueOnce(
      new Error("Invalid signature"),
    );
    const wrapper = render();
    await flushPromises();
    await wrapper.vm.install();
    expect(wrapper.vm.error).toContain("Invalid signature");
    expect(wrapper.vm.installing).toBe(false);
    expect(useAppStore().appUpdating).toBe(false);
    wrapper.vm.progress = 73;
    wrapper.vm.updateStage = "downloading";
    await wrapper.vm.install();
    expect(wrapper.vm.error).toBe("");
    expect(window.cats.app.installUpdate).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.progress).toBeNull();
    expect(wrapper.vm.updateStage).toBe("preparing");
    wrapper.unmount();
  });

  it("pauses background device polling while the application is updating", async () => {
    window.cats.serial = {
      list: vi.fn().mockResolvedValue([]),
      onError: () => () => {},
      onDisconnected: () => () => {},
    };
    const wrapper = mount(AppBar, {
      global: {
        plugins: [pinia, vuetify],
        stubs: {
          VAppBar: { template: "<header><slot /></header>" },
          RouterLink: true,
        },
      },
    });
    await flushPromises();
    window.cats.serial.list.mockClear();
    useAppStore().appUpdating = true;
    await wrapper.vm.scanPorts();
    expect(window.cats.serial.list).not.toHaveBeenCalled();
    useAppStore().appUpdating = false;
    await wrapper.vm.scanPorts();
    expect(window.cats.serial.list).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("opens the release page for Debian packages instead of installing an AppImage", async () => {
    window.cats.app.checkUpdate.mockResolvedValue({
      version: "2.0.2",
      canInstall: false,
    });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("Download update");
    await wrapper.vm.install();
    expect(window.cats.app.openExternal).toHaveBeenCalledWith(
      "https://github.com/catsystems/cats-configurator/releases/latest",
    );
    expect(window.cats.app.installUpdate).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
