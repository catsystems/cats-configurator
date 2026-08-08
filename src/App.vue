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
import { mapActions } from "pinia";
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
        { title: "Configuration", link: "/config" },
        { title: "Events", link: "/events" },
        { title: "Timers", link: "/timer" },
        //{ title: "Log", link: "/log" },
        { title: "CLI", link: "/cli" },
      ],
    };
  },
  mounted() {
    if (this.$route.path !== "/") this.$router.push("/");

    this.subscriptions.push(
      window.cats.app.onAlert((text) => window.alert(text)),
      window.cats.board.onStaticData((data) => this.setStaticData(data)),
      window.cats.board.onActive((value) => {
        this.setActiveState(value);
        if (value && this.$route.name !== "Config")
          this.$router.push("/config");
      }),
      window.cats.board.onConfig((config) => {
        if (config.type === "EVENT") this.setEvent(config);
        else if (config.key.includes("timer")) this.setTimer(config);
        else if (config.key.includes("rec_")) this.setLog(config);
        else this.setConfig(config);
      }),
      window.cats.board.onConfigSaved(() => {
        this.showSuccessSnackbar("Values saved successfully!");
      }),
    );
  },
  beforeUnmount() {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
  },
  methods: {
    ...mapActions(useAppStore, [
      "setStaticData",
      "setActiveState",
      "setConfig",
      "setEvent",
      "setTimer",
      "setLog",
      "showSuccessSnackbar",
    ]),
  },
};
</script>
