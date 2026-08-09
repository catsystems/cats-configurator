<template>
  <v-app-bar color="grey-darken-4" theme="catsDark">
    <router-link class="app-brand" to="/" aria-label="CATS Configurator home">
      <img class="app-brand__mark" :src="logoImage" alt="" />
      <span class="app-brand__copy">
        <span class="app-brand__title">
          <strong>CATS</strong>
          <strong class="app-brand__product">Configurator</strong>
        </span>
        <span class="app-brand__tagline">Control &amp; Telemetry Systems</span>
      </span>
    </router-link>

    <v-spacer></v-spacer>
    <div class="app-bar-controls d-flex align-center">
      <v-btn
        class="mr-2"
        :loading="isFetchingPorts"
        :disabled="active || connectionPending"
        icon
        size="small"
        variant="elevated"
        @click="getPorts"
      >
        <v-icon color="primary">mdi-reload</v-icon>
      </v-btn>
      <v-select
        v-model="selectedPort"
        :items="serialPorts"
        :disabled="active || connectionPending"
        ref="portSelector"
        label="ports"
        no-data-text="No ports available"
        :item-title="portTitle"
        item-value="path"
        style="width: 220px"
        variant="solo-filled"
        density="compact"
        hide-details
        return-object
      >
      </v-select>
      <v-btn
        v-if="!active"
        color="primary"
        variant="elevated"
        class="ml-2"
        style="width: 120px"
        :loading="connectBtnLoading"
        :disabled="!selectedPort"
        @click="connect"
      >
        Connect
      </v-btn>
      <v-btn
        v-else
        color="error"
        variant="elevated"
        class="ml-2"
        style="width: 120px"
        :loading="connectBtnLoading"
        @click="disconnect"
      >
        disconnect
      </v-btn>
    </div>
  </v-app-bar>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import logoImage from "@/assets/logos/logo_white_small.png";
import {
  SERIAL_PORT_POLL_INTERVAL_MS,
  allowManualVegaConnection,
  createVegaPresenceState,
  getAutoConnectCandidate,
  getSerialPortLabel,
  isVegaSerialPort,
  markVegaConnectionAttempt,
  reconcileVegaCandidates,
  suppressVegaAutoConnect,
} from "@/modules/vega-autodetect.js";

export default {
  name: "AppBar",
  data() {
    return {
      isFetchingPorts: false,
      portScanInFlight: false,
      portScanTimer: null,
      connectionPending: false,
      connectBtnLoading: false,
      selectedPort: null,
      vegaPresence: createVegaPresenceState(),
      subscriptions: [],
      logoImage,
    };
  },
  computed: {
    ...mapState(useAppStore, ["serialPorts", "active"]),
  },
  watch: {
    active(value) {
      if (value) {
        this.connectionPending = false;
        this.connectBtnLoading = false;
      }
    },
  },
  mounted() {
    this.subscriptions.push(
      window.cats.serial.onError((message) => {
        this.connectionPending = false;
        this.connectBtnLoading = false;
        this.showErrorSnackbar(message);
      }),
      window.cats.serial.onDisconnected(() => {
        this.connectionPending = false;
        this.connectBtnLoading = false;
        this.setActiveState(false);
        this.$router.push("/");
      }),
    );
    void this.getPorts();
    this.portScanTimer = window.setInterval(
      () => void this.scanPorts(),
      SERIAL_PORT_POLL_INTERVAL_MS,
    );
  },
  beforeUnmount() {
    if (this.portScanTimer !== null) window.clearInterval(this.portScanTimer);
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
  },
  methods: {
    ...mapActions(useAppStore, [
      "setSerialPorts",
      "setActiveState",
      "showErrorSnackbar",
    ]),
    portTitle(port) {
      return getSerialPortLabel(port);
    },
    async getPorts() {
      await this.refreshPorts(true);
    },
    async scanPorts() {
      if (this.active || this.connectionPending) return;
      await this.refreshPorts(false);
    },
    async refreshPorts(showLoading) {
      if (this.portScanInFlight) return;
      this.portScanInFlight = true;
      if (showLoading) this.isFetchingPorts = true;
      try {
        const ports = await window.cats.serial.list();
        const selectedPath = this.selectedPort?.path;
        this.setSerialPorts(ports);
        this.selectedPort = selectedPath
          ? (ports.find(({ path }) => path === selectedPath) ?? null)
          : null;

        const candidates = reconcileVegaCandidates(this.vegaPresence, ports);
        const candidate = getAutoConnectCandidate(
          this.vegaPresence,
          candidates,
        );
        if (candidate && !this.active && !this.connectionPending) {
          this.selectedPort = candidate.port;
          await this.connect({ automatic: true });
        }
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        if (showLoading) this.isFetchingPorts = false;
        this.portScanInFlight = false;
      }
    },
    async connect({ automatic = false } = {}) {
      if (!this.selectedPort) return;
      if (isVegaSerialPort(this.selectedPort)) {
        if (!automatic) {
          allowManualVegaConnection(this.vegaPresence, this.selectedPort);
        }
        markVegaConnectionAttempt(this.vegaPresence, this.selectedPort);
      }
      this.connectionPending = true;
      this.connectBtnLoading = true;
      try {
        await window.cats.serial.connect(this.selectedPort.path);
      } catch (error) {
        this.connectionPending = false;
        this.connectBtnLoading = false;
        this.showErrorSnackbar(error.message);
      }
    },
    async disconnect() {
      if (isVegaSerialPort(this.selectedPort)) {
        suppressVegaAutoConnect(this.vegaPresence, this.selectedPort);
      }
      this.connectBtnLoading = true;
      try {
        await window.cats.serial.disconnect();
      } catch (error) {
        this.connectBtnLoading = false;
        this.showErrorSnackbar(error.message);
      }
    },
  },
};
</script>

<style scoped>
.app-brand {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  height: 48px;
  margin-inline-start: 20px;
  color: #f5f5f4;
  text-decoration: none;
}

.app-brand__mark {
  display: block;
  height: 48px;
  object-fit: contain;
  object-position: left center;
  width: 48px;
}

.app-brand__copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin-inline-start: 14px;
  font-family: var(--cats-font-display);
}

.app-brand__title {
  display: flex;
  gap: 7px;
  font-size: 27px;
  font-weight: 700;
  line-height: 27px;
  letter-spacing: -1.2px;
}

.app-brand__title strong {
  font-weight: 700;
}

.app-brand__product {
  color: rgb(var(--v-theme-primary));
}

.app-brand__tagline {
  margin-top: 3px;
  font-size: 10.5px;
  font-weight: 400;
  line-height: 11px;
  letter-spacing: -0.16px;
  text-transform: uppercase;
}

.app-bar-controls {
  padding-inline-end: 20px;
}

.v-btn--disabled.bg-primary {
  background-color: #424242 !important;
  color: rgba(255, 255, 255, 0.3) !important;
  opacity: 1;
}
</style>
