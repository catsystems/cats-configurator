import { defineStore } from "pinia";
import { CONFIG_SETTINGS } from "@/modules/settings.js";

export const useAppStore = defineStore("app", {
  state: () => ({
    serialPorts: [],
    active: false,
    changedTab: null,
    static: {},
    config: {},
    events: {},
    timers: {},
    logs: {
      rec_speed: {},
      rec_elements: {},
    },
    snackbar: {
      isVisible: false,
      message: "",
      color: "success",
      timeout: 3000,
    },
    updates: {
      status: "idle",
      currentVersion: null,
      availableVersion: null,
      assetName: null,
      progress: null,
      message: null,
      manual: false,
    },
    useImperialUnits: false,
  }),
  getters: {
    isEventsChanged(state) {
      return Object.values(state.events).some((event) => {
        const values = event.actions.flatMap((action) => [
          action.index,
          action.value,
        ]);
        return event.values.join() !== values.join();
      });
    },
    snackbarState: (state) => state.snackbar,
  },
  actions: {
    setSerialPorts(ports) {
      this.serialPorts = ports;
    },
    setStaticData({ key, value }) {
      this.static[key] = value;
    },
    setActiveState(value) {
      this.active = Boolean(value);
    },
    setConfig(payload) {
      if (!payload.key) return;
      const setting = CONFIG_SETTINGS[payload.key];
      const { key, ...data } = payload;
      this.config[key] = {
        ...data,
        name: setting?.name ?? null,
        unit: setting?.unit ?? null,
        section: setting?.section ?? null,
      };
    },
    setEvent({ key, ...event }) {
      if (key) this.events[key] = event;
    },
    setTimer(payload) {
      if (!payload.key) return;
      if (payload.key.includes("duration")) {
        this.timers[payload.key.replace("duration", "active")] = {
          value: Boolean(payload.value),
        };
      }
      const { key, ...timer } = payload;
      this.timers[key] = timer;
    },
    setLog({ key, ...log }) {
      if (key) this.logs[key] = log;
    },
    setChangedTab(tab) {
      this.changedTab = tab;
    },
    addEventAction({ key, action }) {
      this.events[key].actions.push(action);
    },
    editEventAction({ key, action, index }) {
      this.events[key].actions[index] = action;
    },
    removeEventAction({ key, index }) {
      this.events[key].actions.splice(index, 1);
    },
    showSuccessSnackbar(message) {
      this.showSnackbar({ message, color: "success" });
    },
    showErrorSnackbar(message) {
      this.showSnackbar({ message, color: "error" });
    },
    showSnackbar({ message, color = "success", timeout = 3000 }) {
      Object.assign(this.snackbar, {
        isVisible: true,
        message,
        color,
        timeout,
      });
    },
    hideSnackbar() {
      this.snackbar.isVisible = false;
      this.snackbar.message = "";
    },
    setUpdateState(state) {
      if (!state || typeof state !== "object") return;
      this.updates = { ...this.updates, ...state };
    },
    toggleUnitSystem() {
      this.useImperialUnits = !this.useImperialUnits;
    },
  },
});
