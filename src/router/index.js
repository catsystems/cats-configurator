import Vue from "vue";
import VueRouter from "vue-router";
import HomeView from "../views/Home.vue";
import ConfigView from "../views/Config.vue";
import EventsView from "../views/Events.vue";
import TimersView from "../views/Timers.vue";
import LogsView from "../views/Logs.vue";
import CliView from "../views/Cli.vue";

Vue.use(VueRouter);

const routes = [
  {
    path: "/",
    name: "Home",
    component: HomeView,
  },
  {
    path: "/config",
    name: "Config",
    component: ConfigView,
  },
  {
    path: "/events",
    name: "Events",
    component: EventsView,
  },
  {
    path: "/timer",
    name: "Timers",
    component: TimersView,
  },
  /*{
    path: "/log",
    name: "Log",
    component: LogsView,
  },*/
  {
    path: "/cli",
    name: "Cli",
    component: CliView,
  },
];

const router = new VueRouter({
  mode: "history",
  base: process.env.BASE_URL,
  routes,
});

export default router;
