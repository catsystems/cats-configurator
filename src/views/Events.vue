<template>
  <div>
    <v-container fluid>
      <v-slide-group show-arrows>
        <v-slide-item v-for="key in Object.keys(events)" :key="key">
          <v-card flat max-height="100%">
            <v-card-title class="py-2">
              <span class="text-capitalize" v-text="key.split('_')[1]" />
              <span></span>
            </v-card-title>
            <v-card-text>
              <v-card outlined>
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
                    :disabled="isActionsFilled(events[key])"
                    @click="onAddActionClick(key)"
                  >
                    Add Action
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-card-text>
          </v-card>
        </v-slide-item>
      </v-slide-group>
    </v-container>
    <ActionsBar @refresh="init" @save="saveData" />
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
import { mapState, mapGetters, mapActions } from "vuex";
import { getEvents, setEvents } from "@/services/eventService";

import ActionsBar from "@/components/ActionsBar";
import EventAction from "@/components/EventAction";
import AddEventActionDialog from "@/components/AddEventActionDialog";
import EditEventActionDialog from "@/components/EditEventActionDialog";

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
    };
  },
  computed: {
    ...mapState({
      changedTab: (state) => state.changedTab,
      events: (state) => state.events,
    }),
    ...mapGetters(["isEventsChanged"]),
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
    ...mapActions([
      "setChangedTab",
      "editEventAction",
      "removeEventAction",
      "addEventAction",
    ]),
    init() {
      getEvents();
    },
    saveData() {
      
      setEvents(this.events);
      setTimeout(function () {
        getEvents();
      }, 200);
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
</style>
