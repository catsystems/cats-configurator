<template>
  <v-dialog
    :model-value="modelValue"
    :persistent="busy"
    aria-labelledby="usb-access-title"
    max-width="580"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title id="usb-access-title" class="px-6 pt-5 text-wrap">
        Enable CATS USB access
      </v-card-title>
      <v-card-text class="px-6">
        <v-alert
          v-if="setup.installed"
          variant="tonal"
          type="success"
          role="status"
        >
          The rule is installed. Unplug and reconnect your CATS devices to apply
          it.
        </v-alert>
        <template v-else>
          <p>
            Install a Linux device rule so Configurator can connect to Vega and
            access the Ground Station update interface.
          </p>
          <p class="mt-3">
            Your system will ask for administrator approval once for this
            computer.
          </p>
          <v-alert
            v-if="error"
            variant="tonal"
            type="error"
            class="mt-4"
            role="alert"
          >
            {{ error }}
          </v-alert>
          <div v-if="showTerminal || !setup.canAuthenticate" class="mt-4">
            <p class="mb-2">
              Run this command in Terminal, then reconnect the devices.
            </p>
            <v-textarea
              ref="command"
              :model-value="setup.terminalCommand"
              label="USB setup command"
              variant="outlined"
              rows="5"
              readonly
              hide-details
              class="terminal-command"
            />
            <div class="d-flex flex-wrap ga-2 mt-3">
              <v-btn variant="outlined" @click="copyCommand"
                >Copy command</v-btn
              >
              <v-btn variant="text" @click="checkSetup">Check setup</v-btn>
            </div>
            <p v-if="status" class="text-caption mt-2" role="status">
              {{ status }}
            </p>
          </div>
        </template>
      </v-card-text>
      <v-card-actions class="px-6 pb-5 flex-wrap">
        <v-btn
          v-if="!setup.installed && setup.canAuthenticate && !showTerminal"
          variant="text"
          :disabled="busy"
          @click="showTerminal = true"
          >Use a terminal</v-btn
        >
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="busy"
          @click="$emit('update:modelValue', false)"
        >
          {{ setup.installed ? "Done" : "Later" }}
        </v-btn>
        <v-btn
          v-if="!setup.installed && setup.canAuthenticate"
          color="primary"
          variant="elevated"
          :loading="busy"
          @click="enable"
          >Enable USB access</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: "UsbAccessDialog",
  props: {
    modelValue: Boolean,
    setup: { type: Object, required: true },
  },
  emits: ["update:modelValue", "installed"],
  data() {
    return { busy: false, error: "", status: "", showTerminal: false };
  },
  methods: {
    async enable() {
      this.busy = true;
      this.error = "";
      try {
        await window.cats.app.enableUsbAccess();
        this.$emit("installed");
      } catch (error) {
        this.error = error.message;
        if (error.code !== "usb_setup_cancelled") this.showTerminal = true;
      } finally {
        this.busy = false;
      }
    },
    async copyCommand() {
      try {
        await navigator.clipboard.writeText(this.setup.terminalCommand);
        this.status = "Command copied.";
      } catch {
        const textarea = this.$refs.command.$el.querySelector("textarea");
        textarea?.focus();
        textarea?.select();
        this.status = "Command selected. Copy it to Terminal.";
      }
    },
    async checkSetup() {
      try {
        const setup = await window.cats.app.usbAccessStatus();
        if (setup?.installed) this.$emit("installed");
        else
          this.status =
            "The device rule is still missing. Run the Terminal command, then check again.";
      } catch (error) {
        this.error = error.message;
      }
    },
  },
};
</script>

<style scoped>
.terminal-command :deep(textarea) {
  font-family: monospace;
  font-size: 0.8rem;
}
</style>
