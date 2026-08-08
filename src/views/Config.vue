<template>
  <div>
    <v-container fluid>
      <v-row>
        <v-col>
          <v-card v-if="displayData" height="100%" class="config-card">
            <v-card-title>General</v-card-title>
            <v-card-text class="config-fields">
              <v-form ref="generalForm">
                <v-row
                  v-for="key in Object.keys(displayData)"
                  :key="key"
                  class="config-row"
                  density="compact"
                >
                  <v-col cols="6" v-if="displayData[key].section === 'general'">
                    <div
                      class="text-capitalize py-2"
                      v-text="displayData[key].name"
                    />
                  </v-col>
                  <v-col cols="6" v-if="displayData[key].section === 'general'">
                    <v-select
                      v-if="displayData[key].type === 'SELECT'"
                      v-model="displayData[key].value"
                      :items="displayData[key].allowedValues"
                      solo
                      density="compact"
                      hide-details
                    ></v-select>
                    <v-text-field
                      v-if="displayData[key].type === 'NUMBER'"
                      v-model.number="displayData[key].value"
                      :min="displayData[key].allowedRange[0]"
                      :max="displayData[key].allowedRange[1]"
                      :rules="[
                        (v) =>
                          (v >= displayData[key].allowedRange[0] &&
                            v <= displayData[key].allowedRange[1]) ||
                          `Value should be from ${displayData[
                            key
                          ].allowedRange.join(' to ')}`,
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="number"
                      hide-details="auto"
                      solo
                      density="compact"
                    >
                      <template #append-inner>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                    <v-text-field
                      v-if="displayData[key].type === 'STRING'"
                      v-model="displayData[key].value"
                      :rules="[
                        (v) => {
                          if (
                            v.length < displayData[key].allowedRange[0] ||
                            v.length > displayData[key].allowedRange[1]
                          ) {
                            return `String must have length between ${displayData[
                              key
                            ].allowedRange.join(' and ')}`;
                          } else if (v.match(/^[_a-z0-9]+$/i) === null) {
                            return `String may only contain alphanumeric characters`;
                          }
                          return true;
                        },
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="text"
                      hide-details="auto"
                      solo
                      density="compact"
                    >
                      <template #append-inner>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                  </v-col>
                </v-row>
              </v-form>
            </v-card-text>
            <v-card-actions>
              <v-row density="compact">
                <v-col cols="6">
                  <v-btn
                    color="primary"
                    variant="elevated"
                    :disabled="changed"
                    :loading="backupLoading"
                    block
                    @click="backupConfig"
                  >
                    Backup Config
                  </v-btn>
                </v-col>
                <v-col cols="6">
                  <v-btn
                    color="primary"
                    variant="elevated"
                    block
                    :loading="restoreLoading"
                    @click="loadConfig"
                  >
                    Load Config
                  </v-btn>
                </v-col>
                <v-col cols="12">
                  <v-btn
                    color="error"
                    variant="elevated"
                    block
                    @click="resetConfig"
                  >
                    Reset Settings
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-actions>
          </v-card>
        </v-col>
        <v-col>
          <v-card
            v-if="status && status.length"
            height="100%"
            class="config-card"
          >
            <v-card-title>Info</v-card-title>
            <v-card-text>
              <div
                v-for="(item, index) in status.slice(0, 3)"
                :key="index"
                class="mb-2"
                v-text="item"
              ></div>
              <div
                v-if="processedStatus && processedStatus.length > 3"
                class="mb-2"
                v-text="processedStatus[3]"
              ></div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-card
            v-if="status && status.length"
            height="100%"
            class="config-card"
          >
            <v-card-title>Telemetry</v-card-title>
            <v-card-text class="config-fields">
              <v-form ref="telemetryForm">
                <template v-if="displayData">
                  <v-row
                    v-for="key in Object.keys(displayData)"
                    :key="key"
                    class="config-row"
                    density="compact"
                  >
                    <v-col
                      cols="6"
                      v-if="displayData[key].section === 'telemetry'"
                    >
                      <div
                        class="text-capitalize py-2"
                        v-text="displayData[key].name"
                      />
                    </v-col>
                    <v-col
                      cols="6"
                      v-if="displayData[key].section === 'telemetry'"
                    >
                      <v-select
                        v-if="displayData[key].type === 'SELECT'"
                        v-model="displayData[key].value"
                        :items="displayData[key].allowedValues"
                        solo
                        density="compact"
                        hide-details
                      ></v-select>
                      <v-text-field
                        v-if="displayData[key].type === 'NUMBER'"
                        v-model.number="displayData[key].value"
                        :min="displayData[key].allowedRange[0]"
                        :max="displayData[key].allowedRange[1]"
                        :rules="[
                          (v) =>
                            (v >= displayData[key].allowedRange[0] &&
                              v <= displayData[key].allowedRange[1]) ||
                            `Value should be from ${displayData[
                              key
                            ].allowedRange.join(' to ')}`,
                        ]"
                        :hint="displayData[key].allowedRange.join(' to ')"
                        type="number"
                        hide-details="auto"
                        solo
                        density="compact"
                      >
                        <template #append-inner>
                          {{ displayData[key].unit }}
                        </template>
                      </v-text-field>
                      <v-text-field
                        v-if="displayData[key].type === 'STRING'"
                        v-model="displayData[key].value"
                        :rules="[
                          (v) => {
                            if (
                              v.length < displayData[key].allowedRange[0] ||
                              v.length > displayData[key].allowedRange[1]
                            ) {
                              return `String must have length between ${displayData[
                                key
                              ].allowedRange.join(' and ')}`;
                            } else if (v.match(/^[_a-z0-9]+$/i) === null) {
                              return `String may only contain alphanumeric characters`;
                            }
                            return true;
                          },
                        ]"
                        :hint="displayData[key].allowedRange.join(' to ')"
                        type="text"
                        hide-details="auto"
                        solo
                        density="compact"
                      >
                        <template #append-inner>
                          {{ displayData[key].unit }}
                        </template>
                      </v-text-field>
                    </v-col>
                  </v-row>
                </template>
              </v-form>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col>
          <v-card
            v-if="status && status.length"
            height="100%"
            class="config-card testing-card"
          >
            <v-card-title>Testing</v-card-title>
            <v-card-text class="config-fields">
              <v-form ref="testingForm">
                <template v-if="displayData">
                  <v-row
                    v-for="key in Object.keys(displayData)"
                    :key="key"
                    class="config-row"
                    density="compact"
                  >
                    <v-col
                      cols="6"
                      v-if="displayData[key].section === 'testing'"
                    >
                      <div
                        class="text-capitalize py-2"
                        v-text="displayData[key].name"
                      />
                    </v-col>
                    <v-col
                      cols="6"
                      v-if="displayData[key].section === 'testing'"
                    >
                      <v-select
                        v-if="displayData[key].type === 'SELECT'"
                        v-model="displayData[key].value"
                        :items="displayData[key].allowedValues"
                        solo
                        density="compact"
                        hide-details
                      ></v-select>
                      <v-text-field
                        v-if="displayData[key].type === 'NUMBER'"
                        v-model.number="displayData[key].value"
                        :min="displayData[key].allowedRange[0]"
                        :max="displayData[key].allowedRange[1]"
                        :rules="[
                          (v) =>
                            (v >= displayData[key].allowedRange[0] &&
                              v <= displayData[key].allowedRange[1]) ||
                            `Value should be from ${displayData[
                              key
                            ].allowedRange.join(' to ')}`,
                        ]"
                        :hint="displayData[key].allowedRange.join(' to ')"
                        type="number"
                        hide-details="auto"
                        solo
                        density="compact"
                      >
                        <template #append-inner>
                          {{ displayData[key].unit }}
                        </template>
                      </v-text-field>
                      <v-text-field
                        v-if="displayData[key].type === 'STRING'"
                        v-model="displayData[key].value"
                        :rules="[
                          (v) => {
                            if (
                              v.length < displayData[key].allowedRange[0] ||
                              v.length > displayData[key].allowedRange[1]
                            ) {
                              return `String must have length between ${displayData[
                                key
                              ].allowedRange.join(' and ')}`;
                            } else if (v.match(/^[_a-z0-9]+$/i) === null) {
                              return `String may only contain alphanumeric characters`;
                            }
                            return true;
                          },
                        ]"
                        :hint="displayData[key].allowedRange.join(' to ')"
                        type="text"
                        hide-details="auto"
                        solo
                        density="compact"
                      >
                        <template #append-inner>
                          {{ displayData[key].unit }}
                        </template>
                      </v-text-field>
                    </v-col>
                  </v-row>
                </template>
              </v-form>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
    <ActionsBar @refresh="init" @save="onSave" />
  </div>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import { getConfigs, setConfigs } from "@/services/configService";
