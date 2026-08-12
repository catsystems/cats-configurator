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
      ref="commandInput"
      v-model="cmd"
      class="cli-input"
      placeholder="Write your command here (Up: previous, Ctrl+R: history)"
      append-icon="mdi-keyboard-return"
      variant="solo"
      density="compact"
      hide-details
      @update:model-value="onCommandInput"
      @keydown.enter.prevent="sendCommand"
      @keydown.up.prevent="previousCommand"
      @keydown.down.prevent="nextCommand"
      @keydown.ctrl.r.prevent="openHistory"
    />

    <div
      v-if="historyOpen"
      ref="historyDialog"
      class="history-dialog"
      tabindex="0"
      @keydown.up.prevent="moveHistorySelection(-1)"
      @keydown.down.prevent="moveHistorySelection(1)"
      @keydown.enter.prevent="selectHistoryCommand()"
      @keydown.esc.prevent="closeHistory"
    >
      <v-card elevation="12">
        <v-card-title>Command history</v-card-title>
        <v-card-subtitle>
          Use Up and Down, then Enter to select a command.
        </v-card-subtitle>
        <v-list v-if="historyItems.length" class="history-list mt-2">
          <v-list-item
            v-for="(command, index) in historyItems"
            :key="`${index}-${command}`"
            :active="historySelection === index"
            :data-history-index="index"
            color="primary"
            @click="selectHistoryCommand(index)"
          >
            <v-list-item-title class="font-weight-regular">
              {{ command }}
            </v-list-item-title>
          </v-list-item>
        </v-list>
        <v-card-text v-else>
          No commands in this connected session yet.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeHistory">Close</v-btn>
        </v-card-actions>
      </v-card>
    </div>
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
      historyOpen: false,
      historySelection: 0,
    };
  },
  computed: {
    ...mapState(useAppStore, ["cliHistory"]),
    historyItems() {
      return [...this.cliHistory].reverse();
    },
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
    },
    resetHistoryNavigation() {
      this.historyIndex = null;
      this.historyDraft = this.cmd;
    },
    previousCommand() {
      if (!this.cliHistory.length) return;
      if (this.historyIndex === null) {
        this.historyDraft = this.cmd;
        this.historyIndex = this.cliHistory.length;
      }
      if (this.historyIndex > 0) this.historyIndex -= 1;
      this.cmd = this.cliHistory[this.historyIndex];
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
    },
    openHistory() {
      this.historySelection = 0;
      this.historyOpen = true;
      this.$nextTick(() => this.$refs.historyDialog?.focus());
    },
    closeHistory() {
      this.historyOpen = false;
      this.$nextTick(() => this.$refs.commandInput?.focus());
    },
    moveHistorySelection(offset) {
      if (!this.historyItems.length) return;
      this.historySelection = Math.max(
        0,
        Math.min(this.historySelection + offset, this.historyItems.length - 1),
      );
      this.$nextTick(() => {
        const selected = this.$refs.historyDialog?.querySelector(
          `[data-history-index="${this.historySelection}"]`,
        );
        if (typeof selected?.scrollIntoView === "function") {
          selected.scrollIntoView({ block: "nearest" });
        }
      });
    },
    selectHistoryCommand(index = this.historySelection) {
      const command = this.historyItems[index];
      if (!command) return;
      this.cmd = command;
      this.resetHistoryNavigation();
      this.closeHistory();
    },
  },
};
</script>

<style scoped>
.cli-view {
  height: calc(100vh - 96px);
  position: relative;
}

.cli-output {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.cli-input {
  flex: 0 0 auto;
}

.history-dialog:focus {
  outline: none;
}

.history-dialog {
  position: absolute;
  right: 16px;
  bottom: 64px;
  left: 16px;
  z-index: 10;
}

.history-list {
  max-height: 360px;
  overflow-y: auto;
}
</style>
