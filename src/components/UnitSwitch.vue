<template>
  <v-container class="py-0">
    <v-row align="center" justify="start">
      <v-col cols="auto">
        <v-switch
          v-model="useImperialUnitsState"
          label="Use imperial units"
          hide-details
          inset
          class="mt-0 pt-0"
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
/* These styles help align the switch better within its container */
.v-input--switch.mt-0 {
  margin-top: 0 !important;
}

.v-input--switch.pt-0 {
  padding-top: 0 !important;
}

/* You can adjust margin-right if the label is too close to the switch thumb */
.v-input--switch .v-label {
  margin-right: 8px;
}
</style>
