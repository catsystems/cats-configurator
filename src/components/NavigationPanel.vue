<template>
  <v-navigation-drawer app dark clipped permanent width="300">
    <v-alert v-if="!active" dense text type="info" class="mx-2 mt-2 caption">
      Plug in CATS board and connect to activate this panel.
    </v-alert>
    <v-alert
      v-if="changedTab"
      dense
      text
      type="warning"
      class="mx-2 mt-2 caption"
    >
      <div class="d-flex justify-space-between align-center">
        <div>Unsaved changes.</div>
        <v-btn small text @click="discard">discard</v-btn>
      </div>
    </v-alert>
    <v-card flat :disabled="!active || !!changedTab" color="transparent">
      <v-list dense nav>
        <v-list-item-group color="primary">
          <v-list-item v-for="item in items" :key="item.title" :to="item.link">
            <v-list-item-content>
              <v-list-item-title v-text="item.title"></v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list-item-group>
      </v-list>
    </v-card>
  </v-navigation-drawer>
</template>

<script>
import { mapState } from "vuex";
import { getConfigs } from "@/services/configService";
import { getEvents } from "@/services/eventService";
import { getTimers } from "@/services/timerService";
import { getLogData } from "@/services/logService";

export default {
  name: "NavigationPanel",
  props: {
    items: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    ...mapState({
      active: (state) => state.active,
      changedTab: (state) => state.changedTab,
    }),
  },
  methods: {
    discard() {
      switch (this.changedTab) {
        case "config":
          getConfigs();
          break;
        case "events":
          getEvents();
          break;
        case "timers":
          getTimers();
          break;
        case "logs":
          getLogData();
          break;
      }
    },
  },
};
</script>

<style></style>
