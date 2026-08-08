<template>
  <v-navigation-drawer
    permanent
    order="1"
    width="300"
    color="grey-darken-4"
    theme="catsDark"
    class="navigation-panel pb-4"
  >
    <v-alert
      v-if="!active"
      density="compact"
      variant="tonal"
      type="info"
      class="mx-2 mt-2 text-caption"
    >
      Plug in CATS board and connect to activate this area.
    </v-alert>
    <v-alert
      v-if="changedTab"
      density="compact"
      variant="tonal"
      type="warning"
      class="mx-2 mt-2 text-caption"
    >
      <div class="d-flex justify-space-between align-center">
        <div>Unsaved changes.</div>
        <v-btn size="small" variant="text" @click="discard">discard</v-btn>
      </div>
    </v-alert>
    <v-card
      variant="flat"
      :disabled="!active || !!changedTab"
      color="transparent"
    >
      <v-list density="compact" nav>
        <v-list-item
          v-for="item in items"
          :key="item.title"
          :to="item.link"
          :title="item.title"
          color="primary"
        />
      </v-list>
    </v-card>
    <UnitSwitch class="unit-switch mb-2" />
  </v-navigation-drawer>
</template>

<script>
import { mapState } from "pinia";
import { useAppStore } from "@/store";
import { getConfigs } from "@/services/configService";
import { getEvents } from "@/services/eventService";
import { getTimers } from "@/services/timerService";
import { getLogData } from "@/services/logService";
import UnitSwitch from "./UnitSwitch.vue";

export default {
  name: "NavigationPanel",
  components: {
    UnitSwitch,
  },
  props: {
    items: {
      type: Array,
      default: () => [],
    },
  },
  computed: {
    ...mapState(useAppStore, ["active", "changedTab"]),
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

<style scoped>
.navigation-panel :deep(.v-navigation-drawer__content) {
  display: flex;
  flex-direction: column;
}

.navigation-panel :deep(.v-alert) {
  flex: 0 0 auto;
}

.navigation-panel :deep(.v-alert__content) {
  font-size: 12px;
  line-height: 20px;
}

.navigation-panel :deep(.v-list-item--active) {
  background: rgba(255, 167, 38, 0.3);
}

.navigation-panel :deep(.v-list-item--active .v-list-item__overlay) {
  opacity: 0;
}

.unit-switch {
  margin-top: auto;
}
</style>
