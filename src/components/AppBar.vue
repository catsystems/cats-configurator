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
        :disabled="active"
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
        :disabled="active"
        ref="portSelector"
        label="ports"
        no-data-text="No ports available"
        item-title="path"
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

export default {
  name: "AppBar",
  data() {
    return {
      isFetchingPorts: false,
      connectBtnLoading: false,
      selectedPort: null,
      subscriptions: [],
      logoImage,
    };
  },
  computed: {
    ...mapState(useAppStore, ["serialPorts", "active"]),
  },
  mounted() {
    this.getPorts();
    this.subscriptions.push(
      window.cats.serial.onConnected(() => {
        this.connectBtnLoading = false;
      }),
      window.cats.serial.onError((message) => {
        window.alert(message);
        this.connectBtnLoading = false;
      }),
      window.cats.serial.onDisconnected(() => {
        this.connectBtnLoading = false;
        this.setActiveState(false);
        this.$router.push("/");
      }),
    );
  },
  beforeUnmount() {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
  },
  methods: {
    ...mapActions(useAppStore, ["setSerialPorts", "setActiveState"]),
    async getPorts() {
      this.isFetchingPorts = true;
      try {
        this.setSerialPorts(await window.cats.serial.list());
      } catch (error) {
        window.alert(error.message);
      } finally {
        this.isFetchingPorts = false;
      }
    },
    async connect() {
      if (!this.selectedPort) return;
      this.connectBtnLoading = true;
      try {
        await window.cats.serial.connect(this.selectedPort.path);
      } catch (error) {
        this.connectBtnLoading = false;
        window.alert(error.message);
      }
    },
    async disconnect() {
      this.connectBtnLoading = true;
      try {
        await window.cats.serial.disconnect();
      } catch (error) {
        this.connectBtnLoading = false;
        window.alert(error.message);
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
