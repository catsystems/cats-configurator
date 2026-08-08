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
      <div class="ml-auto">App version: {{ appVersion }}</div>
    </div>
  </v-footer>
</template>

<script>
import { mapState } from "pinia";
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
    }),
  },
};
</script>

<style></style>
