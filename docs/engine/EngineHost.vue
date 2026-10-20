<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import { AnalysisReviewer } from "@yagoo/ui";
import { SINGLE_THREAD_NOTE } from "@yagoo/browser-engine/capabilities";
import { configuredManifestUrl } from "@yagoo/browser-engine/manifest-url";
import "@yagoo/ui/styles.css";
import type { ReviewerBrowserEngine } from "@yagoo/browser-engine/reviewer-adapter";

const props = defineProps<{
  layout?: "page" | "embed";
}>();

const sgf = ref("");
const ndjson = ref("");
const ready = ref(false);
const error = ref<string | null>(null);
const theme = ref<"auto" | "light" | "dark">("auto");
const remoteManifestUrl = ref<string | null>(null);
const threadHint = ref<string | null>(null);
const modelStatus = ref<string | null>(null);
const engine = shallowRef<ReviewerBrowserEngine | null>(null);
const staged = ref(false);

onMounted(async () => {
  const requested = new URLSearchParams(window.location.search).get("theme");
  if (requested === "dark" || requested === "light") theme.value = requested;
  threadHint.value = crossOriginIsolated ? null : SINGLE_THREAD_NOTE;
  remoteManifestUrl.value = configuredManifestUrl();
  try {
    const base = import.meta.env.BASE_URL;
    const [sgfRes, ndjsonRes] = await Promise.all([
      fetch(`${base}app/sample.sgf`),
      fetch(`${base}app/sample-scan-deep.ndjson`),
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

async function engineHandle(): Promise<ReviewerBrowserEngine> {
  if (engine.value) return engine.value;
  const { ReviewerBrowserEngine } = await import("@yagoo/browser-engine/reviewer-adapter");
  engine.value = new ReviewerBrowserEngine();
  return engine.value;
}

async function onLocalFiles(files: File[]) {
  staged.value = false;
  try {
    const handle = await engineHandle();
    const model = await handle.stageLocal(files);
    staged.value = handle.ready;
    modelStatus.value = `${model} verified from local files. Recorded analysis stays until you choose Use browser engine.`;
  } catch (err) {
    engine.value = null;
    staged.value = false;
    modelStatus.value = err instanceof Error ? err.message : String(err);
  }
}

async function onRemote() {
  if (!remoteManifestUrl.value) return;
  staged.value = false;
  try {
    const handle = await engineHandle();
    handle.stageRemote(remoteManifestUrl.value);
    staged.value = handle.ready;
    modelStatus.value = "Configured manifest selected. It is loaded when you choose Use browser engine.";
  } catch (err) {
    engine.value = null;
    staged.value = false;
    modelStatus.value = err instanceof Error ? err.message : String(err);
  }
}

async function onThreads() {
  const { enableIsolation, pageIsolationScope } = await import("@yagoo/browser-engine/isolation");
  const scope = pageIsolationScope();
  modelStatus.value = scope
    ? await enableIsolation(scope)
    : "Enable threads from the demo or reviewer page so the service worker stays scoped to that page.";
}
</script>

<template>
  <div class="yagoo-docs-app" :class="{ 'yagoo-docs-app--embed': props.layout === 'embed' }">
    <p v-if="error" class="yagoo-docs-app__error">{{ error }}</p>
    <p v-else-if="!ready" class="yagoo-docs-app__loading">Loading sample…</p>
    <AnalysisReviewer
      v-else
      :initial-sgf="sgf"
      :initial-ndjson="ndjson"
      initial-analysis-notice="Historical recording: queries omitted move history, so ko-forbidden candidates can appear. Use this sample to inspect the UI, not to assess the historical moves."
      :theme="theme"
      :browser-engine="staged ? engine : null"
      :thread-hint="threadHint"
      :remote-manifest-url="remoteManifestUrl"
      :model-status="modelStatus"
      @local-model-files="onLocalFiles"
      @enable-threads="onThreads"
      @load-remote-manifest="onRemote"
    />
  </div>
</template>

<style scoped>
.yagoo-docs-app {
  height: calc(100vh - var(--vp-nav-height, 64px));
  min-height: 560px;
  margin: var(--vp-nav-height, 64px) 0 0;
}

.yagoo-docs-app--embed {
  height: min(820px, 80vh);
  margin: 1rem 0 2rem;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
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
