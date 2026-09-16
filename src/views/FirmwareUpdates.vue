<template>
  <v-container class="firmware-page pa-6">
    <div class="d-flex align-center flex-wrap ga-4 mb-6">
      <div>
        <h1 class="text-h4 mb-2">Firmware Updates</h1>
        <p class="text-medium-emphasis">
          Official stable firmware for your CATS devices.
        </p>
      </div>
      <v-spacer />
      <v-btn color="primary" :disabled="busy || !!changedTab" @click="check"
        >Check devices &amp; releases</v-btn
      >
    </div>

    <v-alert v-if="changedTab" type="warning" variant="tonal" class="mb-4"
      >Save or discard your configurator changes before updating
      firmware.</v-alert
    >
    <v-alert
      v-if="snapshot?.hardwareTest"
      type="warning"
      variant="tonal"
      class="mb-4"
      >Hardware-test build: firmware flashing is enabled for bench testing.
      Linux and macOS update flows have not yet passed hardware acceptance. Use
      only with deployment charges disconnected and keep the device connected
      until verification finishes.</v-alert
    >
    <v-alert
      v-if="snapshot && !snapshot.platformSupported"
      type="info"
      variant="tonal"
      class="mb-4"
      >Linux and macOS firmware integration is awaiting USB hardware acceptance.
      Device and release checks are available; flashing remains disabled until
      that platform passes acceptance.</v-alert
    >
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      role="alert"
      >{{ error }}</v-alert
    >

    <v-card
      v-if="snapshot"
      variant="tonal"
      class="pa-4 mb-6"
      aria-live="polite"
    >
      <div class="d-flex align-center ga-3">
        <strong>{{ stageLabel }}</strong>
        <v-spacer />
        <v-btn v-if="snapshot.cancellable" variant="text" @click="cancel"
          >Cancel</v-btn
        >
        <v-btn
          v-if="snapshot.canRetry"
          color="primary"
          :disabled="busy || !!changedTab"
          @click="retry"
          >{{
            snapshot.retryConnectionOnly
              ? "Retry connection check"
              : "Retry validated update"
          }}</v-btn
        >
      </div>
      <p class="mt-2">{{ snapshot.message }}</p>
      <v-btn
        v-if="snapshot.stage === 'prepared'"
        class="mt-4"
        color="primary"
        @click="radioGuideOpen = true"
        >Show installation guide</v-btn
      >
      <p v-if="snapshot.failedStage" class="text-caption mt-2">
        Failed stage: {{ snapshot.failedStage }}
      </p>
      <v-progress-linear
        v-if="busy"
        class="mt-4"
        color="primary"
        :model-value="snapshot.progress ?? 0"
        :indeterminate="snapshot.progress == null"
      />
      <p v-if="busy && !snapshot.cancellable" class="text-caption mt-3">
        Do not disconnect or reset the device. Closing Configurator is blocked
        until this operation finishes.
      </p>
    </v-card>

    <v-row>
      <v-col v-for="target in targets" :key="target.id" cols="12" lg="6">
        <v-card class="pa-5 h-100" variant="outlined">
          <h2 class="text-h5 mb-2">{{ target.name }}</h2>
          <p class="text-body-2 text-medium-emphasis mb-5">
            {{ target.description }}
          </p>
          <v-alert
            v-if="target.id === 'telemetry'"
            type="warning"
            variant="tonal"
            class="mb-4"
          >
            Ground Station radio-receiver updates require telemetry firmware
            1.2.0 or newer. If either receiver is on 1.1.3 or earlier, read the
            installation guide before continuing.
          </v-alert>
          <v-select
            v-model="selected[target.id]"
            :items="devices(target.id)"
            item-title="label"
            item-value="id"
            label="Detected device"
            :disabled="busy"
            no-data-text="No compatible device detected"
            variant="outlined"
            density="compact"
          />
          <dl class="firmware-versions mb-4">
            <dt>
              {{
                target.id === "telemetry"
                  ? "Radio 1 / Radio 2"
                  : "Installed version"
              }}
            </dt>
            <dd v-if="target.id === 'telemetry'">
              {{ device(target.id)?.telemetryVersions?.[0] ?? "Unknown" }} /
              {{ device(target.id)?.telemetryVersions?.[1] ?? "Unknown" }}
              (file, unverified)
            </dd>
            <dd v-else>
              {{ device(target.id)?.version ?? "Unknown"
              }}<span
                v-if="device(target.id)?.versionSource === 'version-json'"
              >
                (version.json)</span
              ><span
                v-if="device(target.id)?.versionSource === 'file-unverified'"
              >
                (file, unverified)</span
              >
              <span
                v-else-if="
                  device(target.id)?.version &&
                  device(target.id)?.versionSource === 'serial'
                "
              >
                (serial)</span
              >
            </dd>
            <dt>Available version</dt>
            <dd>{{ asset(target.id)?.version ?? "Unavailable" }}</dd>
          </dl>
          <p v-if="device(target.id)?.notice" class="text-body-2 mb-4">
            {{ device(target.id).notice }}
          </p>
          <p
            v-if="!asset(target.id)"
            class="text-body-2 text-medium-emphasis mb-4"
          >
            No eligible versioned asset was found. Legacy filenames are not used
            for automatic updates.
          </p>
          <v-btn
            color="primary"
            :disabled="!canUpdate(target.id)"
            @click="confirm(target.id)"
            >{{
              target.id === "telemetry"
                ? "Prepare radio firmware"
                : `Update ${target.name}`
            }}</v-btn
          >
          <v-btn
            v-if="target.id === 'telemetry'"
            class="mt-3 d-flex"
            variant="text"
            prepend-icon="mdi-help-circle-outline"
            @click="radioGuideOpen = true"
            >How to install on the GS</v-btn
          >
          <v-expansion-panels
            v-if="asset(target.id)"
            class="mt-5"
            variant="accordion"
          >
            <v-expansion-panel title="Release notes">
              <v-expansion-panel-text>
                <ReleaseNotes
                  :notes="asset(target.id).notes"
                  :release-url="asset(target.id).releaseUrl"
                  @error="localError = $event"
                />
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog
      v-model="radioGuideOpen"
      max-width="960"
      scrollable
      aria-labelledby="radio-guide-title"
    >
      <RadioUpdateGuide @close="radioGuideOpen = false" />
    </v-dialog>

    <v-dialog v-model="dialog" max-width="640" :persistent="busy">
      <v-card class="pa-5">
        <h2 class="text-h5 mb-3">
          {{
            confirmTarget === "telemetry"
              ? "Prepare Ground Station radio firmware"
              : "Confirm firmware update"
          }}
        </h2>
        <p class="mb-3">
          {{ confirmTarget === "telemetry" ? "Copy firmware" : "Install" }}
          {{ asset(confirmTarget)?.version }}
          {{ confirmTarget === "telemetry" ? "to" : "on" }}
          {{ device(confirmTarget)?.label }}?
        </p>
        <v-checkbox
          v-model="safetyConfirmed"
          :label="
            confirmTarget === 'vega'
              ? 'Deployment charges are disconnected and Vega is safely on the bench.'
              : confirmTarget === 'telemetry'
                ? 'This is my Ground Station drive. Tracking and recording have stopped, and its files are closed.'
                : 'Tracking and recording have stopped, and all Ground Station drive files are closed.'
          "
          hide-details
          class="mb-3"
        />
        <v-checkbox
          v-if="sameVersion"
          v-model="reinstallConfirmed"
          label="I want to reinstall the same firmware version."
          hide-details
          class="mb-3"
        />
        <v-checkbox
          v-if="unknownVersion"
          v-model="unknownConfirmed"
          label="The installed version is unknown or unverified. I want to continue without a verified installed version."
          hide-details
          class="mb-3"
        />
        <p
          v-if="confirmTarget === 'telemetry'"
          class="text-body-2 text-medium-emphasis mb-4"
        >
          Configurator prepares the file only. Safely eject the drive
          afterwards, then open Settings → System → Update Firmware → Radio
          Receivers on the Ground Station. Select the file and confirm updating
          both radios on its screen. Keep the Ground Station powered throughout
          the update.
        </p>
        <p v-else class="text-body-2 text-medium-emphasis mb-4">
          Keep USB connected. Cancellation is only available before entering the
          bootloader.
        </p>
        <div class="d-flex justify-end ga-3">
          <v-btn variant="text" @click="dialog = false">Back</v-btn
          ><v-btn color="primary" :disabled="!confirmed" @click="start">{{
            confirmTarget === "telemetry" ? "Prepare file" : "Start update"
          }}</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import ReleaseNotes from "@/components/ReleaseNotes.vue";
