<template>
  <v-container
    fluid
    class="d-flex flex-column"
    style="height: 100%; position: absolute"
  >
    <v-card
      id="cli_card"
      dark
      class="mb-2"
      max-height="100%"
      height="100%"
      style="overflow: auto"
      ref="cli_card"
    >
      <v-card-text>
        <div v-for="(response, idx) in responses" :key="idx">
          <div v-if="response.includes('^._.^')" class="mb-1">
            <span v-text="response" />
          </div>
          <div v-else class="white--text" style="white-space: pre-line">
            <v-divider v-if="response === '\n'" class="mt-1" />
            <span v-text="response" />
          </div>
        </div>
      </v-card-text>
    </v-card>
    <v-text-field
      v-model="cmd"
      placeholder="Write your command here"
      append-icon="mdi-keyboard-return"
      solo
      dense
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
    };
  },
  mounted() {
    window.renderer.on("CLI_COMMAND", (res) => {
      this.cmd = null;
      this.responses.push(res);
      this.$nextTick(function () {
        const cli = document.getElementById("cli_card");
        cli.scrollTop = cli.scrollHeight;
      });
    });
  },
  methods: {
    sendCommand() {
      if (this.responses.length) this.responses.push("\n");
      sendCliCommand(this.cmd);
    },
  },
};
</script>

<style></style>
