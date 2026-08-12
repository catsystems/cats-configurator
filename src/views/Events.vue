<template>
  <div>
    <v-container fluid>
      <v-slide-group show-arrows>
        <v-slide-group-item v-for="key in Object.keys(events)" :key="key">
          <v-card class="event-column-card" variant="flat" max-height="100%">
            <v-card-title class="py-2">
              <span class="text-capitalize" v-text="key.split('_')[1]" />
              <span></span>
            </v-card-title>
            <v-card-text>
              <v-card class="event-actions-card" variant="outlined">
                <v-card-text v-if="events[key].actions.length" class="pa-2">
                  <div class="event-action">
                    <EventAction
                      v-for="(action, index) in events[key].actions"
                      :key="index"
                      :action="action"
                      :editFunction="() => onEditAction({ action, key, index })"
                      :removeFunction="() => removeEventAction({ key, index })"
                    />
                  </div>
                </v-card-text>
                <v-card-actions>
                  <v-btn
                    block
                    color="primary"
                    variant="elevated"
                    :disabled="isActionsFilled(events[key])"
                    @click="onAddActionClick(key)"
                  >
                    Add Action
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-card-text>
          </v-card>
        </v-slide-group-item>
      </v-slide-group>
    </v-container>
    <ActionsBar
      :saving="saveLoading"
      :changed="changed"
      @refresh="init"
      @save="saveData"
    />
    <v-dialog v-model="addActionDialog" width="500">
      <AddEventActionDialog
        v-if="addActionDialog"
        :event="currentEvent"
        :closeFunction="() => (addActionDialog = false)"
        :saveFunction="addAction"
      />
    </v-dialog>
    <v-dialog v-model="editActionDialog" width="500">
      <EditEventActionDialog
        v-if="editActionDialog"
        :event="currentEvent"
        :value="currentAction"
        :saveFunction="editAction"
        :closeFunction="() => (editActionDialog = false)"
      />
    </v-dialog>
  </div>
</template>

<script>
import { mapActions, mapState } from "pinia";
import { useAppStore } from "@/store";
import { getEvents, setEvents } from "@/services/eventService";

import ActionsBar from "@/components/ActionsBar.vue";
import EventAction from "@/components/EventAction.vue";
import AddEventActionDialog from "@/components/AddEventActionDialog.vue";
import EditEventActionDialog from "@/components/EditEventActionDialog.vue";

export default {
  name: "EventsView",
  components: {
    ActionsBar,
    EventAction,
    AddEventActionDialog,
    EditEventActionDialog,
  },
  data() {
    return {
      addActionDialog: false,
      editActionDialog: false,
      currentKey: null,
      currentAction: null,
      currentActionIndex: null,
      saveLoading: false,
    };
  },
  computed: {
    ...mapState(useAppStore, ["changedTab", "events", "isEventsChanged"]),
    changed() {
      return this.changedTab === "events";
    },
    currentEvent() {
      const event = this.events[this.currentKey];
      if (!event) return;
      return {
        ...event,
        filled: this.isActionsFilled(event),
      };
    },
  },
  watch: {
    isEventsChanged(changed) {
      this.setChangedTab(changed ? "events" : null);
    },
  },
  mounted() {
    this.init();
  },
  methods: {
    ...mapActions(useAppStore, [
      "setChangedTab",
      "editEventAction",
      "removeEventAction",
      "addEventAction",
      "showErrorSnackbar",
    ]),
    init() {
      getEvents();
    },
    async saveData() {
      this.saveLoading = true;
      try {
        await setEvents(this.events);
        await getEvents();
      } catch (error) {
        this.showErrorSnackbar(error.message);
      } finally {
        this.saveLoading = false;
      }
    },
    isActionsFilled(event) {
      return event.actions.length >= Math.floor(event.arrayLength / 2);
    },
    onAddActionClick(key) {
      this.currentKey = key;
      this.addActionDialog = true;
    },
    onEditAction({ action, key, index }) {
      this.currentAction = action;
      this.currentKey = key;
      this.currentActionIndex = index;
      this.editActionDialog = true;
    },
    editAction(action) {
      const data = {
        action,
        index: this.currentActionIndex,
        key: this.currentKey,
      };

      this.editEventAction(data);
    },
    addAction(action) {
      this.addEventAction({ key: this.currentKey, action });
    },
  },
};
</script>

<style scoped>
.event-action {
  max-height: calc(100vh - 290px);
  overflow: scroll;
}

.event-actions-card {
  border-color: #e0e0e0;
}

.event-column-card > :deep(.v-card-title) {
  min-height: 48px;
}
</style>
