<template>
  <v-footer app height="32" color="grey-darken-4" theme="catsDark">
    <div class="d-flex text-caption" style="width: 100%">
      <div class="mr-12">
        Status: {{ active ? "Connected" : "Disconnected" }}
      </div>
      <template v-if="active && version">
        <div class="mr-12" v-for="item in version" :key="item" cols="2">
          {{ item }}
        </div>
      </template>
      <div class="ml-auto d-flex align-center">
        <AppUpdates />
      </div>
    </div>
  </v-footer>
</template>

<script>
import { mapState } from "pinia";
import { useAppStore } from "@/store";
import AppUpdates from "@/components/AppUpdates.vue";

export default {
  name: "AppFooter",
  components: { AppUpdates },
  computed: {
    ...mapState(useAppStore, {
      version: (store) =>
        (store.static.version ?? []).filter(
          (line) => !line.startsWith("Bundled Telemetry Code version:"),
        ),
      active: "active",
    }),
  },
};
</script>
