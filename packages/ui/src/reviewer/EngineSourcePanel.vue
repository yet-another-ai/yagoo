<script setup lang="ts">
defineProps<{
  nativeAvailable: boolean;
  browserAvailable: boolean;
  sourceLabel?: string | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "sgf-file", file: File): void;
  (e: "ndjson-file", file: File): void;
  (e: "connect-native"): void;
  (e: "connect-browser"): void;
}>();

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
      <h2 id="yagoo-source-title">Engine source</h2>
      <button type="button" class="yagoo-source__close" @click="emit('close')">
        Close
      </button>
    </header>
    <p v-if="sourceLabel" class="yagoo-source__current">
      Current: {{ sourceLabel }}
    </p>

    <section class="yagoo-source__card" data-source="ndjson">
      <h3>NDJSON import</h3>
      <p>
        Open an SGF, then import a <code>yagoo analyze</code> event stream.
        You can also drop both files on the board. Analysis streams in as the
        file is read.
      </p>
      <div class="yagoo-source__actions">
        <label class="yagoo-btn">
          Open SGF
          <input
            type="file"
            accept=".sgf,text/plain"
            hidden
            data-testid="source-sgf-input"
            @change="onFile('sgf', $event)"
          />
        </label>
        <label class="yagoo-btn">
          Import NDJSON
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
      <h3>Live native <span class="yagoo-source__issue">Coming in #19</span></h3>
      <p>
        <code>yagoo analyze --serve</code> will stream the same events over
        WebSocket or SSE. The reviewer already has a
        <code>createLiveNativeSource</code> adapter; it is not connected.
      </p>
      <button
        type="button"
        class="yagoo-btn"
        :disabled="!nativeAvailable"
        @click="emit('connect-native')"
      >
        Connect to local engine
      </button>
    </section>

    <section class="yagoo-source__card" data-source="browser-engine">
      <h3>
        Browser engine
        <span class="yagoo-source__issue">Coming in #20</span>
      </h3>
      <p>
        Experimental WebGPU / Wasm analysis stays on its own page until the
        adapter is wired. Weights are never downloaded from this reviewer.
      </p>
      <div
        class="yagoo-model-island"
        data-testid="model-island-slot"
        data-slot="model-island"
      >
        <slot name="model-island">
          <p class="yagoo-model-island__title">Model island</p>
          <p>
            Catalog, progress, cancel, OPFS cache, and local model files are on
            the experimental page (#22). This slot is where that island mounts.
            <strong>Coming in #20.</strong>
            Page load does not fetch weights.
          </p>
        </slot>
      </div>
      <button
        type="button"
        class="yagoo-btn"
        :disabled="!browserAvailable"
        @click="emit('connect-browser')"
      >
        Use browser engine
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
</style>
