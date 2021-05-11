<template>
<div>
    <div class="header">
        <a href="#default" class="logo">Logo</a>
        <div class="header-right">
            <select v-model="test">
                <option v-bind:key="value.test" v-for="value in test">{{ value.test }}</option>
            </select>

            hello:
            {{ test2 }}

          <a class="active" href="#connect">Connect</a>
        </div>
      </div>

    <div id="mySidenav" class="sidenav" display = "block">
		<div id="sidenav">
		    <a href="#">Configuration</a>
			<a href="#">Events</a>
			<a href="#">Timers</a>
			<a href="#">Log</a>
		</div>
    </div>

	<div id="content">
		<slot />
	</div>
</div>
</template>

<script>
import { mapGetters, mapActions } from 'vuex'

export default {

    data: function () {

        return {
            test2: 'test',

            test: [
                {'test':'test'},
                {'test':'test2'}
            ]
        };
    },

    computed: {
        serialPortList() {
            return ;
        }
    },
    methods: {
        ...mapActions([
            'getSerialList'
        ])
    }
}
</script>
