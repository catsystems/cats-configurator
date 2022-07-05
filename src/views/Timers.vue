<template>
  <div>
    <v-container fluid>
      <v-form ref="form">
        <v-row v-if="data && Object.keys(data).length >= timerKeys.length * 3">
          <v-col sm="12" md="6" xl="3" v-for="key in timerKeys" :key="key">
            <v-card height="auto" width="100%">
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
                      class="mt-0"
                      dense
                      hide-details
                      @change="(v) => onSwitcherChange(key, v)"
                    ></v-switch>
                  </v-col>
                </v-row>
              </v-card-title>
              <v-card-text
                v-if="data[`${key}_active`] && data[`${key}_active`].value"
              >
                <v-row dense>
                  <v-col cols="5">
                    <div class="text-capitalize py-2">Start</div>
                  </v-col>
                  <v-col>
                    <v-select
                      v-model="data[`${key}_start`].value"
                      :items="data[`${key}_start`].allowedValues"
                      solo
                      dense
                      hide-details
                    ></v-select>
                  </v-col>
                </v-row>
                <v-row dense>
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
                      solo
                      dense
                      @change="(v) => onDurationChange(key, v)"
                    >
                      <template #append> ms </template>
                    </v-text-field>
                  </v-col>
                </v-row>
                <v-row dense>
                  <v-col cols="5">
                    <div class="text-capitalize py-2">End</div>
                  </v-col>
                  <v-col>
                    <v-select
                      v-model="data[`${key}_end`].value"
                      :items="data[`${key}_end`].allowedValues"
                      solo
                      dense
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
    <ActionsBar @refresh="init" @save="onSave" />
  </div>
</template>

<script>
import { mapState, mapActions } from "vuex";
import ActionsBar from "@/components/ActionsBar";
import { getTimers, setTimers } from "@/services/timerService";
import { TIMER_KEYS } from "@/modules/settings";

export default {
  name: "TimerView",
  components: {
    ActionsBar,
  },
  data() {
    return {
      timerKeys: TIMER_KEYS,
      data: {},
    };
  },
  watch: {
    data: {
      handler(data) {
        let changed = JSON.stringify(data) !== JSON.stringify(this.timers);

        if (this.changed !== changed) {
          this.setChangedTab(changed ? "timers" : null);
        }
      },
      deep: true,
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
    ...mapState({
      timers: (state) => state.timers,
      changedTab: (state) => state.changedTab,
    }),
  },
  mounted() {
    this.init();
  },
  methods: {
    ...mapActions(["setChangedTab"]),
    init() {
      getTimers();
    },
    onSwitcherChange(key, active) {
      if (!active) this.data[`${key}_duration`].value = 0;
      else this.data[`${key}_duration`].value = 1;
    },
    onDurationChange(key, duration) {
      if (!duration) {
        this.data[`${key}_duration`].value = 0;
        this.data[`${key}_active`].value = false;
      }
    },
    onSave() {
      if (!this.$refs.form.validate()) return;
      // TODO fix this later
      const { timer1_active, timer2_active, timer3_active, timer4_active, ...dataCopy } = this.data;
      setTimers(dataCopy);
      setTimeout(function () {
        getTimers();
      }, 100);
    },
    getEventName(key) {
      let name = key.split("");
      name.splice(key.length - 1, 0, " ");
      return name.join("");
    },
  },
};
</script>

<style></style>
