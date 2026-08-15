<template>
  <v-container class="py-0">
    <v-row align="center" justify="start">
      <v-col cols="auto">
        <v-switch
          v-model="useImperialUnitsState"
          label="Use imperial units"
          hide-details
          inset
          class="unit-switch mt-0 pt-0"
          :class="{ 'unit-switch--active': useImperialUnitsState }"
          color="primary"
        ></v-switch>
      </v-col>
      <v-tooltip location="top">
        <template #activator="{ props }">
          <v-icon color="primary" v-bind="props">
            mdi-information-variant-box-outline
          </v-icon>
        </template>
        <span
          >Flight Computer natively uses metric units; Imperial values will be
          converted to the nearest metric integer.</span
        >
      </v-tooltip>
    </v-row>
  </v-container>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";

export default {
  name: "UnitSwitch",
  computed: {
    ...mapState(useAppStore, ["useImperialUnits"]),
    useImperialUnitsState: {
      get() {
        return this.useImperialUnits;
      },
      set() {
        this.toggleUnitSystem();
      },
    },
  },
  methods: {
    ...mapActions(useAppStore, ["toggleUnitSystem"]),
  },
};
</script>

<style scoped>
.v-input--switch.mt-0 {
  margin-top: 0 !important;
}

.v-input--switch.pt-0 {
  padding-top: 0 !important;
}

.v-input--switch .v-label {
  margin-right: 8px;
}

.unit-switch :deep(.v-switch__track) {
  opacity: 0.72;
}

.unit-switch--active :deep(.v-switch__track) {
  background-color: rgb(var(--v-theme-primary)) !important;
  opacity: 1;
}

.unit-switch :deep(.v-switch__thumb) {
  color: white !important;
  background-color: white !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.38);
}
</style>
