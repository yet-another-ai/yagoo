<script setup lang="ts">
import { ref } from "vue";
import { presentError, presentSource, useYagooI18n } from "../i18n";

const { t } = useYagooI18n();

const props = defineProps<{
  nativeAvailable: boolean;
  browserAvailable: boolean;
  sourceLabel?: string | null;
  /** Shown beside Enable threads when cross-origin isolation is off. Not an error. */
  threadHint?: string | null;
  /** Set only when a developer configured a remote manifest. Never fetched on load. */
  remoteManifestUrl?: string | null;
  modelStatus?: string | null;
  nativeUrl?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "sgf-file", file: File): void;
  (e: "ndjson-file", file: File): void;
  (e: "connect-native", url: string): void;
  (e: "connect-browser"): void;
  (e: "local-model-files", files: File[]): void;
  (e: "enable-threads"): void;
  (e: "load-remote-manifest"): void;
}>();

const docsHref = `${import.meta.env.BASE_URL || "/"}browser-engine`;

function onLocalFiles(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = "";
  if (files.length) emit("local-model-files", files);
}

function onModelDrop(ev: DragEvent) {
  const files = ev.dataTransfer?.files;
  if (!files?.length) return;
  const picked = Array.from(files).filter((file) =>
    /\.(json|onnx)$/i.test(file.name),
  );
  if (!picked.length) return;
  emit("local-model-files", picked);
}
const nativeUrl = ref(props.nativeUrl ?? "http://127.0.0.1:8710/analyze");

function onFile(kind: "sgf" | "ndjson", ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (kind === "sgf") emit("sgf-file", file);
  else emit("ndjson-file", file);
}
</script>

