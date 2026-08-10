<template>
  <v-dialog v-model="visible" max-width="560">
    <v-card>
      <v-card-title>Configurator update</v-card-title>
      <v-card-text>
        <template v-if="updates.status === 'ready'">
          <p>
            CATS Configurator {{ updates.availableVersion }} has been downloaded
            and verified.
          </p>
          <p class="mt-3 text-medium-emphasis">
            Reveal {{ updates.assetName }} and launch it manually when you are
            ready to update.
          </p>
        </template>
        <template v-else>
          <p>
            CATS Configurator {{ updates.availableVersion }} is available, but
            Configurator could not prepare a verified download.
          </p>
          <p class="mt-3 text-medium-emphasis">
            {{ updates.message }} Open the release page to download it manually.
          </p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="openRelease">View release notes</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="dismiss">Later</v-btn>
        <v-btn
          v-if="updates.status === 'ready'"
          color="primary"
          variant="elevated"
          @click="reveal"
        >
          Reveal downloaded file
        </v-btn>
        <v-btn v-else color="primary" variant="elevated" @click="openRelease">
          Open release page
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";

export default {
  name: "UpdateDialog",
  data() {
    return {
      visible: false,
      dismissedVersion: null,
    };
  },
  computed: {
    ...mapState(useAppStore, ["updates"]),
  },
  watch: {
    updates: {
      deep: true,
      immediate: true,
      handler(state) {
        const shouldOpen =
          ["ready", "unsupported"].includes(state.status) ||
          (state.status === "error" && state.availableVersion);
        if (shouldOpen && state.availableVersion !== this.dismissedVersion) {
          this.visible = true;
        }
      },
    },
  },
  methods: {
    ...mapActions(useAppStore, ["showSuccessSnackbar", "showErrorSnackbar"]),
    dismiss() {
      this.dismissedVersion = this.updates.availableVersion;
      this.visible = false;
    },
    async reveal() {
      try {
        await window.cats.updates.reveal();
        this.visible = false;
        this.showSuccessSnackbar("The verified update file was revealed.");
      } catch (error) {
        this.showErrorSnackbar(error.message);
      }
    },
    async openRelease() {
      try {
        await window.cats.updates.openRelease();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      }
    },
  },
};
</script>
