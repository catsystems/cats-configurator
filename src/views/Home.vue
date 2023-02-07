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
              <p v-if="flightlog" v-text="flightlog">
              </p>
              <v-btn
                color="primary"
                block
                @click="loadFlightLog"
                :loading="connectBtnLoading">Load file</v-btn>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
  </v-container>
</template>

<script>
export default {
  name: "Home",
  data() {
    return {
      connectBtnLoading: false,
      flightlog: "",
    };
  },
  mounted() {
    window.renderer.on("LOAD_FLIGHTLOG", (parsed) => {
      if (!parsed)
        this.flightlog = "Error while loading";
      else
        this.flightlog = parsed;
      this.connectBtnLoading = false;
    });
  },
  methods: {
    loadFlightLog() {
      this.connectBtnLoading = true;
      window.renderer.send("LOAD_FLIGHTLOG");
    },
  },
};
</script>