<template>
  <div
    class="yagoo-source"
    data-testid="engine-source"
    role="dialog"
    aria-modal="true"
    aria-labelledby="yagoo-source-title"
  >
    <header class="yagoo-source__header">
      <h2 id="yagoo-source-title">{{ t("engine.title") }}</h2>
      <button type="button" class="yagoo-source__close" @click="emit('close')">
        {{ t("engine.close") }}
      </button>
    </header>
    <p v-if="sourceLabel" class="yagoo-source__current">
      {{ t("engine.current", { label: presentSource(sourceLabel) }) }}
    </p>

    <section class="yagoo-source__card" data-source="ndjson">
      <h3>{{ t("engine.ndjsonTitle") }}</h3>
      <p>
        {{ t("engine.ndjsonBody") }}
      </p>
      <div class="yagoo-source__actions">
        <label class="yagoo-btn">
          {{ t("engine.openSgf") }}
          <input
            type="file"
            accept=".sgf,text/plain"
            hidden
            data-testid="source-sgf-input"
            @change="onFile('sgf', $event)"
          />
        </label>
        <label class="yagoo-btn">
          {{ t("engine.importNdjson") }}
          <input
            type="file"
            accept=".ndjson,.jsonl,.json,text/plain"
            hidden
            data-testid="source-ndjson-input"
            @change="onFile('ndjson', $event)"
          />
        </label>
      </div>
    </section>

    <section class="yagoo-source__card" data-source="live-native">
      <h3>{{ t("engine.nativeTitle") }}</h3>
      <p>{{ t("engine.nativeBody") }}</p>
      <label>
        {{ t("engine.nativeUrl") }}
        <input v-model="nativeUrl" type="url" data-testid="native-url" />
      </label>
      <button
        type="button"
        class="yagoo-btn"
        :disabled="!nativeAvailable"
        @click="emit('connect-native', nativeUrl)"
      >
        {{ t("engine.connect") }}
      </button>
    </section>

    <section class="yagoo-source__card" data-source="browser-engine">
      <h3>
        {{ t("engine.browserTitle") }}
        <span class="yagoo-source__issue">{{ t("engine.experimental") }}</span>
      </h3>
      <div
        class="yagoo-model-island"
        data-testid="model-island-slot"
        data-slot="model-island"
        @dragenter.stop.prevent
        @dragover.stop.prevent
        @drop.stop.prevent="onModelDrop"
      >
        <p class="yagoo-model-island__title">{{ t("engine.localModel") }}</p>
        <p>
          {{ t("engine.localBodyBefore") }}
          (<a :href="docsHref">{{ t("engine.howToExport") }}</a>){{ t("engine.localBodyAfter") }}
        </p>
        <p v-if="modelStatus" class="yagoo-model-island__status" data-testid="model-status">
          {{ presentError(modelStatus) }}
        </p>
        <p v-if="threadHint" class="yagoo-thread-hint" data-testid="thread-hint">
          {{ presentError(threadHint) }}
        </p>
        <div class="yagoo-source__actions">
          <label class="yagoo-btn">
            {{ t("engine.loadLocal") }}
            <input
              type="file"
              multiple
              hidden
              accept=".json,.onnx,application/json,application/octet-stream"
              data-testid="load-local-model"
              @change="onLocalFiles"
            />
          </label>
          <button
            type="button"
            class="yagoo-btn"
            data-testid="enable-threads"
            @click="emit('enable-threads')"
          >
            {{ t("engine.enableThreads") }}
          </button>
        </div>
        <div v-if="remoteManifestUrl" class="yagoo-source__remote">
          <p>{{ t("engine.remoteBody") }}</p>
          <p><code>{{ remoteManifestUrl }}</code></p>
          <button
            type="button"
            class="yagoo-btn"
            data-testid="load-remote-manifest"
            @click="emit('load-remote-manifest')"
          >
            {{ t("engine.loadRemote") }}
          </button>
        </div>
      </div>
      <button
        type="button"
        class="yagoo-btn"
        data-testid="use-browser-engine"
        :disabled="!browserAvailable"
        @click="emit('connect-browser')"
      >
        {{ t("engine.useBrowser") }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.yagoo-source {
  width: min(28rem, calc(100vw - 1.5rem));
  max-height: min(70vh, 36rem);
  overflow: auto;
  padding: 0.85rem 0.9rem 1rem;
  border: 1px solid var(--yagoo-border, #d0d0d6);
  border-radius: 10px;
  background: var(--yagoo-panel, #fff);
  color: var(--yagoo-text, #1a1a1a);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}

.yagoo-source__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.yagoo-source h2 {
  margin: 0;
  font-size: 1rem;
}

.yagoo-source h3 {
  margin: 0 0 0.3rem;
  font-size: 0.88rem;
}

.yagoo-source__close,
.yagoo-btn {
  border: 1px solid var(--yagoo-border, #c8c8d0);
  background: var(--yagoo-panel-2, #f3f3f6);
  color: inherit;
  border-radius: 4px;
  padding: 0.28rem 0.6rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.yagoo-btn:disabled,
.yagoo-source__close:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.yagoo-source__current,
.yagoo-source p {
  margin: 0.35rem 0 0.55rem;
  color: var(--yagoo-muted, #4a4a55);
  font-size: 0.8rem;
  line-height: 1.4;
}

.yagoo-source__card {
  padding: 0.65rem 0 0.15rem;
  border-top: 1px solid var(--yagoo-border, #e2e2e6);
}

.yagoo-source__issue {
  margin-left: 0.35rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--yagoo-accent, #0066cc);
}

.yagoo-source__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.yagoo-model-island {
  margin: 0 0 0.55rem;
  padding: 0.6rem 0.7rem;
  border: 1px dashed var(--yagoo-border, #c8c8d0);
  border-radius: 8px;
  background: var(--yagoo-bg, #f6f6f7);
}

.yagoo-model-island__title {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--yagoo-muted, #5c5c66);
}

.yagoo-model-island__status,
.yagoo-thread-hint {
  margin: 0.35rem 0;
}

.yagoo-thread-hint {
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--yagoo-accent, #0066cc) 8%, transparent);
}

.yagoo-source__remote {
  margin-top: 0.45rem;
}
</style>
