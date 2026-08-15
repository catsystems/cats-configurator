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
          open another profile for a field-by-field comparison.
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
              Showing {{ currentRows.length }} board value{{
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
                    {{ formatValue(row.key, row.boardValue) }}
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
                {{ compatibility.changedCount }} profile value{{
                  compatibility.changedCount === 1 ? "" : "s"
                }}
                {{ compatibility.changedCount === 1 ? "differs" : "differ" }}
                from the board.
              </div>
              <v-spacer />
              <v-btn
                color="primary"
                :disabled="
                  !compatibility.canApply || compatibility.changedCount === 0
                "
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
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.key">
                  <td>{{ row.section }}</td>
                  <td>
                    <div>{{ row.label }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ row.key }}
                    </div>
                  </td>
                  <td class="profile-value">
                    {{ formatValue(row.key, row.boardValue) }}
                  </td>
                  <td class="profile-value">
                    {{ formatValue(row.key, row.profileValue) }}
                  </td>
                  <td>
                    <v-chip :color="statusColor(row.status)" size="small">
                      {{ statusLabel(row.status) }}
                    </v-chip>
                  </td>
                  <td>
                    <v-chip
                      v-if="applyResults[row.key]"
                      :color="resultColor(applyResults[row.key].status)"
                      size="small"
                      variant="tonal"
                    >
                      {{ statusLabel(applyResults[row.key].status) }}
                    </v-chip>
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
    };
  },
  computed: {
    ...mapState(useAppStore, ["currentBoardProfile"]),
    currentProfile() {
      return this.currentBoardProfile?.profile ?? null;
    },
    currentRows() {
      return this.currentBoardProfile?.rows ?? [];
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
    formatDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
    },
    formatValue(key, value) {
      return formatProfileValue(key, value);
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
