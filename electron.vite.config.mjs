import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(
  readFileSync(path.resolve(projectRoot, "package.json"), "utf8"),
).version;
const requestedFlightsTarget = process.env.CATS_FLIGHTS_TARGET;
const flightsTarget =
  requestedFlightsTarget === "staging" ||
  requestedFlightsTarget === "production"
    ? requestedFlightsTarget
    : process.env.NODE_ENV === "development"
      ? "staging"
      : "production";
const flightsOrigin =
  flightsTarget === "staging"
    ? "https://cats-flights-stage-7k2m9x4p.peppy-ridge-7142.chatgpt.site"
    : "https://flights.catsystems.io";
const flightsDefines = {
  "globalThis.__CATS_FLIGHTS_ORIGIN__": JSON.stringify(flightsOrigin),
  "globalThis.__CATS_FLIGHTS_TARGET__": JSON.stringify(flightsTarget),
};

export default defineConfig({
  main: {
    define: flightsDefines,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "src"),
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: path.resolve(projectRoot, "src/background.js"),
      },
    },
  },
  preload: {
    define: flightsDefines,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "src"),
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: path.resolve(projectRoot, "src/preload.js"),
      },
    },
  },
  renderer: {
    root: projectRoot,
    base: "./",
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "src"),
      },
    },
    plugins: [vue()],
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
      ...flightsDefines,
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: path.resolve(projectRoot, "index.html"),
      },
    },
  },
});
