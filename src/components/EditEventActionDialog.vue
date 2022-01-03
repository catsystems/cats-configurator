<template>
  <v-card>
    <v-card-title>
      <span>Edit Action</span>
    </v-card-title>
    <v-card-text>
      <v-form>
        <v-row>
          <v-col cols="12">
            <v-select
              :value="selectedAction"
              :items="eventConfigs"
              item-text="name"
              label="Action"
              solo
              dense
              hide-details
              return-object
              autofocus
              @change="onChange"
            ></v-select>
          </v-col>
          <v-col cols="12">
            <template v-if="selectedAction">
              <v-text-field
                v-if="selectedAction.type === 'NUMBER'"
                v-model.number="action.value"
                :min="selectedAction.args[0]"
                :max="selectedAction.args[1]"
                :hint="selectedAction.args.join(' to ')"
                :rules="[
                  (v) =>
                    (v >= selectedAction.args[0] &&
                      v <= selectedAction.args[1]) ||
                    `Value should be from ${selectedAction.args.join(' to ')}`,
                ]"
                type="number"
                hide-details="auto"
                color="primary"
                solo
                dense
                @keydown.enter="save"
              >
                <template v-slot:append>
                  {{ selectedAction.unit }}
                </template>
              </v-text-field>
              <v-select
                v-else-if="selectedAction.type === 'SELECT'"
                v-model.number="action.value"
                :items="selectedAction.args"
                label="State"
                solo
                dense
                hide-details
                @keydown.enter="save"
              ></v-select>
            </template>
          </v-col>
          <v-col cols="12">
            <v-btn
              color="primary"
              :disabled="[null, ''].includes(action.value)"
              block
              @click="save"
              >done</v-btn
            >
          </v-col>
        </v-row>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script>
import { EVENT_SETTINGS } from "@/modules/settings";

export default {
  name: "EditEventActionDialog",
  props: {
    event: Object,
    value: Object,
    saveFunction: Function,
    closeFunction: Function,
  },
  data() {
    return {
      action: {
        index: null,
        value: null,
      },
    };
  },
  watch: {
    "event.filled"(filled) {
      if (filled) this.closeFunction();
    },
  },
  computed: {
    eventConfigs() {
      return EVENT_SETTINGS.filter((item) => item.name);
    },
    selectedAction() {
      if (!this.action.index) return null;
      return EVENT_SETTINGS[this.action.index];
    },
  },
  mounted() {
    if (!this.value) return this.closeFunction();
    this.action = {
      index: this.value.index,
      value: this.value.value,
    };
  },
  methods: {
    onChange(item) {
      const index = EVENT_SETTINGS.findIndex(({ name }) => item.name === name);
      this.action.index = index;
      this.action.value = null;
    },
    save() {
      if (!this.action || !this.selectedAction) return;

      const action = {
        ...this.action,
        ...this.selectedAction,
      };

      this.saveFunction(action);
      this.closeFunction();
    },
  },
};
</script>

<style></style>
