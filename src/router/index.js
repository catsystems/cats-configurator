import { createRouter, createWebHashHistory } from "vue-router";
import { useAppStore } from "@/store";

const routes = [
  {
    path: "/firmware",
    name: "Firmware Updates",
    component: () => import("../views/FirmwareUpdates.vue"),
  },
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
    redirect: "/events?section=timers",
  },
  {
    path: "/logging",
    name: "LegacyLogging",
    redirect: "/config",
  },
  {
    path: "/profiles",
    name: "Profiles",
    meta: { requiresBoard: true },
    component: () => import("../views/Profiles.vue"),
  },
  {
    path: "/preflight",
    name: "Preflight",
    meta: { requiresBoard: true },
    component: () => import("../views/Preflight.vue"),
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

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to, from) => {
  if (useAppStore().firmwareBusy && to.fullPath !== from.fullPath) return false;
});

export default router;
