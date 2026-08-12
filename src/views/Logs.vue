<template>
  <div>
    <v-container fluid>
      <v-row>
        <v-col>
          <v-card height="100%">
            <v-card-title>Recording</v-card-title>
            <v-card-text>
              <v-form ref="form">
                <v-row density="compact">
                  <v-col cols="6">
                    <div class="py-2">Speed</div>
                  </v-col>
                  <v-col cols="6">
                    <v-select
                      v-model="rec_speed"
                      :items="logs.rec_speed.allowedValues"
                      variant="solo"
                      density="compact"
                      hide-details
                    ></v-select>
                  </v-col>
                </v-row>
              </v-form>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col>
          <v-card height="100%">
            <v-card-title>Info</v-card-title>
            <v-card-text>
              <div
                v-for="item in flash_info"
                :key="item"
                class="mb-2"
                v-text="item"
              />
              <div class="mb-2">Free space: {{ freeSpacePercentage }}%</div>
              <div class="mb-2">
                Logging time: {{ convertTime(loggingTime) }}
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      <v-row>
        <v-col>
          <v-card>
            <v-card-title>Elements</v-card-title>
            <v-card-text>
              <v-row density="compact">
                <v-col
                  cols="4"
                  v-for="element in logElements"
                  :key="element.name"
                >
                  <v-checkbox
                    v-model="recElements"
                    :label="element.name"
                    :value="element"
                    hide-details
                  ></v-checkbox>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
    <ActionsBar
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
import { getLogInfo, getLogData, setLogData } from "@/services/logService";
import { LOG_ELEMENTS } from "@/modules/settings";
import ActionsBar from "@/components/ActionsBar.vue";

const UINT32_MASK = 0xffffffffn;
const KNOWN_LOG_MASK = LOG_ELEMENTS.reduce(
  (mask, { dec }) => mask | BigInt(dec),
  0n,
);

export default {
  name: "LogsView",
  components: {
    ActionsBar,
  },
  data() {
    return {
      rec_speed: null,
      rec_elements: null,
      recElements: [],
      unknownRecElements: 0,
      elementsSize: 0,
      logElements: LOG_ELEMENTS,
      saveLoading: false,
    };
  },
  watch: {
    logs: {
      handler(logs) {
        this.rec_speed = logs.rec_speed.value;
        if (logs.rec_elements.value !== undefined) {
          this.setRecElements(logs.rec_elements.value);
        }
      },
      deep: true,
      immediate: true,
    },
    recElements: {
      handler(elements) {
        const decimals = elements.map((element) => element.dec);
        this.rec_elements =
          decimals.reduce((pv, cv) => pv + cv, 0) + this.unknownRecElements;
      },
      deep: true,
      immediate: true,
    },
    updated(v) {
      if ((this.changedTab === "logs") !== v) {
        this.setChangedTab(v ? "logs" : null);
      }
    },
  },
  computed: {
    ...mapState(useAppStore, {
      logs: "logs",
      flash_info: (store) => store.static.flash_info,
      changedTab: "changedTab",
    }),
    updated() {
      return (
        this.isValueChaged(this.rec_speed, "rec_speed") ||
        this.isValueChaged(this.rec_elements, "rec_elements")
      );
    },
    flashUsage() {
      if (!this.flash_info || !this.flash_info.length) return null;

      let flashUsageString = this.flash_info.find((item) =>
        item.includes("Flash usage:"),
      );
      const usedSize = flashUsageString.match(/\d+/)[0];
      flashUsageString = flashUsageString.replace(usedSize, "");
      const flahSize = flashUsageString.match(/\d+/)[0];

      return {
        used: Number(usedSize),
        size: Number(flahSize),
      };
    },
    freeSpacePercentage() {
      if (!this.flashUsage || !this.flashUsage.used || !this.flashUsage.size)
        return null;
      return (
        100 -
        (this.flashUsage.used / this.flashUsage.size) * 100
      ).toFixed(2);
    },
    loggingTime() {
      if (!this.elementsSize || !this.flashUsage || !this.flashUsage.size)
        return null;

      const recSpeed = Number(this.logs.rec_speed.value.match(/\d+/)[0]);
      return this.flashUsage.size / (this.elementsSize * recSpeed);
    },
  },
  mounted() {
    this.init();
  },
  methods: {
    ...mapActions(useAppStore, ["setChangedTab", "showErrorSnackbar"]),
    init() {
      getLogInfo();
      getLogData();
    },
    setRecElements(value) {
      const mask = BigInt(value);
      this.unknownRecElements = Number(mask & (UINT32_MASK ^ KNOWN_LOG_MASK));
      LOG_ELEMENTS.forEach((element) => {
        const isBitSet = (mask & BigInt(element.dec)) !== 0n;
        const index = this.recElements.findIndex((e) => e.bit === element.bit);

        if (isBitSet && index === -1) this.recElements.push(element);
        if (!isBitSet && index > -1) this.recElements.splice(index, 1);
      });

      this.rec_elements = Number(mask);
      const sizes = this.recElements.map((element) => element.size);
      this.elementsSize = sizes.reduce((pv, cv) => pv + cv, 0);
    },
    async onSave() {
      const data = {
        speed: this.rec_speed,
        elements: this.rec_elements,
      };

      this.saveLoading = true;
      try {
        await setLogData(data, this.logs);
        await getLogData();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.saveLoading = false;
      }
    },
    isValueChaged(value, key) {
      return value !== this.logs[key].value;
    },
    convertTime(seconds) {
      if (!seconds) return null;

      seconds = parseInt(seconds, 10);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds - hours * 3600) / 60);
      seconds = seconds - hours * 3600 - minutes * 60;

      if (hours) {
        if (minutes) {
          return `${hours}h ${minutes}m ${seconds}s`;
        } else {
          return `${hours}h ${seconds}s`;
        }
      }

      if (minutes) {
        return `${minutes}m ${seconds}s`;
      }

      return `${seconds}s`;
    },
  },
};
</script>

<style></style>