import ActionsBar from "@/components/ActionsBar.vue";
import { getDisplayValue } from "@/utils/unitConversions";
import {
  convertLengthToImperial,
  convertAccelerationToImperial,
  convertLengthToMetric,
  convertAccelerationToMetric,
} from "../utils/unitConversions";

function convertMetricDataToImperial(data) {
  const imperialData = JSON.parse(JSON.stringify(data));

  if (imperialData.main_altitude) {
    imperialData.main_altitude.value = Math.round(
      convertLengthToImperial(data.main_altitude.value),
    );
    imperialData.main_altitude.allowedRange =
      data.main_altitude.allowedRange.map((value) =>
        Math.round(convertLengthToImperial(value)),
      );
    imperialData.main_altitude.unit = "ft";
  }

  if (imperialData.acc_threshold) {
    imperialData.acc_threshold.value = Math.round(
      convertAccelerationToImperial(data.acc_threshold.value),
    );
    imperialData.acc_threshold.allowedRange =
      data.acc_threshold.allowedRange.map((value) =>
        Math.round(convertAccelerationToImperial(value)),
      );
    imperialData.acc_threshold.unit = "ft/s²";
  }

  return imperialData;
}

function convertImperialDataToMetric(data) {
  const metricData = JSON.parse(JSON.stringify(data));

  if (metricData.main_altitude) {
    metricData.main_altitude.value = Math.round(
      convertLengthToMetric(data.main_altitude.value),
    );
    metricData.main_altitude.allowedRange = data.main_altitude.allowedRange.map(
      (value) => Math.round(convertLengthToMetric(value)),
    );
    metricData.main_altitude.unit = "m";
  }

  if (metricData.acc_threshold) {
    metricData.acc_threshold.value = Math.round(
      convertAccelerationToMetric(data.acc_threshold.value),
    );
    metricData.acc_threshold.allowedRange = data.acc_threshold.allowedRange.map(
      (value) => Math.round(convertAccelerationToMetric(value)),
    );
    metricData.acc_threshold.unit = "m/s²";
  }

  return metricData;
}