import RadioUpdateGuide from "@/components/RadioUpdateGuide.vue";

export default {
  name: "FirmwareUpdates",
  components: { ReleaseNotes, RadioUpdateGuide },
  data: () => ({
    targets: [
      {
        id: "vega",
        name: "Vega",
        description: "STM32 firmware · native USB DFU",
      },
      {
        id: "ground-station",
        name: "Ground Station",
        description: "ESP32-S2 firmware · updates through TinyUF2",
      },
      {
        id: "telemetry",
        name: "Ground Station radios",
        description:
          "Prepare the official telemetry image on the Ground Station USB drive, then follow the installation guide to update both radios on the device. Connect its normal USB drive to detect version.json.",
      },
    ],
    selected: {},
    localError: "",
    dialog: false,
    radioGuideOpen: false,
    confirmTarget: "vega",
    safetyConfirmed: false,
    reinstallConfirmed: false,
    unknownConfirmed: false,
  }),
  computed: {
    ...mapState(useAppStore, {
      snapshot: "firmware",
      busy: "firmwareBusy",
      changedTab: "changedTab",
    }),
    error() {
      return this.localError || this.snapshot?.error?.message;
    },
    stageLabel() {
      return this.snapshot?.stage
        ?.replaceAll("-", " ")
        .replace(/^./, (c) => c.toUpperCase());
    },
    sameVersion() {
      if (this.confirmTarget === "telemetry") {
        return (
          this.device("telemetry")?.telemetryVersions?.some(
            (version) =>
              version?.split("+")[0] === this.asset("telemetry")?.version,
          ) ?? false
        );
      }
      const installed = this.device(this.confirmTarget)?.version;
      return (
        !!installed &&
        installed.split("+")[0] === this.asset(this.confirmTarget)?.version
      );
    },
    unknownVersion() {
      const device = this.device(this.confirmTarget);
      return (
        !device?.version ||
        !["serial", "version-json"].includes(device.versionSource)
      );
    },
    confirmed() {
      return (
        this.safetyConfirmed &&
        (!this.sameVersion || this.reinstallConfirmed) &&
        (!this.unknownVersion || this.unknownConfirmed) &&
        !this.changedTab
      );
    },
  },
  watch: {
    "snapshot.devices": {
      immediate: true,
      handler() {
        for (const target of this.targets) {
          const devices = this.devices(target.id);
          if (!devices.some((device) => device.id === this.selected[target.id]))
            this.selected[target.id] =
              devices.length === 1 ? devices[0].id : null;
        }
      },
    },
  },
  async mounted() {
    await this.perform(() => window.cats.firmware.current());
  },
  methods: {
    ...mapActions(useAppStore, ["setFirmwareSnapshot"]),
    devices(target) {
      return (
        this.snapshot?.devices?.filter((device) => device.target === target) ??
        []
      );
    },
    device(target) {
      return this.devices(target).find(
        (device) => device.id === this.selected[target],
      );
    },
    asset(target) {
      return this.snapshot?.available?.find((asset) => asset.target === target);
    },
    canUpdate(target) {
      return (
        !this.busy &&
        !this.changedTab &&
        this.snapshot?.platformSupported &&
        !!this.device(target) &&
        !!this.asset(target)
      );
    },
    async perform(action) {
      this.localError = "";
      try {
        this.setFirmwareSnapshot(await action());
      } catch (error) {
        this.localError = error.message;
      }
    },
    check() {
      return this.perform(() => window.cats.firmware.check());
    },
    cancel() {
      return this.perform(() => window.cats.firmware.cancel());
    },
    retry() {
      return this.perform(() => window.cats.firmware.retry());
    },
    confirm(target) {
      this.confirmTarget = target;
      this.safetyConfirmed = false;
      this.reinstallConfirmed = false;
      this.unknownConfirmed = false;
      this.dialog = true;
    },
    async start() {
      if (!this.confirmed || !this.canUpdate(this.confirmTarget)) return;
      const request = {
        deviceId: this.device(this.confirmTarget).id,
        assetId: this.asset(this.confirmTarget).id,
        noUnsavedChanges: !this.changedTab,
        safetyConfirmed: this.safetyConfirmed,
        reinstallConfirmed: this.reinstallConfirmed,
        unknownVersionConfirmed: this.unknownConfirmed,
      };
      this.dialog = false;
      await this.perform(() => window.cats.firmware.start(request));
    },
  },
};
</script>

<style scoped>
.firmware-page {
  max-width: 1240px;
}
.firmware-versions {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 10px 20px;
}
.firmware-versions dt {
  opacity: 0.7;
}
.firmware-versions dd {
  margin: 0;
  font-weight: 600;
}
</style>
