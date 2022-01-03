<template>
  <v-app-bar flat dense absolute bottom>
    <div v-if="message">
      <v-icon color="success" class="mr-2">mdi-check-circle-outline</v-icon>
      <span v-text="message" class="success--text caption" />
    </div>
    <v-spacer></v-spacer>
    <div>
      <v-btn class="mr-2" @click="$emit('refresh')"> Refresh </v-btn>
      <v-btn color="primary" @click="$emit('save')"> Save </v-btn>
    </div>
  </v-app-bar>
</template>

<script>
import { mapState } from "vuex";

export default {
  name: "ActionsBar",
  computed: {
    ...mapState({
      message: (state) => state.successSetMessage,
    }),
  },
};
</script>

<style></style>
