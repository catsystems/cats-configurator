<template>
  <v-container fluid>
    <FlightLogWorkspace title="Open a Vega flight log (.cfl)" />
  </v-container>
</template>

<script>
import FlightLogWorkspace from "@/components/FlightLogWorkspace.vue";

export default {
  name: "FlightLogs",
  components: {
    FlightLogWorkspace,
  },
};
</script>
