<template>
  <div>
    <v-container fluid>
      <v-row>
        <v-col>
          <v-card v-if="data" height="100%">
            <v-card-title>General</v-card-title>
            <v-card-text>
              <v-form ref="form">
                <v-row v-for="key in Object.keys(data)" :key="key" dense>
                  <v-col cols="6">
                    <div
                      class="text-capitalize py-2"
                      v-text="data[key].name"
                    />
                  </v-col>
                  <v-col cols="6">
                    <v-select
                      v-if="data[key].type === 'SELECT'"
                      v-model="data[key].value"
                      :items="data[key].allowedValues"
                      solo
                      dense
                      hide-details
                    ></v-select>
                    <v-text-field
                      v-if="data[key].type === 'NUMBER'"
                      v-model.number="data[key].value"
                      :min="data[key].allowedRange[0]"
                      :max="data[key].allowedRange[1]"
                      :rules="[
                        (v) =>
                          (v >= data[key].allowedRange[0] &&
                            v <= data[key].allowedRange[1]) ||
                          `Value should be from ${data[key].allowedRange.join(
                            ' to '
                          )}`,
                      ]"
                      :hint="data[key].allowedRange.join(' to ')"
                      type="number"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ data[key].unit }}
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
              <div
                v-for="item in status"
                :key="item"
                class="mb-2"
                v-text="item"
              />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-card v-if="status && status.length" height="100%">
            <v-card-title>Telemetry Settings</v-card-title>
            <v-card-text>
              <v-form ref="form">
                <v-row v-for="key in Object.keys(data)" :key="key" dense>
                  <v-col cols="6">
                    <div
                      class="text-capitalize py-2"
                      v-text="data[key].name"
                    />
                  </v-col>
                  <v-col cols="6">
                    <v-select
                      v-if="data[key].type === 'SELECT'"
                      v-model="data[key].value"
                      :items="data[key].allowedValues"
                      solo
                      dense
                      hide-details
                    ></v-select>
                    <v-text-field
                      v-if="data[key].type === 'NUMBER'"
                      v-model.number="data[key].value"
                      :min="data[key].allowedRange[0]"
                      :max="data[key].allowedRange[1]"
                      :rules="[
                        (v) =>
                          (v >= data[key].allowedRange[0] &&
                            v <= data[key].allowedRange[1]) ||
                          `Value should be from ${data[key].allowedRange.join(
                            ' to '
                          )}`,
                      ]"
                      :hint="data[key].allowedRange.join(' to ')"
                      type="number"
                      hide-details="auto"
                      solo
                      dense
                    >
                      <template v-slot:append>
                        {{ data[key].unit }}
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
            <v-card-title>Info</v-card-title>
            <v-card-text>
              <p>Test</p>
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
import { getConfigs, getTelemetry, setConfigs } from "@/services/configService";
import ActionsBar from "@/components/ActionsBar";

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
  },
  computed: {
    ...mapState({
      config: (state) => state.config,
      status: (state) => state.static.status,
      changedTab: (state) => state.changedTab,
    }),
    changed() {
      return this.changedTab === "config";
    },
  },
  mounted() {
    this.init();
    window.renderer.on("BOARD:DUMP", () => (this.backupLoading = false));
    window.renderer.on("BOARD:RESTORE", () => {
      this.restoreLoading = false;
      this.init();
    });
  },
  beforeDestroy() {
    clearInterval(this.timer);
  },
  methods: {
    ...mapActions(["setChangedTab"]),
    init() {
      getConfigs();
      getTelemetry();
      this.getInfo();
    },
    getInfo() {
      window.renderer.send("BOARD:INFO");
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        window.renderer.send("BOARD:INFO");
      }, 25000); // every 250 ms
    },
    onSave() {
      if (!this.$refs.form.validate()) return;

      setConfigs(this.data);
      getConfigs();
      getTelemetry();
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
  },
};
</script>

<style></style>
