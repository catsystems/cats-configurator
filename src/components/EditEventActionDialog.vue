<template>
  <v-card class="event-dialog-card">
    <v-card-title class="event-dialog-title d-flex align-center">
      <span>Edit Action</span>
    </v-card-title>
    <v-card-text>
      <v-form>
        <v-row>
          <v-col cols="12">
            <v-select
              :model-value="selectedAction"
              :items="eventConfigs"
              item-title="name"
              label="Action"
              variant="solo"
              density="compact"
              hide-details
              return-object
              autofocus
              @update:model-value="onChange"
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
                variant="solo"
                density="compact"
                @keydown.enter.prevent="save"
              >
                <template #append-inner>
                  {{ selectedAction.unit }}
                </template>
              </v-text-field>
              <v-select
                v-else-if="selectedAction.type === 'SELECT'"
                v-model.number="action.value"
                :items="selectedAction.args"
                item-title="text"
                item-value="value"
                label="State"
                variant="solo"
                density="compact"
                hide-details
                @keydown.enter.prevent="save"
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
    event: { type: Object, required: true },
    value: { type: Object, required: true },
    saveFunction: { type: Function, required: true },
    closeFunction: { type: Function, required: true },
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

<style scoped>
.event-dialog-title {
  min-height: 58px;
}

.event-dialog-card :deep(.v-card-text) {
  padding: 8px 16px;
}
</style>
