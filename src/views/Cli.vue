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
      @keydown.enter="sendCommand"
    />
  </v-container>
</template>

<script>
import { sendCommand as sendCliCommand } from "@/services/cliService";

export default {
  name: "CliView",
  data() {
    return {
      cmd: null,
      responses: [],
      unsubscribe: null,
    };
  },
  mounted() {
    this.unsubscribe = window.cats.serial.onData((res) => {
      this.cmd = null;
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
    sendCommand() {
      if (!this.cmd?.trim()) return;
      if (this.responses.length) this.responses.push("\n");
      sendCliCommand(this.cmd);
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
