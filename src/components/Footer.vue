<template>
  <v-footer app color="grey-darken-4" theme="catsDark" class="app-footer">
    <div class="app-footer-content text-caption">
      <div>Status: {{ active ? "Connected" : "Disconnected" }}</div>
      <template v-if="active && version">
        <div v-for="item in version" :key="item">
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

<style scoped>
.app-footer {
  min-height: 32px;
  padding-block: 4px;
}

.app-footer-content {
  display: flex;
  flex-wrap: wrap;
  column-gap: clamp(12px, 4vw, 48px);
  width: 100%;
  overflow-wrap: anywhere;
}
</style>
