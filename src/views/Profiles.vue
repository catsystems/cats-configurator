<template>
  <v-container fluid class="profiles-view pa-6">
    <v-card>
      <v-card-title class="d-flex align-center flex-wrap ga-3">
        <span>Configuration Profiles</span>
        <v-spacer />
        <v-btn
          color="primary"
          variant="outlined"
          :loading="exportLoading"
          @click="exportProfile"
        >
          Export Board Profile
        </v-btn>
        <v-btn color="primary" :loading="openLoading" @click="openProfile">
          Open Profile
        </v-btn>
      </v-card-title>

      <v-card-text>
        <v-alert type="info" variant="tonal" class="mb-4">
          Review the connected board profile at any time, export it as JSON, or
          open another profile for a setting-by-setting comparison.
        </v-alert>

        <v-progress-linear
          v-if="currentLoading"
          indeterminate
          color="primary"
          class="mb-4"
        />

        <div class="d-flex align-center flex-wrap ga-2 mb-4">
          <v-btn-toggle v-model="viewMode" mandatory color="primary">
            <v-btn value="board">Connected Board</v-btn>
            <v-btn value="comparison" :disabled="!profile">
              Profile Comparison
            </v-btn>
          </v-btn-toggle>
          <v-spacer />
          <v-btn
            v-if="viewMode === 'board'"
            variant="text"
            prepend-icon="mdi-refresh"
            :loading="currentLoading"
            @click="loadCurrentProfile"
          >
            Refresh Board
          </v-btn>
        </div>

        <template v-if="displayProfile">
          <div class="profile-summary mb-4">
            <div>
              <strong>Board:</strong>
              {{ displayProfile.source.boardModel || "Unknown" }}
            </div>
            <div>
              <strong>Firmware:</strong>
              {{ displayProfile.source.firmwareVersion || "Unknown" }}
            </div>
            <div>
              <strong>Schema:</strong> {{ displayProfile.schemaVersion }}
            </div>
            <div>
              <strong>Captured:</strong>
              {{ formatDate(displayProfile.createdAt) }}
            </div>
          </div>

          <template v-if="viewMode === 'board'">
            <v-alert type="success" variant="tonal" class="mb-3">
              Showing {{ currentRows.length }} board setting{{
                currentRows.length === 1 ? "" : "s"
              }}
              read from the connected board.
            </v-alert>

            <v-table fixed-header height="560" class="profile-diff-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Setting</th>
                  <th>Current board value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in currentRows" :key="row.key">
                  <td>{{ row.section }}</td>
                  <td>
                    <div>{{ row.label }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ row.key }}
                    </div>
                  </td>
                  <td class="profile-value">
                    {{ formatRowValue(row, "boardValue") }}
                  </td>
                </tr>
              </tbody>
            </v-table>
          </template>

          <template v-else>
            <v-alert
              v-if="compatibility.warnings.length === 0"
              type="success"
              variant="tonal"
              class="mb-3"
            >
              Profile is compatible with the connected board.
            </v-alert>
            <v-alert
              v-for="warning in compatibility.warnings"
              :key="warning.message"
              :type="warning.severity === 'error' ? 'error' : 'warning'"
              variant="tonal"
              class="mb-3"
            >
              {{ warning.message }}
            </v-alert>

            <div class="d-flex align-center mb-3">
              <div class="text-body-2">
                {{ changedEntryCount }} profile
                {{
                  changedEntryCount === 1 ? "entry differs" : "entries differ"
                }}
                from the board.
              </div>
              <v-spacer />
              <v-btn
                color="primary"
                :disabled="!compatibility.canApply || changedEntryCount === 0"
                :loading="applyLoading"
                @click="applyProfile"
              >
                Apply Profile to Board
              </v-btn>
            </div>

            <v-table fixed-header height="560" class="profile-diff-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Setting</th>
                  <th>Board</th>
                  <th>Profile</th>
                  <th>Difference</th>
                  <th>Apply result</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in comparisonRows" :key="row.key">
                  <td>{{ row.section }}</td>
                  <td>
                    <div>{{ row.label }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ row.key }}
                    </div>
                  </td>
                  <td class="profile-value">
                    {{ formatRowValue(row, "boardValue") }}
                  </td>
                  <td class="profile-value">
                    {{ formatRowValue(row, "profileValue") }}
                  </td>
                  <td>
                    <v-chip :color="statusColor(row.status)" size="small">
                      {{ statusLabel(row.status) }}
                    </v-chip>
                  </td>
                  <td>
                    <v-chip
                      v-if="applyResultForRow(row)"
                      :color="resultColor(applyResultForRow(row))"
                      size="small"
                      variant="tonal"
                    >
                      {{ statusLabel(applyResultForRow(row)) }}
                    </v-chip>
                    <span v-else class="text-medium-emphasis">—</span>
                  </td>
                  <td>
                    <v-btn
                      v-if="row.status === 'changed'"
                      color="primary"
                      size="small"
                      variant="tonal"
                      :disabled="!compatibility.canApply"
                      :loading="applyRowLoading === row.key"
                      @click="applyProfileRow(row)"
                    >
                      Apply to Board
                    </v-btn>
                    <span v-else class="text-medium-emphasis">—</span>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </template>
        </template>

        <v-alert v-else-if="currentError" type="error" variant="tonal">
          {{ currentError }}
        </v-alert>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import { formatProfileValue } from "@/shared/configuration-profile.js";

