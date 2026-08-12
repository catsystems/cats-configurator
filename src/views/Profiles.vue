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
        <v-alert v-if="!profile" type="info" variant="tonal">
          Export the connected board as a versioned JSON profile, or open a
          profile to compare every setting before applying it.
        </v-alert>

        <template v-else>
          <div class="profile-summary mb-4">
            <div>
              <strong>Board:</strong>
              {{ profile.source.boardModel || "Unknown" }}
            </div>
            <div>
              <strong>Firmware:</strong>
              {{ profile.source.firmwareVersion || "Unknown" }}
            </div>
            <div><strong>Schema:</strong> {{ profile.schemaVersion }}</div>
            <div>
              <strong>Created:</strong> {{ formatDate(profile.createdAt) }}
            </div>
          </div>

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
              {{ compatibility.changedCount }} field{{
                compatibility.changedCount === 1 ? "" : "s"
              }}
              will change.
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
              Apply Changed Fields
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
                <td class="profile-value">{{ formatValue(row.boardValue) }}</td>
                <td class="profile-value">
                  {{ formatValue(row.profileValue) }}
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
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
import { mapActions } from "pinia";
import { useAppStore } from "@/store";

export default {
  name: "ProfilesView",
  data() {
    return {
      profile: null,
      rows: [],
      compatibility: {
        warnings: [],
        canApply: false,
        changedCount: 0,
      },
      applyResults: {},
      exportLoading: false,
      openLoading: false,
      applyLoading: false,
    };
  },
  methods: {
    ...mapActions(useAppStore, ["showSuccessSnackbar", "showErrorSnackbar"]),
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
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.openLoading = false;
      }
    },
    async applyProfile() {
      this.applyLoading = true;
      try {
        const result = await window.cats.profiles.apply(this.profile);
        this.rows = result.rows;
        this.compatibility = result.compatibility;
        this.applyResults = Object.fromEntries(
          result.results.map((field) => [field.key, field]),
        );
        if (result.ok) {
          this.showSuccessSnackbar("Profile applied and verified.");
        } else {
          this.showErrorSnackbar("Profile was not fully applied.");
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
    formatValue(value) {
      if (value === null || value === undefined) return "—";
      return String(value);
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