export default {
  name: "ConfigView",
  components: {
    ActionsBar,
  },
  data() {
    return {
      timer: null,
      backupLoading: false,
      restoreLoading: false,
      data: null,
      imperialData: null,
      lastSavedData: null,
      lastSavedImperialData: null,
      subscriptions: [],
    };
  },
  watch: {
    displayData: {
      handler(data) {
        let changed;
        if (this.useImperialUnits) {
          changed =
            JSON.stringify(data) !== JSON.stringify(this.lastSavedImperialData);
        } else {
          changed = JSON.stringify(data) !== JSON.stringify(this.lastSavedData);
        }

        if (this.changed !== changed) {
          this.setChangedTab(changed ? "config" : null);
        }
      },
      deep: true,
    },
    config: {
      handler(config) {
        this.lastSavedData = JSON.parse(JSON.stringify(config));
        this.lastSavedImperialData = convertMetricDataToImperial(config);

        this.data = JSON.parse(JSON.stringify(config));
        this.imperialData = convertMetricDataToImperial(this.data);
      },
      deep: true,
    },
    useImperialUnits(newValue) {
      if (!newValue) {
        this.data = convertImperialDataToMetric(this.imperialData);
      } else {
        this.imperialData = convertMetricDataToImperial(this.data);
      }
    },
  },
  computed: {
    ...mapState(useAppStore, {
      config: "config",
      status: (store) => store.static.status,
      changedTab: "changedTab",
      useImperialUnits: "useImperialUnits",
    }),
    changed() {
      return this.changedTab === "config";
    },
    processedStatus() {
      if (!this.status || !Array.isArray(this.status)) {
        return [];
      }
      return this.status.map((line, index) => {
        if (index === 3 && this.useImperialUnits) {
          return this.convertStatusLine4(line);
        }
        return line;
      });
    },
    displayData() {
      return this.useImperialUnits ? this.imperialData : this.data;
    },
  },
  mounted() {
    this.init();
    this.subscriptions.push(
      window.cats.board.onDumpComplete((result) => {
        this.backupLoading = false;
        if (result?.error) this.showErrorSnackbar(result.error);
        else this.showSuccessSnackbar("Backup created!");
      }),
      window.cats.serial.onDisconnected(() => clearInterval(this.timer)),
    );
    if (this.useImperialUnits && this.data !== null) {
      this.imperialData = convertMetricDataToImperial(this.data);
    }
  },

  beforeUnmount() {
    clearInterval(this.timer);
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
  },
  methods: {
    ...mapActions(useAppStore, [
      "setChangedTab",
      "showSuccessSnackbar",
      "showErrorSnackbar",
    ]),
    init() {
      getConfigs();
      this.getInfo();
    },
    getInfo() {
      window.cats.board.getInfo();
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        window.cats.board.getInfo();
      }, 250); // every 250 ms
    },
    async onSave() {
      const forms = [
        this.$refs.generalForm,
        this.$refs.telemetryForm,
        this.$refs.testingForm,
      ].filter(Boolean);
      const validation = await Promise.all(
        forms.map((form) => form.validate()),
      );
      if (validation.some(({ valid }) => !valid)) return;

      if (this.useImperialUnits) {
        setConfigs(convertImperialDataToMetric(this.displayData));
      } else {
        setConfigs(this.displayData);
      }

      getConfigs();
    },
    async backupConfig() {
      this.backupLoading = true;
      try {
        await window.cats.board.dump();
      } catch (error) {
        this.backupLoading = false;
        this.showErrorSnackbar(error.message);
      }
    },
    async loadConfig() {
      const confirmed = window.confirm(
        "Configuration is about to be restored,\nwould you like to proceed?",
      );

      if (confirmed) {
        this.restoreLoading = true;
        try {
          const result = await window.cats.board.restore();
          if (!result.canceled) setTimeout(this.init, 100);
        } catch (error) {
          this.showErrorSnackbar(error.message);
        } finally {
          this.restoreLoading = false;
        }
      }
    },
    async resetConfig() {
      const confirmed = window.confirm(
        "Configuration is about to be reset to default values,\nwould you like to proceed?",
      );

      if (confirmed) {
        await window.cats.board.reset();
        this.init();
      }
    },
    convertStatusLine4(statusLine) {
      const regex =
        /h:\s*(-?\d*\.?\d+)\s*m,\s*v:\s*(-?\d*\.?\d+)\s*m\/s,\s*a:\s*(-?\d*\.?\d+)\s*m\/s\^2/;
      const match = statusLine.match(regex);

      if (match) {
        const rawAltitude = parseFloat(match[1]);
        const rawVelocity = parseFloat(match[2]);
        const rawAcceleration = parseFloat(match[3]);

        const displayAltitude = getDisplayValue(rawAltitude, "altitude", {
          targetUnitSystem: "imperial",
          numeric: false,
        });
        const displayVelocity = getDisplayValue(rawVelocity, "velocity", {
          targetUnitSystem: "imperial",
          numeric: false,
        });
        const displayAcceleration = getDisplayValue(
          rawAcceleration,
          "acceleration",
          { targetUnitSystem: "imperial", numeric: false },
        );

        return `h: ${displayAltitude}, v: ${displayVelocity}, a: ${displayAcceleration}`;
      } else {
        console.warn("Could not parse status line for conversion:", statusLine);
        return statusLine;
      }
    },
  },
};
</script>

<style scoped>
.config-card :deep(.v-card-title) {
  min-height: 64px;
  padding: 16px;
  font-size: 20px;
  line-height: 32px;
}

.config-card :deep(.config-row) {
  margin: -4px;
}

.config-card :deep(.config-row > .v-col) {
  padding: 4px;
}

.config-card :deep(.config-fields) {
  padding-bottom: 44px;
}

.testing-card :deep(.config-fields) {
  padding-top: 20px;
}
</style>
