<template>
  <v-app-bar flat dense absolute bottom>
    <v-spacer></v-spacer>
    <div>
      <v-btn class="mr-2" @click="$emit('refresh')"> Refresh </v-btn>
      <v-btn color="primary" @click="$emit('save')"> Save </v-btn>
    </div>
  </v-app-bar>
</template>

<script>
export default {
  name: "ActionsBar",
};
</script>

<style></style>
