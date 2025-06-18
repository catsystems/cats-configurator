<template>
  <div>
    <v-container fluid>
      <v-row>
        <v-col>
          <v-card v-if="displayData" height="100%">
            <v-card-title>General</v-card-title>
            <v-card-text>
              <v-form ref="form">
                <v-row v-for="key in Object.keys(displayData)" :key="key" dense>
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
                      dense
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
                          `Value should be from ${displayData[key].allowedRange.join(
                            ' to '
                          )}`,
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="number"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                    <v-text-field
                      v-if="displayData[key].type === 'STRING'"
                      v-model="displayData[key].value"
                      :rules="[
                        (v) => {
                          if (v.length < displayData[key].allowedRange[0] ||
                            v.length > displayData[key].allowedRange[1]) {
                            return `String must have length between ${displayData[key].allowedRange.join(
                              ' and '
                            )}`
                          } else if (v.match(/^[_a-z0-9]+$/i) === null) {
                            return `String may only contain alphanumeric characters`
                          }
                          return true
                        }
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="text"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                  </v-col>
                </v-row>
              </v-form>
            </v-card-text>
            <v-card-actions>
              <v-row dense>
                <v-col cols="6">
                  <v-btn
                    color="primary"
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
                    block
                    :loading="restoreLoading"
                    @click="loadConfig"
                  >
                    Load Config
                  </v-btn>
                </v-col>
                <v-col cols="12">
                  <v-btn color="error" block @click="resetConfig">
                    Reset Settings
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-actions>
          </v-card>
        </v-col>
        <v-col>
          <v-card v-if="status && status.length" height="100%">
            <v-card-title>Info</v-card-title>
            <v-card-text>
              <div v-for="(item, index) in status.slice(0, 3)" :key="index" class="mb-2" v-text="item"></div>
              <div v-if="processedStatus && processedStatus.length > 3" class="mb-2" v-text="processedStatus[3]"></div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-card v-if="status && status.length" height="100%">
            <v-card-title>Telemetry</v-card-title>
            <v-card-text>
              <v-form ref="form">
                <v-row v-for="key in Object.keys(displayData)" :key="key" dense>
                  <v-col cols="6" v-if="displayData[key].section === 'telemetry'">
                    <div
                      class="text-capitalize py-2"
                      v-text="displayData[key].name"
                    />
                  </v-col>
                  <v-col cols="6" v-if="displayData[key].section === 'telemetry'">
                    <v-select
                      v-if="displayData[key].type === 'SELECT'"
                      v-model="displayData[key].value"
                      :items="displayData[key].allowedValues"
                      solo
                      dense
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
                          `Value should be from ${displayData[key].allowedRange.join(
                            ' to '
                          )}`,
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="number"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                    <v-text-field
                      v-if="displayData[key].type === 'STRING'"
                      v-model="displayData[key].value"
                      :rules="[
                        (v) => {
                          if (v.length < displayData[key].allowedRange[0] ||
                            v.length > displayData[key].allowedRange[1]) {
                            return `String must have length between ${displayData[key].allowedRange.join(
                              ' and '
                            )}`
                          } else if (v.match(/^[_a-z0-9]+$/i) === null) {
                            return `String may only contain alphanumeric characters`
                          }
                          return true
                        }
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="text"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                  </v-col>
                </v-row>
              </v-form>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col>
          <v-card v-if="status && status.length" height="100%">
            <v-card-title>Testing</v-card-title>
            <v-card-text>
              <v-form ref="form">
                <v-row v-for="key in Object.keys(displayData)" :key="key" dense>
                  <v-col cols="6" v-if="displayData[key].section === 'testing'">
                    <div
                      class="text-capitalize py-2"
                      v-text="displayData[key].name"
                    />
                  </v-col>
                  <v-col cols="6" v-if="displayData[key].section === 'testing'">
                    <v-select
                      v-if="displayData[key].type === 'SELECT'"
                      v-model="displayData[key].value"
                      :items="displayData[key].allowedValues"
                      solo
                      dense
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
                          `Value should be from ${displayData[key].allowedRange.join(
                            ' to '
                          )}`,
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="number"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                    <v-text-field
                      v-if="displayData[key].type === 'STRING'"
                      v-model="displayData[key].value"
                      :rules="[
                        (v) => {
                          if (v.length < displayData[key].allowedRange[0] ||
                            v.length > displayData[key].allowedRange[1]) {
                            return `String must have length between ${displayData[key].allowedRange.join(
                              ' and '
                            )}`
                          } else if (v.match(/^[_a-z0-9]+$/i) === null) {
                            return `String may only contain alphanumeric characters`
                          }
                          return true
                        }
                      ]"
                      :hint="displayData[key].allowedRange.join(' to ')"
                      type="text"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ displayData[key].unit }}
                      </template>
                    </v-text-field>
                  </v-col>
                </v-row>
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
import { mapState, mapActions } from "vuex";
import { getConfigs, setConfigs } from "@/services/configService";
import ActionsBar from "@/components/ActionsBar";
import { getDisplayValue } from "@/utils/unitConversions";
import { convertLengthToImperial, convertAccelerationToImperial, convertLengthToMetric, convertAccelerationToMetric } from "../utils/unitConversions";

