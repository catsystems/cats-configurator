<template>
  <v-snackbar
      v-model="snackbarState.isVisible"
      :color="snackbarState.color"
      :timeout="snackbarState.timeout"
      @input="handleSnackbarInput"
      bottom
    >
      {{ snackbarState.message }}

    <template v-slot:action="{ attrs }">
      <v-btn
        text
        v-bind="attrs"
        @click="hideSnackbar"
      >
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </template>
  </v-snackbar>
</template>

<script>
import { mapGetters, mapActions } from "vuex";

export default {
  name: "Snackbar",
  computed: {
    ...mapGetters([ "snackbarState" ]),
  },
  methods: {
    ...mapActions([ "hideSnackbar" ]),
    handleSnackbarInput(value) {
      if (!value) {
        this.hideSnackbar(); 
      }
    }
  }
};
</script>
