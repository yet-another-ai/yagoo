<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { messageRef, presentError, serializeError, useYagooI18n, AnalysisReviewer } from "@yagoo/ui";
import { configuredManifestUrl } from "@yagoo/browser-engine/manifest-url";
import { useData } from "vitepress";
import "@yagoo/ui/styles.css";
import type { ReviewerBrowserEngine } from "@yagoo/browser-engine/reviewer-adapter";

const { site, lang } = useData();
const hostLocale = computed(() => {
  const locales = site.value.locales ?? {};
  return Object.keys(locales).length > 0 ? lang.value : null;
});
const explicitLocale = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("lang")
  : null;
const { t } = useYagooI18n({ explicit: explicitLocale, host: hostLocale.value });

const props = defineProps<{
  layout?: "page" | "embed" | "full";
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
let disposed = false;
let modelGeneration = 0;
const loading = new AbortController();
onBeforeUnmount(() => {
  disposed = true;
  modelGeneration++;
  loading.abort();
  engine.value?.dispose();
});

onMounted(async () => {
  const requested = new URLSearchParams(window.location.search).get("theme");
  if (requested === "dark" || requested === "light") theme.value = requested;
  threadHint.value = crossOriginIsolated ? null : "engine.singleThread";
  remoteManifestUrl.value = configuredManifestUrl();
  const { replaceStaleIsolation } = await import("@yagoo/browser-engine/isolation");
  void replaceStaleIsolation();
  try {
    const base = import.meta.env.BASE_URL;
    const [sgfRes, ndjsonRes] = await Promise.all([
      fetch(`${base}app/sample.sgf`, { signal: loading.signal }),
      fetch(`${base}app/sample-scan-deep.ndjson`, { signal: loading.signal }),
    ]);
    if (!sgfRes.ok || !ndjsonRes.ok) {
      throw new Error("docs.loadFailed");
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
  if (disposed) throw new DOMException("Reviewer was closed.", "AbortError");
  engine.value ??= new ReviewerBrowserEngine();
  return engine.value;
}

async function onLocalFiles(files: File[]) {
  const generation = ++modelGeneration;
  staged.value = false;
  try {
    const handle = await engineHandle();
    if (disposed || generation !== modelGeneration) return;
    const model = await handle.stageLocal(files);
    if (disposed || generation !== modelGeneration) return;
    staged.value = handle.ready;
    modelStatus.value = messageRef("engine.verified", { model });
  } catch (err) {
    if (disposed || generation !== modelGeneration) return;
    engine.value?.dispose();
    engine.value = null;
    staged.value = false;
    modelStatus.value = serializeError(err);
  }
}

async function onRemote() {
  if (!remoteManifestUrl.value) return;
  const generation = ++modelGeneration;
  staged.value = false;
  try {
    const handle = await engineHandle();
    if (disposed || generation !== modelGeneration) return;
    handle.stageRemote(remoteManifestUrl.value);
    staged.value = handle.ready;
    modelStatus.value = messageRef("engine.remoteSelected");
  } catch (err) {
    if (disposed || generation !== modelGeneration) return;
    engine.value?.dispose();
    engine.value = null;
    staged.value = false;
    modelStatus.value = serializeError(err);
  }
}

async function onThreads() {
  const { enableIsolation, pageIsolationScope } = await import("@yagoo/browser-engine/isolation");
  const scope = pageIsolationScope();
  modelStatus.value = scope ? await enableIsolation(scope) : "engine.threadsScope";
}
</script>

<template>
  <div
    class="yagoo-docs-app"
    :class="{
      'yagoo-docs-app--embed': props.layout === 'embed',
      'yagoo-docs-app--full': props.layout === 'full',
    }"
  >
    <p v-if="error" class="yagoo-docs-app__error">{{ presentError(error) }}</p>
    <p v-else-if="!ready" class="yagoo-docs-app__loading">{{ t("docs.loading") }}</p>
    <AnalysisReviewer
      v-else
      :initial-sgf="sgf"
      :initial-ndjson="ndjson"
      :initial-analysis-notice="t('docs.sampleNotice')"
      :locale="explicitLocale"
      :host-locale="hostLocale"
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

.yagoo-docs-app--full {
  height: 100%;
  min-height: 0;
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
