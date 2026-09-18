<template>
  <v-app>
    <AppBar />
    <NavPanel :items="navItems" />
    <Snackbar />
    <AppFooter />

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import AppBar from "@/components/AppBar.vue";
import NavPanel from "@/components/NavigationPanel.vue";
import Snackbar from "@/components/Snackbar.vue";
import AppFooter from "@/components/Footer.vue";

export default {
  name: "App",
  components: {
    AppBar,
    NavPanel,
    Snackbar,
    AppFooter,
  },
  data() {
    return {
      subscriptions: [],
      navItems: [
        {
          title: "Configuration",
          link: "/config",
          requiresBoard: true,
        },
        {
          title: "Events & Timers",
          link: "/events",
          requiresBoard: true,
        },
        { title: "Profiles", link: "/profiles", requiresBoard: true },
        { title: "Preflight", link: "/preflight", requiresBoard: true },
        { title: "CLI", link: "/cli", requiresBoard: true },
        { title: "Flight Logs", link: "/flight-logs", requiresBoard: false },
        { title: "Firmware Updates", link: "/firmware", requiresBoard: false },
      ],
    };
  },
  mounted() {
    if (this.$route.path !== "/") this.$router.push("/");

    this.subscriptions.push(
      window.cats.firmware.onState((snapshot) =>
        this.setFirmwareSnapshot(snapshot),
      ),
      window.cats.app.onAlert((text) => window.alert(text)),
      window.cats.board.onStaticData((data) => this.setStaticData(data)),
      window.cats.board.onActive((value) => {
        const wasActive = this.active;
        this.setActiveState(value);
        if (this.firmwareBusy) return;
        if (value && !wasActive) {
          if (this.$route.name !== "Config") this.$router.push("/config");
        } else if (!value && wasActive) {
          this.setChangedTab(null);
          void window.cats.flightLog.clearOnboard();
          if (this.$route.meta.requiresBoard) this.$router.push("/");
        }
      }),
      window.cats.board.onConfig((payload) => {
        const configs = Array.isArray(payload) ? payload : [payload];
        configs.forEach((config) => {
          if (config.type === "EVENT") this.setEvent(config);
          else if (config.key.includes("timer")) this.setTimer(config);
          else if (config.key.includes("rec_")) this.setLog(config);
          else this.setConfig(config);
        });
      }),
      window.cats.board.onConfigSaved(() => {
        this.clearPreflightReport();
        this.clearCurrentBoardProfile();
        this.showSuccessSnackbar("Values saved successfully!");
      }),
    );
    void window.cats.firmware
      .current()
      .then(this.setFirmwareSnapshot)
      .catch((error) => this.showErrorSnackbar(error.message));
  },
  beforeUnmount() {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
  },
  computed: {
    ...mapState(useAppStore, ["active", "firmwareBusy"]),
  },
  methods: {
    ...mapActions(useAppStore, [
      "setFirmwareSnapshot",
      "setStaticData",
      "setActiveState",
      "setChangedTab",
      "setConfig",
      "setEvent",
      "setTimer",
      "setLog",
      "clearPreflightReport",
      "clearCurrentBoardProfile",
      "showSuccessSnackbar",
      "showErrorSnackbar",
    ]),
  },
};
</script>
