<template>
  <v-footer app dark>
    <div class="d-flex caption">
      <div class="mr-12">
        Status: {{ active ? "Connected" : "Disconnected" }}
      </div>
      <template v-if="active && version">
        <div class="mr-12" v-for="item in version" :key="item" cols="2">
          {{ item }}
        </div>
      </template>
    </div>
  </v-footer>
</template>

<script>
import { mapState } from "vuex";

export default {
  name: "Footer",
  computed: {
    ...mapState({
      version: (state) => state.static.version,
      active: (state) => state.active,
    }),
  },
};
</script>

<style></style>
