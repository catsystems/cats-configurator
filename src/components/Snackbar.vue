<template>
  <v-snackbar
    v-model="snackbarState.isVisible"
    :color="snackbarState.color"
    :timeout="snackbarState.timeout"
    @update:model-value="handleSnackbarInput"
    location="bottom"
  >
    {{ snackbarState.message }}

    <template #actions>
      <v-btn icon="mdi-close" variant="text" @click="hideSnackbar" />
    </template>
  </v-snackbar>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";

export default {
  name: "Snackbar",
  computed: {
    ...mapState(useAppStore, ["snackbarState"]),
  },
  methods: {
    ...mapActions(useAppStore, ["hideSnackbar"]),
    handleSnackbarInput(value) {
      if (!value) {
        this.hideSnackbar();
      }
    },
  },
};
</script>
