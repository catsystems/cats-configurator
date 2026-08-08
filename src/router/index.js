import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "Home",
    component: () => import("../views/Home.vue"),
  },
  {
    path: "/config",
    name: "Config",
    component: () => import("../views/Config.vue"),
  },
  {
    path: "/events",
    name: "Events",
    component: () => import("../views/Events.vue"),
  },
  {
    path: "/timer",
    name: "Timers",
    component: () => import("../views/Timers.vue"),
  },
  {
    path: "/cli",
    name: "Cli",
    component: () => import("../views/Cli.vue"),
  },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
