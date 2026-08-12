<template>
  <v-container fluid class="cli-view d-flex flex-column">
    <v-card
      id="cli_card"
      theme="catsDark"
      color="grey-darken-4"
      class="cli-output mb-2"
      ref="cli_card"
    >
      <v-card-text>
        <div v-for="(response, idx) in responses" :key="idx">
          <div v-if="response.includes('^._.^')" class="mb-1">
            <span v-text="response" />
          </div>
          <div v-else class="text-white" style="white-space: pre-line">
            <v-divider v-if="response === '\n'" class="mt-1" />
            <span v-text="response" />
          </div>
        </div>
      </v-card-text>
    </v-card>
    <v-text-field
      v-model="cmd"
      class="cli-input"
      placeholder="Write your command here"
      append-icon="mdi-keyboard-return"
      variant="solo"
      density="compact"
      hide-details
      @update:model-value="onCommandInput"
      @keydown.enter.prevent="sendCommand"
      @keydown.up.prevent="previousCommand"
      @keydown.down.prevent="nextCommand"
      @keydown.ctrl.r.prevent="searchHistory"
    />
  </v-container>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import { sendCommand as sendCliCommand } from "@/services/cliService";

export default {
  name: "CliView",
  data() {
    return {
      cmd: "",
      responses: [],
      unsubscribe: null,
      historyIndex: null,
      historyDraft: "",
      historySearchQuery: null,
    };
  },
  computed: {
    ...mapState(useAppStore, ["cliHistory"]),
  },
  mounted() {
    this.unsubscribe = window.cats.serial.onData((res) => {
      this.responses.push(res);
      this.$nextTick(function () {
        const cli = document.getElementById("cli_card");
        cli.scrollTop = cli.scrollHeight;
      });
    });
  },
  beforeUnmount() {
    this.unsubscribe?.();
  },
  methods: {
    ...mapActions(useAppStore, ["addCliHistory", "showErrorSnackbar"]),
    async sendCommand() {
      const command = this.cmd.trim();
      if (!command) return;
      if (this.responses.length) this.responses.push("\n");
      this.addCliHistory(command);
      this.cmd = "";
      this.resetHistoryNavigation();
      try {
        await sendCliCommand(command);
      } catch (error) {
        this.showErrorSnackbar(error.message);
      }
    },
    onCommandInput(value) {
      this.historyIndex = null;
      this.historyDraft = value || "";
      this.historySearchQuery = null;
    },
    resetHistoryNavigation() {
      this.historyIndex = null;
      this.historyDraft = this.cmd;
      this.historySearchQuery = null;
    },
    previousCommand() {
      if (!this.cliHistory.length) return;
      if (this.historyIndex === null) {
        this.historyDraft = this.cmd;
        this.historyIndex = this.cliHistory.length;
      }
      if (this.historyIndex > 0) this.historyIndex -= 1;
      this.cmd = this.cliHistory[this.historyIndex];
      this.historySearchQuery = null;
    },
    nextCommand() {
      if (this.historyIndex === null) return;
      if (this.historyIndex < this.cliHistory.length - 1) {
        this.historyIndex += 1;
        this.cmd = this.cliHistory[this.historyIndex];
      } else {
        this.cmd = this.historyDraft;
        this.historyIndex = null;
      }
      this.historySearchQuery = null;
    },
    searchHistory() {
      if (!this.cliHistory.length) return;
      if (this.historySearchQuery === null) {
        this.historyDraft = this.cmd;
        this.historySearchQuery = this.cmd.toLowerCase();
        this.historyIndex = this.cliHistory.length;
      }

      for (let index = this.historyIndex - 1; index >= 0; index -= 1) {
        if (
          this.cliHistory[index].toLowerCase().includes(this.historySearchQuery)
        ) {
          this.historyIndex = index;
          this.cmd = this.cliHistory[index];
          return;
        }
      }
    },
  },
};
</script>

<style scoped>
.cli-view {
  height: calc(100vh - 96px);
}

.cli-output {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.cli-input {
  flex: 0 0 auto;
}
</style>
