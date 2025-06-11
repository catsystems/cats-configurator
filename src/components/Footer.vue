<template>
  <v-footer app dark>
    <div class="d-flex caption" style="width: 100%">
      <div class="mr-12">
        Status: {{ active ? "Connected" : "Disconnected" }}
      </div>
      <template v-if="active && version">
        <div class="mr-12" v-for="item in version" :key="item" cols="2">
          {{ item }}
        </div>
      </template>
      <div class="ml-auto">
        App version: {{ appVersion }}
      </div>
    </div>
  </v-footer>
</template>

<script>
import { mapState } from "vuex";

export default {
  name: "Footer",
  data() {
    return {
      appVersion: __APP_VERSION__
    };
  },
  computed: {
    ...mapState({
      version: (state) => state.static.version,
      active: (state) => state.active,
    }),
  },
};
</script>

<style></style>
