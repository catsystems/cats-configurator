<template>
  <v-container fluid class="preflight-view pa-6">
    <v-card class="mb-4">
      <v-card-title class="d-flex align-center flex-wrap ga-3">
        <span>Flight Preflight</span>
        <v-spacer />
        <v-btn color="primary" :loading="loading" @click="runPreflight">
          Run Preflight
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-alert type="info" variant="tonal">
          This is a read-only check. It simulates the configured event and timer
          sequence without enabling test mode or activating any output.
        </v-alert>
      </v-card-text>
    </v-card>

    <template v-if="report">
      <v-alert
        :type="reportAlertType"
        variant="elevated"
        class="preflight-result mb-4"
      >
        <div class="text-h5 font-weight-bold">{{ report.status }}</div>
        <div>{{ reportMessage }}</div>
        <div class="text-caption mt-1">
          {{ report.board.model || "Connected board" }}
          {{ report.board.firmwareVersion || "" }} ·
          {{ formatDate(report.generatedAt) }}
        </div>
      </v-alert>

      <v-row class="mb-2">
        <v-col cols="12" md="4">
          <v-card color="error" variant="tonal">
            <v-card-text>
              <div class="text-h4">{{ report.summary.blockedCount }}</div>
              <div>Blocked checks</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card color="warning" variant="tonal">
            <v-card-text>
              <div class="text-h4">{{ report.summary.warningCount }}</div>
              <div>Warnings</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card color="success" variant="tonal">
            <v-card-text>
              <div class="text-h4">{{ report.summary.readyCount }}</div>
              <div>Ready checks</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" lg="7">
          <v-card height="100%">
            <v-card-title>Safety Report</v-card-title>
            <v-card-text>
              <v-list lines="three">
                <v-list-item
                  v-for="item in report.checks"
                  :key="item.id"
                  class="preflight-check mb-2"
                  :class="'preflight-check--' + item.status"
                >
                  <template #prepend>
                    <v-icon :color="checkColor(item.status)">
                      {{ checkIcon(item.status) }}
                    </v-icon>
                  </template>
                  <v-list-item-title class="font-weight-medium">
                    {{ item.title }}
                  </v-list-item-title>
                  <v-list-item-subtitle>
                    {{ item.category }} · {{ item.detail }}
                  </v-list-item-subtitle>
                  <template #append>
                    <div class="d-flex align-center ga-2">
                      <v-chip :color="checkColor(item.status)" size="small">
                        {{ item.status }}
                      </v-chip>
                      <v-btn
                        v-if="item.status !== 'ready' && item.review"
                        :to="item.review.route"
                        size="small"
                        variant="text"
                      >
                        {{ item.review.label }}
                      </v-btn>
                    </div>
                  </template>
                </v-list-item>
              </v-list>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" lg="5">
          <v-card height="100%">
            <v-card-title>Event &amp; Timer Simulator</v-card-title>
            <v-card-subtitle>
              Relative flight sequence and configured actions
            </v-card-subtitle>
            <v-card-text class="pt-4">
              <div class="flight-timeline">
                <div
                  v-for="item in report.timeline"
                  :key="item.id"
                  class="flight-timeline__entry"
                >
                  <div
                    class="flight-timeline__marker"
                    :class="'flight-timeline__marker--' + item.kind"
                  ></div>
                  <div class="flight-timeline__content">
                    <div class="d-flex align-center ga-2">
                      <strong>{{ item.title }}</strong>
                      <v-chip
                        :color="item.kind === 'timer' ? 'info' : 'primary'"
                        size="x-small"
                        variant="tonal"
                      >
                        {{ item.kind }}
                      </v-chip>
                    </div>
                    <div class="text-caption text-medium-emphasis mb-2">
                      {{ item.detail }}
                    </div>
                    <div
                      v-if="item.actions.length"
                      class="d-flex flex-wrap ga-1"
                    >
                      <v-chip
                        v-for="action in item.actions"
                        :key="action"
                        size="small"
                        variant="outlined"
                      >
                        {{ action }}
                      </v-chip>
                    </div>
                    <span v-else class="text-caption text-medium-emphasis">
                      No configured actions
                    </span>
                  </div>
                </div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </v-container>
</template>

<script>
import { mapActions } from "pinia";
import { useAppStore } from "@/store";

export default {
  name: "PreflightView",
  data() {
    return {
      loading: false,
      report: null,
    };
  },
  computed: {
    reportAlertType() {
      return {
        READY: "success",
        WARNING: "warning",
        BLOCKED: "error",
      }[this.report?.status];
    },
    reportMessage() {
      return {
        READY: "All required safety checks passed.",
        WARNING: "No blocking issue was found, but review the warnings.",
        BLOCKED: "Resolve every blocked check before flight.",
      }[this.report?.status];
    },
  },
  mounted() {
    this.runPreflight();
  },
  methods: {
    ...mapActions(useAppStore, ["showErrorSnackbar"]),
    async runPreflight() {
      this.loading = true;
      try {
        this.report = await window.cats.preflight.run();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.loading = false;
      }
    },
    checkColor(status) {
      return {
        ready: "success",
        warning: "warning",
        blocked: "error",
      }[status];
    },
    checkIcon(status) {
      return {
        ready: "mdi-check-circle",
        warning: "mdi-alert",
        blocked: "mdi-close-circle",
      }[status];
    },
    formatDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
    },
  },
};
</script>

<style scoped>
.preflight-view {
  max-width: 1600px;
}

.preflight-result {
  border-left: 6px solid currentColor;
}

.preflight-check {
  border-left: 4px solid transparent;
  border-radius: 6px;
}

.preflight-check--ready {
  border-left-color: rgb(var(--v-theme-success));
}

.preflight-check--warning {
  border-left-color: rgb(var(--v-theme-warning));
}

.preflight-check--blocked {
  border-left-color: rgb(var(--v-theme-error));
}

.flight-timeline {
  position: relative;
  padding-left: 28px;
}

.flight-timeline::before {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 8px;
  width: 2px;
  content: "";
  background: rgba(var(--v-theme-on-surface), 0.2);
}

.flight-timeline__entry {
  position: relative;
  padding-bottom: 22px;
}

.flight-timeline__marker {
  position: absolute;
  top: 5px;
  left: -27px;
  z-index: 1;
  width: 16px;
  height: 16px;
  border: 3px solid rgb(var(--v-theme-surface));
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}

.flight-timeline__marker--timer {
  background: rgb(var(--v-theme-info));
}

.flight-timeline__content {
  min-width: 0;
}
</style>
