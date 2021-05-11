<template>
    <Layout>
        test
    </Layout>
</template>

<script>

import Layout from "./Layout.vue"
import { mapGetters, mapActions } from 'vuex'

export default {
    components: {
        Layout
    },

    mounted() {
        this.getSerialList();
        console.log(this.$store.state.Serial.list);
    },

    methods: {
        ...mapActions([
            'getSerialList'
        ])
    }
}
</script>
