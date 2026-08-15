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
              <v-btn
                color="error"
                variant="elevated"
                block
                @click="resetConfig"
              >
                Reset Config
              </v-btn>
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
                v-if="showFlightEstimate && processedStatus.length > 3"
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
      <v-row>
        <v-col>
          <v-expansion-panels v-model="openSections" multiple>
            <v-expansion-panel value="logging">
              <v-expansion-panel-title>
                <span class="text-h6">Logging</span>
                <v-chip
                  v-if="loggingChanged"
                  class="ml-3"
                  color="warning"
                  size="small"
                  variant="tonal"
                >
                  Unsaved changes
                </v-chip>
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <Logs ref="logging" embedded @change="onLoggingChange" />
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </v-col>
      </v-row>
    </v-container>
    <ActionsBar
      :saving="saveLoading"
      :changed="changed"
      @refresh="refreshAll"
      @save="onSave"
    />
  </div>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import { getConfigs, setConfigs } from "@/services/configService";
import { getLogInfo } from "@/services/logService";
import ActionsBar from "@/components/ActionsBar.vue";
import Logs from "@/views/Logs.vue";
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
    Logs,
  },
  data() {
    return {
      timer: null,
      saveLoading: false,
      data: null,
      imperialData: null,
      lastSavedData: null,
      lastSavedImperialData: null,
      loggingChanged: false,
      openSections: [],
      subscriptions: [],
    };
  },
  watch: {
    displayData: {
      handler() {
        this.updateChangedState();
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
      useImperialUnits: "useImperialUnits",
    }),
    configurationChanged() {
      const savedData = this.useImperialUnits
        ? this.lastSavedImperialData
        : this.lastSavedData;
      return JSON.stringify(this.displayData) !== JSON.stringify(savedData);
    },
    changed() {
      return this.configurationChanged || this.loggingChanged;
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
    showFlightEstimate() {
      const state = this.status?.find((line) => /^State:/i.test(line));
      return !/^State:\s*(?:INVALID|TESTING)\b/i.test(state || "");
    },
    displayData() {
      return this.useImperialUnits ? this.imperialData : this.data;
    },
  },
  mounted() {
    if (this.$route?.query?.section === "logging") {
      this.openSections = ["logging"];
    }
    this.init();
    this.subscriptions.push(
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
      getLogInfo();
      this.getInfo();
    },
    refreshAll() {
      this.init();
    },
    onLoggingChange(changed) {
      this.loggingChanged = changed;
      this.updateChangedState();
    },
    updateChangedState() {
      this.setChangedTab(this.changed ? "config" : null);
    },
    getInfo() {
      window.cats.board.getInfo();
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        window.cats.board.getInfo();
      }, 250);
    },
    async onSave() {
      if (this.configurationChanged) {
        const forms = [
          this.$refs.generalForm,
          this.$refs.telemetryForm,
          this.$refs.testingForm,
        ].filter(Boolean);
        const validation = await Promise.all(
          forms.map((form) => form.validate()),
        );
        if (validation.some(({ valid }) => !valid)) return;
      }

      this.saveLoading = true;
      try {
        if (this.configurationChanged) {
          let metricData;
          if (this.useImperialUnits) {
            metricData = convertImperialDataToMetric(this.displayData);
          } else {
            metricData = this.displayData;
          }
          await setConfigs(metricData, this.lastSavedData);
        }
        if (this.loggingChanged) await this.$refs.logging?.onSave();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.saveLoading = false;
      }
    },
    async resetConfig() {
      const confirmed = window.confirm(
        "Configuration is about to be reset to default values,\nwould you like to proceed?",
      );

      if (confirmed) {
        try {
          await window.cats.board.reset();
          await getConfigs();
        } catch (error) {
          this.showErrorSnackbar(error.message);
        }
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
