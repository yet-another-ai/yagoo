import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // @sabaki/sgf pulls Node-only modules for encode/decode; browser parse is enough.
      fs: new URL("./src/shims/empty.ts", import.meta.url).pathname,
      "iconv-lite": new URL("./src/shims/empty.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
