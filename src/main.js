import "@mdi/font/css/materialdesignicons.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "vuetify/styles";
import "@/assets/style/main.scss";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import vuetify from "./plugins/vuetify.js";
import router from "./router/index.js";

const application = createApp(App);

application.directive("resize", {
  mounted(element, binding) {
    const resizeHandler = () => {
      binding.value({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      });
    };
    element.__catsResizeHandler = resizeHandler;
    window.addEventListener("resize", resizeHandler);
  },
  unmounted(element) {
    window.removeEventListener("resize", element.__catsResizeHandler);
    delete element.__catsResizeHandler;
  },
});

application.use(createPinia());
application.use(router);
application.use(vuetify);
application.mount("#app");
