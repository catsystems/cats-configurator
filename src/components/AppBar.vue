<template>
  <v-app-bar app dark clipped-left>
    <v-toolbar-title class="d-flex">
      <v-img
        height="48"
        width="48"
        contain
        position="left"
        src="@/assets/logos/logo_white_small.png"
      />
      <v-img
        height="48"
        width="100"
        contain
        position="left"
        src="@/assets/logos/text_white.png"
      />
    </v-toolbar-title>

    <v-spacer></v-spacer>
    <div class="d-flex align-center">
      <v-btn
        class="mr-2"
        :loading="isFetchingPorts"
        :disabled="active"
        fab
        small
        @click="getPorts"
      >
        <v-icon color="primary">mdi-reload</v-icon>
      </v-btn>
      <v-select
        v-model="selectedPort"
        :items="serialPorts"
        :disabled="active"
        ref="portSelector"
        label="ports"
        no-data-text="No ports available"
        item-text="path"
        item-value="path"
        style="width: 220px"
        solo
        dense
        hide-details
        return-object
      >
      </v-select>
      <v-btn
        v-if="!active"
        color="primary"
        class="ml-2"
        :loading="connectBtnLoading"
        :disabled="!selectedPort"
        @click="connect"
      >
        Connect
      </v-btn>
      <v-btn
        v-else
        color="error"
        class="ml-2"
        :loading="connectBtnLoading"
        @click="disconnect"
      >
        disconnect
      </v-btn>
    </div>
  </v-app-bar>
</template>

<script>
import { mapState, mapActions } from "vuex";

export default {
  name: "AppBar",
  data() {
    return {
      isFetchingPorts: false,
      connectBtnLoading: false,
      connected: false,
      selectedPort: null,
    };
  },
  computed: {
    ...mapState({
      serialPorts: (state) => state.serialPorts,
      active: (state) => state.active,
    }),
  },
  mounted() {
    this.getPorts();
    window.renderer.on("FETCH_SERIAL_PORTS", (ports) => {
      this.isFetchingPorts = false;
      this.setSerialPorts(ports);
    });
    window.renderer.on("CONNECTED", () => {
      this.connected = true;
      this.connectBtnLoading = false;
    });
    window.renderer.on("CONNECTION_ERROR", (message) => {
      window.alert(message);
      this.connected = false;
      this.connectBtnLoading = false;
    });
    window.renderer.on("DISCONNECTED", () => {
      this.connectBtnLoading = false;
      this.setActiveState(null);
      this.$router.push("/");
    });
  },
  methods: {
    ...mapActions(["setSerialPorts", "setActiveState"]),
    getPorts() {
      this.isFetchingPorts = true;
      window.renderer.send("FETCH_SERIAL_PORTS");
    },
    connect() {
      if (!this.selectedPort) return;
      this.connectBtnLoading = true;
      window.renderer.send("CONNECT", this.selectedPort.path);
    },
    disconnect() {
      this.connectBtnLoading = true;
      window.renderer.send("DISCONNECT");
    },
  },
};
</script>

<style></style>
