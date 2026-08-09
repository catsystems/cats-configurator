import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(
  readFileSync(path.resolve(projectRoot, "package.json"), "utf8"),
).version;

export default defineConfig({
  main: {
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
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: path.resolve(projectRoot, "index.html"),
      },
    },
  },
});
