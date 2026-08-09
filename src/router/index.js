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
    meta: { requiresBoard: true },
    component: () => import("../views/Config.vue"),
  },
  {
    path: "/events",
    name: "Events",
    meta: { requiresBoard: true },
    component: () => import("../views/Events.vue"),
  },
  {
    path: "/timer",
    name: "Timers",
    meta: { requiresBoard: true },
    component: () => import("../views/Timers.vue"),
  },
  {
    path: "/flight-logs",
    name: "FlightLogs",
    component: () => import("../views/FlightLogs.vue"),
  },
  {
    path: "/cli",
    name: "Cli",
    meta: { requiresBoard: true },
    component: () => import("../views/Cli.vue"),
  },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
