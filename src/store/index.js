import Vue from "vue";
import Vuex from "vuex";
import { CONFIG_SETTINGS } from "@/modules/settings.js";

Vue.use(Vuex);

export default new Vuex.Store({
  state: {
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
  },
  mutations: {
    SET_SERIAL_PORTS(state, ports) {
      state.serialPorts = ports;
    },
    SET_STATIC_DATA(state, { key, value }) {
      Vue.set(state.static, key, value);
    },
    SET_ACTIVE(state, value) {
      state.active = value;
    },
    SET_CONFIG(state, { key, ...rest }) {
      Vue.set(state.config, key, rest);
    },
    SET_EVENT(state, { key, ...rest }) {
      Vue.set(state.events, key, rest);
    },
    SET_TIMER(state, { key, ...rest }) {
      Vue.set(state.timers, key, rest);
    },
    SET_LOG(state, { key, ...rest }) {
      Vue.set(state.logs, key, rest);
    },
    SET_CHANGED_TAB(state, tab) {
      state.changedTab = tab;
    },
    ADD_EVENT_ACTION(state, { key, action }) {
      Vue.set(state.events[key], "actions", [
        ...state.events[key].actions,
        action,
      ]);
    },
    EDIT_EVENT_ACTION(state, { key, action, index }) {
      Vue.set(state.events[key].actions, index, action);
    },
    REMOVE_EVENT_ACTION(state, { key, index }) {
      state.events[key].actions.splice(index, 1);
    },
    SET_SNACKBAR_PROPS(state, payload) {
      state.snackbar = { ...state.snackbar, ...payload };
    },
    SHOW_SNACKBAR(state, { message, color = "success", timeout = 3000 }) {
      state.snackbar.isVisible = true;
      state.snackbar.message = message;
      state.snackbar.color = color;
      state.snackbar.timeout = timeout;
    },
    HIDE_SNACKBAR(state) {
      state.snackbar.isVisible = false;
      state.snackbar.message = "";
    },
  },
  actions: {
    setSerialPorts({ commit }, ports) {
      commit("SET_SERIAL_PORTS", ports);
    },
    setStaticData({ commit }, payload) {
      commit("SET_STATIC_DATA", payload);
    },
    setActiveState({ commit }, payload) {
      commit("SET_ACTIVE", payload);
    },
    setConfig({ commit }, payload) {
      if (!payload.key) return;

      payload.name = CONFIG_SETTINGS[payload.key]
        ? CONFIG_SETTINGS[payload.key].name
        : null;

      payload.unit = CONFIG_SETTINGS[payload.key]
        ? CONFIG_SETTINGS[payload.key].unit
        : null;

      payload.section = CONFIG_SETTINGS[payload.key]
        ? CONFIG_SETTINGS[payload.key].section
        : null;

      commit("SET_CONFIG", payload);
    },
    setEvent({ commit }, payload) {
      if (!payload.key) return;

      commit("SET_EVENT", payload);
    },
    setTimer({ commit }, payload) {
      if (!payload.key) return;

      if (payload.key.includes("duration")) {
        commit("SET_TIMER", {
          key: payload.key.replace("duration", "active"),
          value: Boolean(payload.value),
        });
      }
      commit("SET_TIMER", payload);
    },
    setLog({ commit }, payload) {
      if (!payload.key) return;

      commit("SET_LOG", payload);
    },
    setChangedTab({ commit }, tab) {
      commit("SET_CHANGED_TAB", tab);
    },
    addEventAction({ commit }, payload) {
      commit("ADD_EVENT_ACTION", payload);
    },
    editEventAction({ commit }, payload) {
      commit("EDIT_EVENT_ACTION", payload);
    },
    removeEventAction({ commit }, payload) {
      commit("REMOVE_EVENT_ACTION", payload);
    },
    showSuccessSnackbar({ commit }, message) {
      commit("SHOW_SNACKBAR", { message, color: "success" });
    },
    hideSnackbar({ commit }) {
      commit("HIDE_SNACKBAR");
    },
  },
  getters: {
    isEventsChanged(state) {
      const keys = Object.keys(state.events);

      let changed = false;
      for (let idx = 0; idx < keys.length; idx++) {
        if (changed) break;
        const event = state.events[keys[idx]];

        let values = [];
        event.actions.forEach((action) =>
          values.push(action.index, action.value)
        );

        changed = event.values.join() !== values.join();
      }

      return changed;
    },
    snackbarState(state) {
      return state.snackbar;
    },
  },
});