const TIMER_FIELD_ORDER = ["start", "duration", "trigger"];
const STATUS_PRIORITY = ["unsupported", "missing", "changed", "same"];

function groupProfileRows(rows) {
  const grouped = [];
  const timers = new Map();
  for (const row of rows) {
    const timer = row.key.match(/^timer(\d+)_(start|duration|trigger)$/);
    if (!timer) {
      grouped.push({ ...row, fields: [row] });
      continue;
    }
    const key = `timer${timer[1]}`;
    if (!timers.has(key)) {
      const group = {
        key,
        section: "Timers",
        label: `Timer ${timer[1]}`,
        timer: true,
        fields: [],
      };
      timers.set(key, group);
      grouped.push(group);
    }
    timers.get(key).fields.push(row);
  }

  return grouped.map((row) => {
    if (!row.timer) return row;
    row.fields.sort(
      (left, right) =>
        TIMER_FIELD_ORDER.indexOf(left.key.split("_").at(-1)) -
        TIMER_FIELD_ORDER.indexOf(right.key.split("_").at(-1)),
    );
    row.status = STATUS_PRIORITY.find((status) =>
      row.fields.some((field) => field.status === status),
    );
    return row;
  });
}

export default {
  name: "ProfilesView",
  data() {
    return {
      currentError: null,
      profile: null,
      rows: [],
      compatibility: {
        warnings: [],
        canApply: false,
        changedCount: 0,
      },
      applyResults: {},
      viewMode: "board",
      currentLoading: false,
      exportLoading: false,
      openLoading: false,
      applyLoading: false,
      applyRowLoading: null,
    };
  },
  computed: {
    ...mapState(useAppStore, ["currentBoardProfile"]),
    currentProfile() {
      return this.currentBoardProfile?.profile ?? null;
    },
    currentRows() {
      return groupProfileRows(this.currentBoardProfile?.rows ?? []);
    },
    comparisonRows() {
      return groupProfileRows(this.rows);
    },
    changedEntryCount() {
      return this.comparisonRows.filter(({ status }) => status === "changed")
        .length;
    },
    displayProfile() {
      return this.viewMode === "board" ? this.currentProfile : this.profile;
    },
  },
  mounted() {
    if (!this.currentBoardProfile) this.loadCurrentProfile();
  },
  methods: {
    ...mapActions(useAppStore, [
      "setCurrentBoardProfile",
      "showSuccessSnackbar",
      "showErrorSnackbar",
    ]),
    async loadCurrentProfile() {
      this.currentLoading = true;
      this.currentError = null;
      try {
        const result = await window.cats.profiles.current();
        this.setCurrentBoardProfile(result);
      } catch (error) {
        this.currentError = error.message;
        this.showErrorSnackbar(error.message);
      } finally {
        this.currentLoading = false;
      }
    },
    async exportProfile() {
      this.exportLoading = true;
      try {
        const result = await window.cats.profiles.export();
        if (!result.canceled) {
          this.showSuccessSnackbar("Configuration profile exported.");
        }
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.exportLoading = false;
      }
    },
    async openProfile() {
      this.openLoading = true;
      try {
        const result = await window.cats.profiles.open();
        if (result.canceled) return;
        this.profile = result.profile;
        this.rows = result.rows;
        this.compatibility = result.compatibility;
        this.applyResults = {};
        this.viewMode = "comparison";
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.openLoading = false;
      }
    },
    async applyProfile() {
      this.applyLoading = true;
      try {
        const profile = JSON.parse(JSON.stringify(this.profile));
        const result = await window.cats.profiles.apply(profile);
        this.rows = result.rows;
        this.compatibility = result.compatibility;
        this.applyResults = Object.fromEntries(
          result.results.map((field) => [field.key, field]),
        );
        if (result.ok) {
          await this.loadCurrentProfile();
          this.showSuccessSnackbar("Profile applied and verified.");
        } else {
          const failed = result.results.find(({ status }) =>
            ["failed", "mismatch"].includes(status),
          );
          const row = this.rows.find(({ key }) => key === failed?.key);
          const detail = failed
            ? `${row?.label || failed.key}: ${failed.message || failed.status}`
            : "The board did not verify every value.";
          this.showErrorSnackbar(`Profile was not fully applied. ${detail}`);
        }
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.applyLoading = false;
      }
    },
    async applyProfileRow(row) {
      const entries = row.fields
        .filter(({ status }) => ["same", "changed"].includes(status))
        .map(({ key, profileValue }) => ({ key, value: profileValue }));
      if (!entries.length) return;

      this.applyRowLoading = row.key;
      try {
        const result = await window.cats.board.applyConfig(entries);
        this.applyResults = {
          ...this.applyResults,
          ...Object.fromEntries(
            result.results.map((field) => [field.key, field]),
          ),
        };
        if (result.ok) {
          for (const field of result.results) {
            const applied = this.rows.find(({ key }) => key === field.key);
            if (!applied || field.status !== "verified") continue;
            applied.boardValue = field.actual;
            applied.status = "same";
          }
          this.compatibility = {
            ...this.compatibility,
            changedCount: this.rows.filter(({ status }) => status === "changed")
              .length,
          };
          await this.loadCurrentProfile();
          this.showSuccessSnackbar(`${row.label} applied and verified.`);
        } else {
          const failed = result.results.find(({ status }) =>
            ["failed", "mismatch"].includes(status),
          );
          this.showErrorSnackbar(
            `${row.label} was not fully applied. ${failed?.message || failed?.status || "The board did not verify every value."}`,
          );
        }
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.applyRowLoading = null;
      }
    },
    formatDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
    },
    formatValue(key, value) {
      return formatProfileValue(key, value);
    },
    formatRowValue(row, source) {
      if (!row.timer) return this.formatValue(row.key, row[source]);
      const value = (field) =>
        row.fields.find(({ key }) => key.endsWith(`_${field}`))?.[source] ??
        "—";
      const start = value("start");
      const duration = value("duration");
      const trigger = value("trigger");
      return Number(duration) === 0
        ? "Disabled"
        : `${start} → ${trigger} · ${duration} ms`;
    },
    applyResultForRow(row) {
      const results = row.fields
        .map(({ key }) => this.applyResults[key])
        .filter(Boolean);
      if (!results.length) return null;
      if (
        results.some(({ status }) => ["failed", "mismatch"].includes(status))
      ) {
        return "failed";
      }
      if (
        results.every(({ status }) =>
          ["verified", "unchanged"].includes(status),
        )
      ) {
        return "verified";
      }
      return "pending";
    },
    statusLabel(status) {
      return String(status).replaceAll("_", " ");
    },
    statusColor(status) {
      return {
        same: "success",
        changed: "warning",
        missing: "grey",
        unsupported: "error",
      }[status];
    },
    resultColor(status) {
      return ["verified", "unchanged"].includes(status)
        ? "success"
        : ["pending", "written"].includes(status)
          ? "warning"
          : "error";
    },
  },
};
</script>

<style scoped>
.profiles-view {
  max-width: 1500px;
}

.profile-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.profile-value {
  max-width: 260px;
  overflow-wrap: anywhere;
}
</style>
