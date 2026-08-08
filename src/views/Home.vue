<template>
  <v-container fluid>
    <v-row>
      <v-col>
        <v-card class="home-card">
          <v-card-title> Welcome to the CATS configurator </v-card-title>
          <v-card-text>
            <p>
              Connect your board and get started. <br />
              If you are having issues connecting, please refer the getting
              started guide on
              <a
                href="https://github.com/catsystems/cats-embedded/wiki/Installation"
                @click.prevent="openDocumentation"
              >
                Github
              </a>
            </p>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-row>
      <v-col>
        <v-card
          class="home-card flight-log-card"
          @drop.prevent="onDrop($event)"
          @dragover.prevent="dragover = true"
          @dragenter.prevent="dragover = true"
          @dragleave.prevent="dragover = false"
          :class="{ 'bg-grey-lighten-2': dragover }"
        >
          <v-card-title> Flight Log Graphs </v-card-title>
          <v-card-text>
            <p v-if="errorString" v-text="errorString" style="color: red"></p>
            <v-file-input
              v-model="fileInput"
              variant="underlined"
              @drop.prevent="onDrop($event)"
              accept=".cfl"
              placeholder="Pick a flight log file"
              prepend-icon="mdi-file"
              label="Load flight log file "
              :loading="fileLoading"
              @update:model-value="loadFlightLog"
            ></v-file-input>
            <v-row v-if="flightLog" justify="end">
              <v-col cols="auto">
                <v-btn
                  color="primary"
                  @click="exportFlightLogCSVs"
                  :loading="exportButtonLoading"
                  >Export CSV</v-btn
                >
              </v-col>
              <v-col cols="auto">
                <v-btn
                  color="primary"
                  @click="exportFlightLogHtml"
                  :loading="exportButtonLoading"
                  >Export HTML</v-btn
                >
              </v-col>
            </v-row>
            <v-row>
              <v-col>
                <div
                  v-resize="setResizeTimer"
                  ref="flightLogPlotContainer"
                ></div>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { makePlots } from "../modules/plots";
import { useAppStore } from "@/store";

export default {
  name: "Home",
  data() {
    return {
      loadButtonLoading: false,
      exportButtonLoading: false,
      errorString: "",
      flightLog: null,
      resizeTimer: null,
      dragover: false,
      fileInput: undefined,
      fileLoading: false,
    };
  },
  computed: {
    ...mapState(useAppStore, ["useImperialUnits"]),
  },
  methods: {
    ...mapActions(useAppStore, ["showSuccessSnackbar", "showErrorSnackbar"]),
    openDocumentation() {
      return window.cats.app.openExternal(
        "https://github.com/catsystems/cats-embedded/wiki/Installation",
      );
    },
    async loadFlightLog(fileValue) {
      const file = Array.isArray(fileValue) ? fileValue[0] : fileValue;
      if (!file) return;
      this.loadButtonLoading = true;
      this.fileLoading = true;
      this.flightLog = null;
      const plotContainer = this.$refs.flightLogPlotContainer;

      try {
        const filePath = window.cats.flightLog.pathForDroppedFile(file);
        if (!filePath) throw new Error("Could not resolve the selected file.");
        this.flightLog = await window.cats.flightLog.load(filePath);
        this.errorString = "";
        this.showSuccessSnackbar("Flight logs loaded successfully!");
        await this.renderPlots();
      } catch (error) {
        this.errorString = error.message;
        if (plotContainer) plotContainer.replaceChildren();
      } finally {
        this.fileLoading = false;
        this.loadButtonLoading = false;
      }
    },
    async exportFlightLogCSVs() {
      this.exportButtonLoading = true;
      try {
        const outputPath = await window.cats.flightLog.exportCsv(
          this.flightLog,
        );
        if (outputPath) this.showSuccessSnackbar("Flight log CSVs exported!");
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.exportButtonLoading = false;
      }
    },
    async exportFlightLogHtml() {
      this.exportButtonLoading = true;
      try {
        const outputPath = await window.cats.flightLog.exportHtml(
          this.flightLog,
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
      const el = this.$refs.flightLogPlotContainer;
      if (el && this.flightLog) {
        await makePlots(this.flightLog, el, this.useImperialUnits);
      }
    },
    onDrop(event) {
      this.dragover = false;
      if (event.dataTransfer.files.length == 1) {
        const file = event.dataTransfer.files[0];
        this.fileLoading = true;
        this.loadFlightLog(file);
        this.fileInput = file;
      }
    },
  },
  watch: {
    useImperialUnits() {
      if (this.flightLog) {
        const savedWindowScrollY = window.scrollY;
        this.renderPlots();
        window.scrollTo(0, savedWindowScrollY);
      }
    },
  },
};
</script>

<style scoped>
.home-card :deep(.v-card-title) {
  min-height: 56px;
}

.flight-log-card {
  min-height: 150px;
}
</style>
