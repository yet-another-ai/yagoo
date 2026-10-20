<script setup lang="ts">
import { onMounted, ref } from "vue";
import { AnalysisReviewer } from "@yagoo/ui";
import "@yagoo/ui/styles.css";

const sgf = ref<string>("");
const ndjson = ref<string>("");
const ready = ref(false);
const error = ref<string | null>(null);
const theme = ref<"auto" | "light" | "dark">("auto");

onMounted(async () => {
  const requested = new URLSearchParams(window.location.search).get("theme");
  if (requested === "dark" || requested === "light") theme.value = requested;
  try {
    const [sgfRes, ndjsonRes] = await Promise.all([
      fetch("/app/sample.sgf"),
      fetch("/app/sample-scan-deep.ndjson"),
    ]);
    if (!sgfRes.ok || !ndjsonRes.ok) {
      throw new Error("Failed to load bundled sample SGF / NDJSON");
    }
    sgf.value = await sgfRes.text();
    ndjson.value = await ndjsonRes.text();
    ready.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
</script>

<template>
  <div class="yagoo-docs-app">
    <p v-if="error" class="yagoo-docs-app__error">{{ error }}</p>
    <p v-else-if="!ready" class="yagoo-docs-app__loading">Loading sample…</p>
    <AnalysisReviewer
      v-else
      :initial-sgf="sgf"
      :initial-ndjson="ndjson"
      :theme="theme"
    />
  </div>
</template>

<style scoped>
.yagoo-docs-app {
  height: calc(100vh - 64px);
  min-height: 560px;
  margin: 0;
}

.yagoo-docs-app__loading,
.yagoo-docs-app__error {
  padding: 2rem;
  color: var(--vp-c-text-2);
}

.yagoo-docs-app__error {
  color: var(--vp-c-danger-1, #e11);
}
</style>
