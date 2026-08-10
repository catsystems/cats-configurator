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
      <div class="ml-auto d-flex align-center update-footer">
        <span v-if="updateLabel" class="update-footer__status">
          {{ updateLabel }}
        </span>
        <v-btn
          class="update-footer__version"
          size="x-small"
          variant="text"
          aria-label="Check for updates"
          title="Check for updates"
          :loading="updates.status === 'checking'"
          :disabled="updates.status === 'downloading'"
          @click="checkForUpdates"
        >
          App version: {{ appVersion }}
        </v-btn>
      </div>
    </div>
  </v-footer>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";

export default {
  name: "AppFooter",
  data() {
    return {
      appVersion: __APP_VERSION__,
    };
  },
  computed: {
    ...mapState(useAppStore, {
      version: (store) => store.static.version,
      active: "active",
      updates: "updates",
    }),
    updateLabel() {
      if (this.updates.status === "downloading") {
        return `Downloading update ${this.updates.progress ?? 0}%`;
      }
      if (this.updates.status === "ready") return "Update ready";
      if (this.updates.status === "unsupported") return "Update available";
      return "";
    },
  },
  methods: {
    ...mapActions(useAppStore, ["showErrorSnackbar"]),
    async checkForUpdates() {
      try {
        await window.cats.updates.check();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      }
    },
  },
};
</script>

<style scoped>
.update-footer {
  gap: 10px;
}

.update-footer__status {
  color: rgb(var(--v-theme-primary));
}

.update-footer__version {
  min-width: 0;
  padding-inline: 4px;
  text-transform: none;
}
</style>
