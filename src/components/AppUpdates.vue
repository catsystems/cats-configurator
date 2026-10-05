<template>
  <button
    type="button"
    class="app-version"
    title="Check for updates"
    :aria-busy="checking"
    :disabled="checking || installing || firmwareBusy"
    @click="check(true)"
  >
    App version: {{ appVersion }}
  </button>
  <v-dialog v-model="dialog" max-width="560" :persistent="installing">
    <v-card title="Configurator update">
      <v-card-text>
        <p>CATS Configurator {{ update?.version }} is available.</p>
        <p v-if="!update?.canInstall" class="mt-3">
          Download and install the new Debian package to update Configurator.
        </p>
        <p v-else-if="blocked" class="mt-3">{{ blocked }}</p>
        <p v-else-if="active" class="mt-3">
          Configurator will disconnect the device and restart after
          installation.
        </p>
        <p v-else class="mt-3">Configurator will restart after installation.</p>
        <v-progress-linear
          v-if="installing"
          :model-value="progress ?? 0"
          :indeterminate="progress == null || updateStage !== 'downloading'"
          class="mt-4"
        />
        <p v-if="installing" class="mt-3">{{ installLabel }}</p>
        <v-alert v-if="error" type="error" class="mt-4">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="installing || firmwareBusy" @click="openRelease">
          View release notes
        </v-btn>
        <v-btn :disabled="installing" @click="dialog = false">Later</v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          :loading="installing"
          :disabled="installing || (!!update?.canInstall && !!blocked)"
          @click="install"
        >
          {{ update?.canInstall ? "Install and restart" : "Download update" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import { mapActions, mapState, mapWritableState } from "pinia";
import { useAppStore } from "@/store";

export default {
  name: "AppUpdates",
  data() {
    return {
      appVersion: __APP_VERSION__,
      update: null,
      dialog: false,
      checking: false,
      error: "",
      progress: null,
      updateStage: "preparing",
      unsubscribeProgress: null,
    };
  },
  computed: {
    ...mapWritableState(useAppStore, { installing: "appUpdating" }),
    ...mapState(useAppStore, ["active", "changedTab", "firmwareBusy"]),
    installLabel() {
      if (this.updateStage === "preparing") return "Preparing update…";
      if (this.updateStage === "installing") return "Verifying and installing…";
      return this.progress == null
        ? "Downloading…"
        : `Downloading ${this.progress}%`;
    },
    blocked() {
      if (this.firmwareBusy)
        return "Wait for the firmware operation to finish.";
      if (this.changedTab)
        return "Save or discard your changes before updating.";
      return "";
    },
  },
  mounted() {
    this.unsubscribeProgress = window.cats.app.onUpdateProgress(
      ({ stage, progress }) => {
        if (!this.installing) return;
        this.updateStage = stage;
        this.progress = progress;
      },
    );
    void this.check(false);
  },
  beforeUnmount() {
    this.unsubscribeProgress();
  },
  methods: {
    ...mapActions(useAppStore, ["showSuccessSnackbar", "showErrorSnackbar"]),
    async openRelease() {
      try {
        await window.cats.app.openExternal(
          "https://github.com/catsystems/cats-configurator/releases/latest",
        );
      } catch (error) {
        this.error = error.message;
      }
    },
    async check(manual) {
      if (this.checking || this.installing || this.firmwareBusy) return;
      this.checking = true;
      this.error = "";
      try {
        this.update = await window.cats.app.checkUpdate();
        if (this.update) this.dialog = true;
        else if (manual)
          this.showSuccessSnackbar("Configurator is up to date.");
      } catch (error) {
        if (manual)
          this.showErrorSnackbar(
            `Could not check for updates. ${error.message}`,
          );
      } finally {
        this.checking = false;
      }
    },
    async install() {
      if (!this.update || this.installing) return;
      if (this.update.canInstall && this.blocked) return;
      this.error = "";
      if (!this.update.canInstall) {
        await this.openRelease();
        return;
      }
      this.progress = null;
      this.updateStage = "preparing";
      this.installing = true;
      try {
        await window.cats.app.installUpdate();
      } catch (error) {
        this.error = `Could not install the update. ${error.message}`;
      } finally {
        this.installing = false;
      }
    },
  },
};
</script>

<style scoped>
.app-version {
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.app-version:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
