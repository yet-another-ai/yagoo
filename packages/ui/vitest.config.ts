import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  define: {
    __VUE_I18N_FULL_INSTALL__: false,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  resolve: {
    alias: {
      // @sabaki/sgf pulls Node-only modules for encode/decode; browser parse is enough.
      fs: new URL("./src/shims/empty.ts", import.meta.url).pathname,
      "iconv-lite": new URL("./src/shims/empty.ts", import.meta.url).pathname,
      "vue-i18n": new URL("./node_modules/vue-i18n/dist/vue-i18n.esm-bundler.js", import.meta.url).pathname,
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/i18n/test-setup.ts"],
    include: ["src/**/*.test.ts"],
    // AnalysisReviewer progressive NDJSON drain can take several seconds under
    // parallel mise ci load; keep headroom above the default 5s.
    testTimeout: 30_000,
  },
});
