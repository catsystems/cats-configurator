<template>
  <div>
    <v-container fluid :class="{ 'pa-0': embedded }">
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
              <div class="mb-2">
                Free space:
                {{
                  freeSpacePercentage === null
                    ? "Unavailable"
                    : `${freeSpacePercentage}%`
                }}
              </div>
              <div class="mb-2">
                Estimated logging time:
                {{ convertTime(loggingTime) || "Unavailable" }}
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
                  <v-tooltip
                    location="top"
                    offset="2"
                    max-width="340"
                    open-delay="100"
                    content-class="logging-element-tooltip"
                    :text="element.description"
                  >
                    <template #activator="{ props: tooltipProps }">
                      <v-checkbox
                        v-bind="tooltipProps"
                        v-model="recElements"
                        :label="element.name"
                        :value="element"
                        hide-details
                      ></v-checkbox>
                    </template>
                  </v-tooltip>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
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
import { getLogInfo, getLogData, setLogData } from "@/services/logService";
import { LOG_ELEMENTS } from "@/modules/settings";
import ActionsBar from "@/components/ActionsBar.vue";

const UINT32_MASK = 0xffffffffn;
const KNOWN_LOG_MASK = LOG_ELEMENTS.reduce(
  (mask, { dec }) => mask | BigInt(dec),
  0n,
);

function parseStorageAmount(line) {
  const match = String(line ?? "").match(/:\s*([\d.]+)\s*(KB|bytes|B)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return /^KB$/i.test(match[2] ?? "") ? value * 1024 : value;
}

function parseFlashUsage(lines) {
  if (!Array.isArray(lines)) return null;
  const legacy = lines.find((line) => /Flash usage:/i.test(line));
  if (legacy) {
    const values = legacy.match(/[\d.]+/g)?.map(Number) ?? [];
    if (values.length >= 2) return { used: values[0], size: values[1] };
  }

  const size = parseStorageAmount(
    lines.find((line) => /^\s*Total:/i.test(line)),
  );
  const used = parseStorageAmount(
    lines.find((line) => /^\s*Used:/i.test(line)),
  );
  return size !== null && used !== null ? { used, size } : null;
}

export default {
  name: "LogsView",
  props: {
    embedded: Boolean,
  },
  emits: ["change"],
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
      if (this.embedded) {
        this.$emit("change", v);
        return;
      }
      if ((this.changedTab === "logs") !== v) {
        this.setChangedTab(v ? "logs" : null);
      }
    },
  },
  computed: {
    ...mapState(useAppStore, {
      logs: "logs",
      flash_info: (store) => store.static.rec_info,
      changedTab: "changedTab",
    }),
    updated() {
      return (
        this.isValueChaged(this.rec_speed, "rec_speed") ||
        this.isValueChaged(this.rec_elements, "rec_elements")
      );
    },
    flashUsage() {
      return parseFlashUsage(this.flash_info);
    },
    freeSpacePercentage() {
      if (!this.flashUsage || !this.flashUsage.size) return null;
      return (
        100 -
        (this.flashUsage.used / this.flashUsage.size) * 100
      ).toFixed(2);
    },
    loggingTime() {
      if (!this.elementsSize || !this.flashUsage || !this.flashUsage.size)
        return null;
      const recSpeed = Number(
        String(this.logs.rec_speed.value).match(/\d+/)?.[0] ?? 0,
      );
      if (!recSpeed) return null;
      const freeBytes = Math.max(
        0,
        this.flashUsage.size - this.flashUsage.used,
      );
      return freeBytes / (this.elementsSize * recSpeed);
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

<style>
.logging-element-tooltip {
  padding: 8px 12px !important;
  line-height: 1.35;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}
</style>
