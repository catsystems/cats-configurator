<template>
  <v-card outlined class="d-flex align-center justify-space-between pa-2 mb-2">
    <div class="grey lighten-4 pa-1 my-n2 ml-n2">
      <v-btn icon block small @click="editFunction">
        <v-icon small color="primary">mdi-cog</v-icon>
      </v-btn>
      <v-btn icon block small @click="removeFunction">
        <v-icon small color="primary">mdi-close-circle</v-icon>
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
    action: Object,
    editFunction: Function,
    removeFunction: Function,
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

<style></style>
