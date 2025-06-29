<template>
  <v-container fluid>
    <v-row>
        <v-col>
          <v-card>
            <v-card-title> Welcome to the CATS configurator </v-card-title>
            <v-card-text>
              <p>
                Connect your board and get started. <br />
                If you are having issues connecting, please refer the getting started
                guide on
                <a
                  href="https://github.com/catsystems/cats-embedded/wiki/Installation"
                  target="_blank"
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
            @drop.prevent="onDrop($event)"
            @dragover.prevent="dragover = true"
            @dragenter.prevent="dragover = true"
            @dragleave.prevent="dragover = false"
            :class="{ 'grey lighten-2': dragover }">
            <v-card-title> Flight Log Graphs </v-card-title>
            <v-card-text>
              <p v-if="errorString" v-text="errorString" style="color: red"></p>
              <v-file-input
                    v-model="fileInput"
                    @drop.prevent="onDrop($event)"
                    accept="(x) => {x.endsWith('.cfl')}"
                    validation-run="input"
                    placeholder="Pick a flight log file"
                    prepend-icon="mdi-file"
                    label="Load flight log file "
                    :loading="fileLoading"
                    @change=loadFlightLog
                  ></v-file-input>
              <v-row v-if="flightLog" justify="end">
                <v-col cols="auto">
                  <v-btn
                    color="primary"
                    @click="exportFlightLogCSVs"
                    :loading="exportButtonLoading">Export CSV</v-btn>
                </v-col>
                <v-col cols="auto">
                  <v-btn
                    color="primary"
                    @click="exportFlightLogHtml"
                    :loading="exportButtonLoading">Export HTML</v-btn>
                </v-col>
              </v-row>
              <v-row>
                <v-col>
                <div v-resize="setResizeTimer" ref="flightLogPlotContainer"></div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
  </v-container>
</template>

<script>
import { mapState, mapActions } from 'vuex';
import { makePlots } from '../modules/plots'

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
    ...mapState(['useImperialUnits']),
  },
  mounted() {
    window.renderer.on("LOAD_FLIGHTLOG", (flightLog) => {
      this.fileLoading = false
      let el = this.$refs.flightLogPlotContainer
      this.loadButtonLoading = false;
      if (flightLog.error) {
        this.errorString = flightLog.error;
        this.flightLog = null
        if (el) el.replaceChildren([])
        return;
      }
      this.errorString = "";
      this.flightLog = flightLog;
      this.showSuccessSnackbar("Flight logs loaded successfully!");

      if (el) makePlots(flightLog, el, this.useImperialUnits);
    });
    window.renderer.on("EXPORT_FLIGHTLOG_CSVS", (flightLog) => {
      this.exportButtonLoading = false;
      this.showSuccessSnackbar("Flight log CSVs exported!");
    });
    window.renderer.on("EXPORT_FLIGHTLOG_HTML", (flightLog) => {
      this.exportButtonLoading = false;
      this.showSuccessSnackbar("Flight log HTML plots exported!");
    });
  },
  methods: {
    ...mapActions(["showSuccessSnackbar"]),
    loadFlightLog(file) {
      this.loadButtonLoading = true;
      this.flightLog = null
      let filePath = window.webUtils.getPathForFile(file);
      if (filePath) {
        window.renderer.send("LOAD_FLIGHTLOG", filePath);
      }
    },
    exportFlightLogCSVs() {
      this.exportButtonLoading = true;
      window.renderer.send("EXPORT_FLIGHTLOG_CSVS", this.flightLog);
    },
    exportFlightLogHtml() {
      this.exportButtonLoading = true;
      window.renderer.send("EXPORT_FLIGHTLOG_HTML", this.$refs.flightLogPlotContainer.innerHTML);
    },
    setResizeTimer() {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(this.replot, 250)
    },
    replot() {
      let el = this.$refs.flightLogPlotContainer
      if (el && this.flightLog) {
        makePlots(this.flightLog, el, this.useImperialUnits);
      }
    },
    onDrop(event) {
      this.dragover = false;
      if (event.dataTransfer.files.length == 1) {
        this.fileLoading = true
        this.loadFlightLog(event.dataTransfer.files[0])
        this.fileInput = event.dataTransfer.files[0]
      }
    }
  },
  watch: {
    useImperialUnits(newValue) {
      if (this.flightLog) {
        const savedWindowScrollY = window.scrollY;
        this.replot();
        window.scrollTo(0, savedWindowScrollY);
      }
    }
  }
};
</script>