function convertMetricDataToImperial(data) {
  const imperialData = structuredClone(data);
      
  imperialData["main_altitude"].value = Math.round(convertLengthToImperial(
    data["main_altitude"].value
  ));
  imperialData["main_altitude"].allowedRange[0] = Math.round(convertLengthToImperial(
    data["main_altitude"].allowedRange[0]
  ));
  imperialData["main_altitude"].allowedRange[1] = Math.round(convertLengthToImperial(
    data["main_altitude"].allowedRange[1]
  ));
  imperialData["main_altitude"].unit = "ft";

  imperialData["acc_threshold"].value = Math.round(convertAccelerationToImperial(
    data["acc_threshold"].value
  ));
  imperialData["acc_threshold"].allowedRange[0] = Math.round(convertAccelerationToImperial(
    data["acc_threshold"].allowedRange[0]
  ));
  imperialData["acc_threshold"].allowedRange[1] = Math.round(convertAccelerationToImperial(
    data["acc_threshold"].allowedRange[1]
  ));
  imperialData["acc_threshold"].unit = "ft/s²";

  return imperialData;
}

function convertImperialDataToMetric(data) {
  const metricData = structuredClone(data);

  metricData["main_altitude"].value = Math.round(convertLengthToMetric(
    data["main_altitude"].value
  ));
  metricData["main_altitude"].allowedRange[0] = Math.round(convertLengthToMetric(
    data["main_altitude"].allowedRange[0]
  ));
  metricData["main_altitude"].allowedRange[1] = Math.round(convertLengthToMetric(
    data["main_altitude"].allowedRange[1]
  ));
  metricData["main_altitude"].unit = "m";

  metricData["acc_threshold"].value = Math.round(convertAccelerationToMetric(
    data["acc_threshold"].value
  ));
  metricData["acc_threshold"].allowedRange[0] = Math.round(convertAccelerationToMetric(
    data["acc_threshold"].allowedRange[0]
  ));
  metricData["acc_threshold"].allowedRange[1] = Math.round(convertAccelerationToMetric(
    data["acc_threshold"].allowedRange[1]
  ));
  metricData["acc_threshold"].unit = "m/s²";

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
      data: {},
      imperialData: {}
    };
  },
  watch: {
    data: {
      handler(data) {
        let changed = JSON.stringify(data) !== JSON.stringify(this.config);

        if (this.changed !== changed) {
          this.setChangedTab(changed ? "config" : null);
        }
      },
      deep: true,
    },
    config: {
      handler(config) {
        this.data = JSON.parse(JSON.stringify(config));
      },
      deep: true,
      immediate: true,
    },
    useImperialUnits(newValue) {
      if (!newValue) return;
      this.imperialData = convertMetricDataToImperial(structuredClone(this.data));
    }
  },
  computed: {
    ...mapState({
      config: (state) => state.config,
      status: (state) => state.static.status,
      changedTab: (state) => state.changedTab,
      useImperialUnits: (state) => state.useImperialUnits
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
    }
  },
  mounted() {
    this.init();
    window.renderer.on("BOARD:DUMP", () => (this.backupLoading = false));
    window.renderer.on("BOARD:RESTORE", () => {
      this.restoreLoading = false;
      setTimeout(this.init, 100);
    });
    window.renderer.on("DISCONNECTED", () => {
      if (this.timer) {
        clearInterval(this.timer);
      }
    });
    if (this.useImperialUnits) {
      this.imperialData = convertMetricDataToImperial(structuredClone(this.data));
    }
  },

  beforeDestroy() {
    clearInterval(this.timer);
  },
  methods: {
    ...mapActions(["setChangedTab"]),
    init() {
      getConfigs();
      this.getInfo();
    },
    getInfo() {
      window.renderer.send("BOARD:INFO");
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        window.renderer.send("BOARD:INFO");
      }, 250); // every 250 ms
    },
    onSave() {
      if (!this.$refs.form.validate()) return;

      if (this.useImperialUnits) {
        setConfigs(convertImperialDataToMetric(structuredClone(this.displayData)));
      } else {
        setConfigs(this.displayData);
      }

      getConfigs();
    },
    backupConfig() {
      this.backupLoading = true;
      window.renderer.send("BOARD:DUMP");
    },
    loadConfig() {
      const confirmed = window.confirm(
        "Configuration is about to be restored,\nwould you like to proceed?"
      );

      if (confirmed) {
        this.restoreLoading = true;
        window.renderer.send("BOARD:RESTORE");
      }
    },
    resetConfig() {
      const confirmed = window.confirm(
        "Configuration is about to be reseted,\nwould you like to proceed?"
      );

      if (confirmed) {
        window.renderer.send("BOARD:RESET_CONFIG");
        this.init();
      }
    },
    convertStatusLine4(statusLine) {
      const regex = /h:\s*(-?\d*\.?\d+)\s*m,\s*v:\s*(-?\d*\.?\d+)\s*m\/s,\s*a:\s*(-?\d*\.?\d+)\s*m\/s\^2/;
      const match = statusLine.match(regex);

      if (match) {
        const rawAltitude = parseFloat(match[1]);
        const rawVelocity = parseFloat(match[2]);
        const rawAcceleration = parseFloat(match[3]);

        const displayAltitude = getDisplayValue(rawAltitude, 'altitude', 'imperial');
        const displayVelocity = getDisplayValue(rawVelocity, 'velocity', 'imperial');
        const displayAcceleration = getDisplayValue(rawAcceleration, 'acceleration', 'imperial');

        return `h: ${displayAltitude}, v: ${displayVelocity}, a: ${displayAcceleration}`;
      } else {
        console.warn("Could not parse status line for conversion:", statusLine);
        return statusLine;
      }
    }
  },
};
</script>

<style></style>
