import Vue from "vue";
import App from "./App.vue";
import router from "./router";
import store from "./store";
import vuetify from "./plugins/vuetify";

Vue.config.productionTip = false;

/* Add new vue directive that calls a function every time an element is resized */
Vue.directive('resize', {
  inserted: function(el, binding) {
    const onResizeCallback = binding.value;
    window.addEventListener('resize', () => {
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      onResizeCallback({ width, height });
    })
  }
});

new Vue({
  router,
  store,
  vuetify,
  render: (h) => h(App),
}).$mount("#app");
