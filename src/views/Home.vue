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
          <v-card>
            <v-card-title> Load a flight log file </v-card-title>
            <v-card-text>
              <p v-if="errorString" v-text="errorString" style="color: red"></p>
              <v-row>
                <v-col>
                  <v-btn
                    color="primary"
                    block
                    @click="loadFlightLog"
                    :loading="loadButtonLoading">Load file</v-btn>
                </v-col>
                <v-col cols="2" v-if="flightLog">
                  <v-btn
                    color="primary"
                    @click="exportFlightLogJson"
                    :loading="exportButtonLoading">Export JSON</v-btn>
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
    };
  },
  mounted() {
    window.renderer.on("LOAD_FLIGHTLOG", (flightLog) => {
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

      if (el) makePlots(flightLog, el)
    });
    window.renderer.on("EXPORT_FLIGHTLOG_JSON", (flightLog) => {
      this.exportButtonLoading = false;
    });
  },
  methods: {
    loadFlightLog() {
      this.loadButtonLoading = true;
      this.flightLog = null
      window.renderer.send("LOAD_FLIGHTLOG");
    },
    exportFlightLogJson() {
      this.exportButtonLoading = true;
      window.renderer.send("EXPORT_FLIGHTLOG_JSON", this.flightLog);
    },
    setResizeTimer() {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = setTimeout(this.replot, 250)
    },
    replot() {
      let el = this.$refs.flightLogPlotContainer
      if (el && this.flightLog) makePlots(this.flightLog, el)
    },
  },
};
</script>
