<template>
  <v-row v-if="active">
    <v-col>
      <v-card class="flight-log-card">
        <v-card-title class="d-flex align-center justify-space-between">
          <span>Onboard logs</span>
          <div class="d-flex ga-2">
            <v-btn
              size="small"
              variant="outlined"
              :loading="onboardLoading"
              @click="refreshOnboard"
            >
              Refresh
            </v-btn>
            <v-btn
              size="small"
              color="primary"
              :loading="onboardLoading"
              @click="chooseOnboardDrive"
            >
              Choose CATS drive
            </v-btn>
          </div>
        </v-card-title>
        <v-card-text>
          <p class="onboard-status">{{ onboardStatus }}</p>
          <v-list v-if="onboardLogs.length" lines="two">
            <v-list-item
              v-for="log in onboardLogs"
              :key="log.id"
              :title="log.name"
              :subtitle="formatFileSize(log.size)"
            >
              <template #append>
                <div class="d-flex ga-2 onboard-actions">
                  <v-btn
                    size="small"
                    color="primary"
                    :loading="busyLogId === log.id"
                    @click="viewOnboard(log)"
                  >
                    View locally
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="outlined"
                    :disabled="Boolean(busyLogId)"
                    @click="openOnboardInFlights(log)"
                  >
                    Open in Flights &nearr;
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="outlined"
                    :disabled="Boolean(busyLogId)"
                    @click="saveOnboard(log)"
                  >
                    Save a copy
                  </v-btn>
                </div>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>

  <v-row>
    <v-col>
      <v-card
        class="flight-log-card"
        :class="{ 'bg-grey-lighten-2': dragover }"
        @drop.prevent="onDrop($event)"
        @dragover.prevent="dragover = true"
        @dragenter.prevent="dragover = true"
        @dragleave.prevent="dragover = false"
      >
        <v-card-title>{{
          active ? "Open a Vega flight log (.cfl)" : title
        }}</v-card-title>
        <v-card-text>
          <p v-if="errorString" class="flight-log-error">{{ errorString }}</p>
          <v-file-input
            v-model="fileInput"
            variant="underlined"
            accept=".cfl"
            placeholder="Pick a flight log file"
            prepend-icon="mdi-file"
            label="Load flight log file"
            :loading="fileLoading"
            @drop.prevent="onDrop($event)"
            @update:model-value="loadFlightLog"
          />

          <div v-if="session" class="current-log-heading">
            <div>
              <span class="text-caption text-medium-emphasis">Current log</span>
              <strong>{{ session.name }}</strong>
            </div>
            <div class="d-flex flex-wrap ga-2 justify-end">
              <v-btn color="primary" @click="openCurrentInFlights">
                Open in Flights &nearr;
              </v-btn>
              <v-btn variant="outlined" @click="saveCurrent">Save a copy</v-btn>
              <v-btn
                variant="outlined"
                :loading="exportButtonLoading"
                @click="exportFlightLogCSVs"
              >
                Export CSV
              </v-btn>
              <v-btn
                variant="outlined"
                :loading="exportButtonLoading"
                @click="exportFlightLogHtml"
              >
                Export HTML
              </v-btn>
            </div>
          </div>

          <v-row>
            <v-col>
              <div v-resize="setResizeTimer" ref="flightLogPlotContainer" />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>

  <v-dialog v-model="handoffDialog" persistent max-width="560">
    <v-card>
      <v-card-title>Open in CATS Flights</v-card-title>
      <v-card-text>
        <p>{{ handoffState.message }}</p>
        <p class="text-body-2 text-medium-emphasis mt-3">
          Your browser may ask for local-network access. The log stays on this
          computer unless you explicitly save or share it in CATS Flights.
        </p>
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn variant="text" @click="cancelHandoff">Cancel</v-btn>
        <v-btn variant="outlined" @click="saveAndOpenManually">
          Save and open manually
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import { makePlots } from "@/modules/plots";
import { CATS_FLIGHTS_ANALYZE_URL } from "@/shared/flights";

