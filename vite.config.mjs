import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const packageVersion = JSON.parse(
  readFileSync(path.resolve(projectRoot, "package.json"), "utf8"),
).version;

export default defineConfig({
  base: "./",
  clearScreen: false,
  server: {
    strictPort: true,
  },
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
  },
});
