<template>
  <v-app>
    <AppBar />
    <NavPanel :items="navItems" />
    <Footer />

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script>
import { mapState, mapActions } from "vuex";
import AppBar from "@/components/AppBar";
import NavPanel from "@/components/NavigationPanel";
import Footer from "@/components/Footer";

export default {
  name: "App",
  components: {
    AppBar,
    NavPanel,
    Footer,
  },
  data() {
    return {
      navItems: [
        { title: "Configuration", link: "/config" },
        { title: "Events", link: "/events" },
        { title: "Timer", link: "/timer" },
        { title: "Log", link: "/log" },
        { title: "CLI", link: "/cli" },
      ],
    };
  },
  computed: {
    ...mapState({
      successSetMessage: (state) => state.successSetMessage,
    }),
  },
  mounted() {
    if (this.$route.path !== "/") this.$router.push("/");

    window.renderer.on("ALERT", (text) => {
      window.alert(text);
    });
    window.renderer.on("BOARD:STATIC_DATA", (data) => {
      this.setStaticData(data);
    });
    window.renderer.on("SET_ACTIVE", (value) => {
      this.setActiveState(value);
      if (value && this.$route.name !== "Config") this.$router.push("config");
    });
    window.renderer.on("SET_CONFIG", (config) => {
      if (config.type === "EVENT") this.setEvent(config);
      else if (config.key.includes("timer")) this.setTimer(config);
      else if (config.key.includes("rec_")) this.setLog(config);
      else this.setConfig(config);
    });
    window.renderer.on("SET_CONFIG_RESPONSE", () => {
      if (this.successSetMessage) return;
      this.setSuccessMessage("Values saved successfully!");
    });
  },
  methods: {
    ...mapActions([
      "setStaticData",
      "setActiveState",
      "setConfig",
      "setEvent",
      "setTimer",
      "setLog",
      "setSuccessMessage",
    ]),
  },
};
</script>

<style>
::-webkit-scrollbar {
  display: none;
}
</style>