export default {
  name: "FlightLogWorkspace",
  props: {
    title: {
      type: String,
      default: "Flight Log Graphs",
    },
  },
  data() {
    return {
      session: null,
      flightLog: null,
      fileInput: undefined,
      fileLoading: false,
      exportButtonLoading: false,
      errorString: "",
      dragover: false,
      resizeTimer: null,
      onboardLoading: false,
      onboardLogs: [],
      onboardStatus: "Looking for the mounted CATS drive...",
      busyLogId: null,
      handoffDialog: false,
      handoffState: {
        status: "waiting",
        message: "Waiting for CATS Flights to receive the log...",
      },
      subscriptions: [],
    };
  },
  computed: {
    ...mapState(useAppStore, ["active", "useImperialUnits"]),
  },
  async mounted() {
    this.subscriptions.push(
      window.cats.flightLog.onOnboardChanged((result) =>
        this.applyOnboardResult(result),
      ),
      window.cats.flightLog.onHandoffState((state) =>
        this.applyHandoffState(state),
      ),
    );
    const current = await window.cats.flightLog.current();
    if (current) await this.setSession(current, false);
    if (this.active) await this.discoverOnboard();
  },
  beforeUnmount() {
    clearTimeout(this.resizeTimer);
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
  },
  methods: {
    ...mapActions(useAppStore, ["showSuccessSnackbar", "showErrorSnackbar"]),
    async setSession(session, announce = true) {
      this.session = session;
      this.flightLog = session.flightLog;
      this.errorString = "";
      if (announce) this.showSuccessSnackbar("Flight log loaded successfully!");
      await this.$nextTick();
      await this.renderPlots();
    },
    async loadFlightLog(fileValue) {
      const file = Array.isArray(fileValue) ? fileValue[0] : fileValue;
      if (!file) return;
      this.fileLoading = true;
      try {
        const filePath = window.cats.flightLog.pathForDroppedFile(file);
        if (!filePath) throw new Error("Could not resolve the selected file.");
        await this.setSession(await window.cats.flightLog.load(filePath));
      } catch (error) {
        this.errorString = error.message;
        this.$refs.flightLogPlotContainer?.replaceChildren();
      } finally {
        this.fileLoading = false;
      }
    },
    async discoverOnboard() {
      this.onboardLoading = true;
      this.onboardStatus = "Looking for the mounted CATS drive...";
      try {
        this.applyOnboardResult(await window.cats.flightLog.discoverOnboard());
      } catch (error) {
        this.onboardStatus = error.message;
      } finally {
        this.onboardLoading = false;
      }
    },
    async chooseOnboardDrive() {
      this.onboardLoading = true;
      try {
        this.applyOnboardResult(
          await window.cats.flightLog.chooseOnboardDrive(),
        );
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.onboardLoading = false;
      }
    },
    async refreshOnboard() {
      this.onboardLoading = true;
      try {
        this.applyOnboardResult(await window.cats.flightLog.refreshOnboard());
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.onboardLoading = false;
      }
    },
    applyOnboardResult(result) {
      if (!result) return;
      this.onboardLogs = result.logs ?? [];
      const messages = {
        cancelled: "CATS drive selection was cancelled.",
        multiple:
          "More than one CATS drive was found. Choose the correct drive.",
        "not-found":
          "No mounted CATS drive was found. Connect the Vega or choose its drive.",
        ready: this.onboardLogs.length
          ? `${this.onboardLogs.length} onboard flight log${this.onboardLogs.length === 1 ? "" : "s"} available.`
          : "The mounted CATS drive contains no flight logs.",
        unavailable:
          "The CATS drive is no longer available. Reconnect it and refresh.",
      };
      this.onboardStatus =
        messages[result.status] ?? "CATS drive status updated.";
    },
    async viewOnboard(log) {
      this.busyLogId = log.id;
      try {
        await this.setSession(await window.cats.flightLog.openOnboard(log.id));
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.busyLogId = null;
      }
    },
    async openOnboardInFlights(log) {
      this.busyLogId = log.id;
      try {
        await this.setSession(
          await window.cats.flightLog.openOnboard(log.id),
          false,
        );
        await this.openCurrentInFlights();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.busyLogId = null;
      }
    },
    async saveOnboard(log) {
      this.busyLogId = log.id;
      try {
        await this.setSession(
          await window.cats.flightLog.openOnboard(log.id),
          false,
        );
        await this.saveCurrent();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.busyLogId = null;
      }
    },
    async saveCurrent() {
      if (!this.session) return;
      try {
        const outputPath = await window.cats.flightLog.saveOriginal(
          this.session.id,
        );
        if (outputPath) this.showSuccessSnackbar("Flight log saved!");
        return outputPath;
      } catch (error) {
        this.showErrorSnackbar(error.message);
        return null;
      }
    },
    async openCurrentInFlights() {
      if (!this.session) return;
      this.handoffState = {
        status: "waiting",
        message: "Waiting for CATS Flights to receive the log...",
      };
      this.handoffDialog = true;
      try {
        await window.cats.flightLog.openInFlights(this.session.id);
      } catch (error) {
        this.applyHandoffState({ status: "failed", message: error.message });
      }
    },
    applyHandoffState(state) {
      this.handoffState = state;
      if (state.status === "complete") {
        this.handoffDialog = false;
        this.showSuccessSnackbar(state.message);
      } else if (state.status === "cancelled") {
        this.handoffDialog = false;
      }
    },
    async cancelHandoff() {
      await window.cats.flightLog.cancelFlightsHandoff();
      this.handoffDialog = false;
    },
    async saveAndOpenManually() {
      const outputPath = await this.saveCurrent();
      if (!outputPath) return;
      await window.cats.flightLog.cancelFlightsHandoff();
      await window.cats.app.openExternal(CATS_FLIGHTS_ANALYZE_URL);
      this.handoffDialog = false;
    },
    async exportFlightLogCSVs() {
      if (!this.session) return;
      this.exportButtonLoading = true;
      try {
        const outputPath = await window.cats.flightLog.exportCsv(
          this.session.id,
        );
        if (outputPath) this.showSuccessSnackbar("Flight log CSVs exported!");
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.exportButtonLoading = false;
      }
    },
    async exportFlightLogHtml() {
      if (!this.session) return;
      this.exportButtonLoading = true;
      try {
        const outputPath = await window.cats.flightLog.exportHtml(
          this.session.id,
          this.useImperialUnits,
        );
        if (outputPath)
          this.showSuccessSnackbar("Flight log HTML plots exported!");
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.exportButtonLoading = false;
      }
    },
    setResizeTimer() {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(this.renderPlots, 250);
    },
    async renderPlots() {
      const element = this.$refs.flightLogPlotContainer;
      if (element && this.flightLog) {
        await makePlots(this.flightLog, element, this.useImperialUnits);
      }
    },
    onDrop(event) {
      this.dragover = false;
      if (event.dataTransfer.files.length !== 1) return;
      const file = event.dataTransfer.files[0];
      this.fileInput = file;
      void this.loadFlightLog(file);
    },
    formatFileSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      const megabytes = bytes / (1024 * 1024);
      if (megabytes >= 1)
        return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
      return `${Math.round(bytes / 1024)} KB`;
    },
  },
  watch: {
    active(value) {
      if (value) void this.discoverOnboard();
      else {
        this.onboardLogs = [];
        this.onboardStatus = "Connect a CATS board to browse onboard logs.";
      }
    },
    useImperialUnits() {
      if (this.flightLog) void this.renderPlots();
    },
  },
};
</script>

<style scoped>
.flight-log-card {
  min-height: 150px;
}

.flight-log-card :deep(.v-card-title) {
  min-height: 56px;
}

.flight-log-error {
  color: rgb(var(--v-theme-error));
}

.onboard-status {
  margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.current-log-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 12px 0 18px;
}

.current-log-heading > div:first-child {
  display: grid;
  gap: 2px;
}

@media (max-width: 1000px) {
  .current-log-heading,
  .onboard-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
