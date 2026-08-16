<template>
  <v-sheet class="actions-bar d-flex align-center px-4" elevation="4">
    <v-spacer></v-spacer>
    <div>
      <v-btn class="mr-2" @click="$emit('refresh')"> Refresh </v-btn>
      <v-btn color="primary" @click="$emit('save')"> Save </v-btn>
    </div>
  </v-sheet>
</template>

<script>
export default {
  name: "ActionsBar",
  emits: ["refresh", "save"],
};
</script>

<style scoped>
.actions-bar {
  position: fixed;
  right: 0;
  bottom: 32px;
  left: 300px;
  z-index: 1004;
  height: 52px;
}
</style>
