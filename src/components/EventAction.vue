<template>
  <v-card
    variant="outlined"
    class="event-action-card d-flex align-center justify-space-between pa-2 mb-2"
  >
    <div class="bg-grey-lighten-4 pa-1 my-n2 ml-n2">
      <v-btn icon block size="28" variant="text" @click="editFunction">
        <v-icon size="small" color="primary">mdi-cog</v-icon>
      </v-btn>
      <v-btn icon block size="28" variant="text" @click="removeFunction">
        <v-icon size="small" color="primary">mdi-close-circle</v-icon>
      </v-btn>
    </div>
    <div>
      <span class="mx-2 text-uppercase font-weight-bold" v-text="action.name" />
      <span v-text="value" />
    </div>
  </v-card>
</template>

<script>
export default {
  name: "EventAction",
  props: {
    action: { type: Object, required: true },
    editFunction: { type: Function, required: true },
    removeFunction: { type: Function, required: true },
  },
  computed: {
    value() {
      if (!this.action) return;
      return this.action.type === "SELECT"
        ? this.action.args.find((arg) => arg.value === this.action.value).text
        : this.action.value;
    },
  },
};
</script>

<style scoped>
.event-action-card {
  border-color: #e0e0e0;
}
</style>
