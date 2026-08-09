<template>
  <v-container fluid>
    <v-row>
      <v-col>
        <v-card class="home-card">
          <v-card-title>Welcome to the CATS configurator</v-card-title>
          <v-card-text>
            <p>
              Connect your board and get started. <br />
              If you are having issues connecting, please refer to the getting
              started guide on
              <a
                href="https://github.com/catsystems/cats-embedded/wiki/Installation"
                @click.prevent="openDocumentation"
              >
                GitHub
              </a>
            </p>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <FlightLogWorkspace />
  </v-container>
</template>

<script>
import FlightLogWorkspace from "@/components/FlightLogWorkspace.vue";

export default {
  name: "Home",
  components: {
    FlightLogWorkspace,
  },
  methods: {
    openDocumentation() {
      return window.cats.app.openExternal(
        "https://github.com/catsystems/cats-embedded/wiki/Installation",
      );
    },
  },
};
</script>

<style scoped>
.home-card :deep(.v-card-title) {
  min-height: 56px;
}
</style>
