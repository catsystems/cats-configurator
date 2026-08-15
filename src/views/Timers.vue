<template>
  <div>
    <v-container fluid :class="{ 'pa-0': embedded }">
      <v-form ref="form">
        <v-row v-if="data && Object.keys(data).length >= timerKeys.length * 3">
          <v-col sm="12" md="6" xxl="3" v-for="key in timerKeys" :key="key">
            <v-card class="timer-card" height="auto" width="100%">
              <v-card-title>
                <v-row>
                  <v-col>
                    <span class="text-uppercase" v-text="getEventName(key)" />
                  </v-col>
                  <v-col
                    v-if="data[`${key}_active`]"
                    class="d-flex justify-end"
                  >
                    <v-switch
                      v-model="data[`${key}_active`].value"
                      :class="[
                        'timer-switch',
                        'mt-0',
                        {
                          'timer-switch--active': data[`${key}_active`].value,
                        },
                      ]"
                      color="primary"
                      density="compact"
                      hide-details
                      @update:model-value="(v) => onSwitcherChange(key, v)"
                    ></v-switch>
                  </v-col>
                </v-row>
              </v-card-title>
              <v-card-text
                v-if="data[`${key}_active`] && data[`${key}_active`].value"
              >
                <v-row density="compact">
                  <v-col cols="5">
                    <div class="text-capitalize py-2">Start</div>
                  </v-col>
                  <v-col>
                    <v-select
                      v-model="data[`${key}_start`].value"
                      :items="data[`${key}_start`].allowedValues"
                      variant="solo"
                      density="compact"
                      hide-details
                    ></v-select>
                  </v-col>
                </v-row>
                <v-row density="compact">
                  <v-col cols="5">
                    <div class="text-capitalize py-2">Duration</div>
                  </v-col>
                  <v-col>
                    <v-text-field
                      v-model.number="data[`${key}_duration`].value"
                      :min="data[`${key}_duration`].allowedRange[0] || 1"
                      :max="data[`${key}_duration`].allowedRange[1]"
                      :hint="data[`${key}_duration`].allowedRange.join(' to ')"
                      :rules="[
                        (v) =>
                          (v >= data[`${key}_duration`].allowedRange[0] &&
                            v <= data[`${key}_duration`].allowedRange[1]) ||
                          `Value should be from ${data[
                            `${key}_duration`
                          ].allowedRange.join(' to ')}`,
                      ]"
                      type="number"
                      hide-details="auto"
                      variant="solo"
                      density="compact"
                      @update:model-value="(v) => onDurationChange(key, v)"
                    >
                      <template #append-inner> ms </template>
                    </v-text-field>
                  </v-col>
                </v-row>
                <v-row density="compact">
                  <v-col cols="5">
                    <div class="text-capitalize py-2">Trigger</div>
                  </v-col>
                  <v-col>
                    <v-select
                      v-model="data[`${key}_trigger`].value"
                      :items="data[`${key}_trigger`].allowedValues"
                      variant="solo"
                      density="compact"
                      hide-details
                    ></v-select>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-form>
    </v-container>
    <ActionsBar
      v-if="!embedded"
      :saving="saveLoading"
      :changed="updated"
      @refresh="init"
      @save="onSave"
    />
  </div>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import ActionsBar from "@/components/ActionsBar.vue";
import { getTimers, setTimers } from "@/services/timerService";
import { TIMER_KEYS } from "@/modules/settings";

export default {
  name: "TimerView",
  props: {
    embedded: Boolean,
  },
  emits: ["change"],
  components: {
    ActionsBar,
  },
  data() {
    return {
      timerKeys: TIMER_KEYS,
      data: {},
      saveLoading: false,
    };
  },
  watch: {
    updated: {
      handler(changed) {
        if (this.embedded) this.$emit("change", changed);
        else this.setChangedTab(changed ? "timers" : null);
      },
      immediate: true,
    },
    timers: {
      handler(timers) {
        this.data = JSON.parse(JSON.stringify(timers));
      },
      deep: true,
      immediate: true,
    },
  },
  computed: {
    ...mapState(useAppStore, ["timers"]),
    updated() {
      return JSON.stringify(this.data) !== JSON.stringify(this.timers);
    },
  },
  mounted() {
    this.init();
  },
  methods: {
    ...mapActions(useAppStore, ["setChangedTab", "showErrorSnackbar"]),
    init() {
      getTimers();
    },
    onSwitcherChange(key, active) {
      if (!active) this.data[`${key}_duration`].value = 0;
      else this.data[`${key}_duration`].value = 1000;
    },
    onDurationChange(key, duration) {
      if (!duration) {
        this.data[`${key}_duration`].value = 0;
        this.data[`${key}_active`].value = false;
      }
    },
    async onSave() {
      const { valid } = await this.$refs.form.validate();
      if (!valid) return;
      this.saveLoading = true;
      try {
        const dataCopy = JSON.parse(JSON.stringify(this.data));
        for (const key of this.timerKeys) delete dataCopy[`${key}_active`];
        await setTimers(dataCopy, this.timers);
        await getTimers();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.saveLoading = false;
      }
    },
    getEventName(key) {
      let name = key.split("");
      name.splice(key.length - 1, 0, " ");
      return name.join("");
    },
  },
};
</script>

<style scoped>
.timer-card {
  min-height: 64px;
}

.timer-switch--active :deep(.v-switch__track) {
  background-color: rgb(var(--v-theme-primary)) !important;
  opacity: 1;
}
</style>
