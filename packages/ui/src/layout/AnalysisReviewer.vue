<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  createBrowserEngineSource,
  createLiveNativeSource,
  createNdjsonTextSource,
  isBrowserEngineAvailable,
  isLiveNativeAvailable,
  resolveSgfRules,
  useAnalysisStream,
} from "../analysis";
import type { BoardMap, GhostStone, HeatVertex, LineMarker, Marker } from "../types";
import ReviewerLayout from "./ReviewerLayout.vue";
import "./styles/reviewer.css";

const props = withDefaults(
  defineProps<{
    /** Initial / bundled sample SGF. */
    initialSgf?: string;
    /** Initial / bundled NDJSON analysis (loaded progressively). */
    initialNdjson?: string;
    vertexSize?: number;
  }>(),
  {
    vertexSize: 28,
  },
);

const sgfText = ref(props.initialSgf ?? "");
const rulesLabel = computed(() => resolveSgfRules(sgfText.value));
const dragOver = ref(false);
const statusMessage = ref("");
const selectedCandidate = ref(0);
const currentPly = ref(0);

const {
  state,
  series,
  sourceLabel,
  isStreaming,
  reset,
  attachSource,
  overlaysFor,
  commentFor,
} = useAnalysisStream();

const emptyHeat = computed<BoardMap<HeatVertex | null>>(() => []);
const heatMap = ref<BoardMap<HeatVertex | null>>([]);
const paintMap = ref<BoardMap<number>>([]);
const ghostStoneMap = ref<BoardMap<GhostStone | null>>([]);
const markerMap = ref<BoardMap<Marker | null>>([]);
const lines = ref<LineMarker[]>([]);

function refreshOverlays() {
  const size =
    state.value.size ??
    Number.parseInt(/SZ\[(\d+)/i.exec(sgfText.value)?.[1] ?? "19", 10);
  const overlays = overlaysFor(currentPly.value, size, {
    selectedCandidate: selectedCandidate.value,
  });
  heatMap.value = overlays.heatMap;
  paintMap.value = overlays.paintMap;
  ghostStoneMap.value = overlays.ghostStoneMap;
  markerMap.value = overlays.markerMap;
  lines.value = overlays.lines;
}

watch([() => state.value, currentPly, selectedCandidate], refreshOverlays, {
  deep: true,
});

const analysisComment = computed(() =>
  commentFor(currentPly.value, /* sgf comment merged inside */ ""),
);

const liveAvailable = isLiveNativeAvailable();
const browserAvailable = isBrowserEngineAvailable(null);

onMounted(() => {
  if (props.initialNdjson) {
    loadNdjsonText(props.initialNdjson, "bundled sample analysis");
  } else {
    refreshOverlays();
  }
});

watch(
  () => props.initialSgf,
  (v) => {
    if (v) sgfText.value = v;
  },
);

function loadNdjsonText(text: string, label: string) {
  reset();
  statusMessage.value = `Loading ${label}…`;
  attachSource(
    createNdjsonTextSource(text, {
      progressive: true,
      batchSize: 3,
      label,
    }),
  );
  statusMessage.value = `Streaming from ${label}`;
}

async function onSgfFile(file: File) {
  const text = await file.text();
  sgfText.value = text;
  statusMessage.value = `Loaded SGF ${file.name} (rules: ${resolveSgfRules(text)})`;
}

async function onNdjsonFile(file: File) {
  const text = await file.text();
  loadNdjsonText(text, file.name);
}

function onFileInput(kind: "sgf" | "ndjson", ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (kind === "sgf") void onSgfFile(file);
  else void onNdjsonFile(file);
  input.value = "";
}

function onDrop(ev: DragEvent) {
  ev.preventDefault();
  dragOver.value = false;
  const files = ev.dataTransfer?.files;
  if (!files?.length) return;
  for (const file of Array.from(files)) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".sgf") || name.endsWith(".sgf.txt")) {
      void onSgfFile(file);
    } else if (
      name.endsWith(".ndjson") ||
      name.endsWith(".jsonl") ||
      name.endsWith(".json")
    ) {
      void onNdjsonFile(file);
    }
  }
}

function tryLiveNative() {
  reset();
  statusMessage.value = "Connecting to local native engine…";
  attachSource(createLiveNativeSource());
}

function tryBrowserEngine() {
  reset();
  statusMessage.value = "Starting browser engine…";
  attachSource(createBrowserEngineSource());
}

function onPlyChange(ply: number) {
  currentPly.value = ply;
}

const phaseBadge = computed(() => {
  const s = state.value;
  if (s.status === "error") return `error: ${s.lastError ?? "?"}`;
  if (s.currentPhase) {
    return `${s.currentPhase} @ ply ${s.activePly ?? "—"} (${s.eventCount} events)`;
  }
  if (s.status === "completed") {
    return `complete · ${s.eventCount} events · deep [${s.deepPlies.join(",") || "—"}]`;
  }
  if (isStreaming.value) return `streaming · ${s.eventCount} events`;
  return "idle";
});
</script>

<template>
  <div
    class="yagoo-analysis-app"
    :class="{ 'yagoo-analysis-app--drag': dragOver }"
    @dragenter.prevent="dragOver = true"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop="onDrop"
  >
    <header class="yagoo-analysis-app__toolbar">
      <div class="yagoo-analysis-app__brand">Yagoo Reviewer</div>
      <div class="yagoo-analysis-app__controls">
        <label class="yagoo-analysis-app__btn">
          Open SGF
          <input
            type="file"
            accept=".sgf,text/plain"
            hidden
            @change="onFileInput('sgf', $event)"
          />
        </label>
        <label class="yagoo-analysis-app__btn">
          Import NDJSON
          <input
            type="file"
            accept=".ndjson,.jsonl,.json,text/plain"
            hidden
            @change="onFileInput('ndjson', $event)"
          />
        </label>
        <button
          type="button"
          class="yagoo-analysis-app__btn"
          :disabled="!liveAvailable"
          :title="
            liveAvailable
              ? 'Connect to yagoo analyze --serve'
              : 'Follow-up: yagoo analyze --serve (WebSocket/SSE)'
          "
          @click="tryLiveNative"
        >
          Live native
        </button>
        <button
          type="button"
          class="yagoo-analysis-app__btn"
          :disabled="!browserAvailable"
          title="Follow-up: browser engine after PR #7 merges"
          @click="tryBrowserEngine"
        >
          Browser engine
        </button>
      </div>
      <div class="yagoo-analysis-app__meta">
        <span>RU {{ rulesLabel }}</span>
        <span v-if="sourceLabel">· {{ sourceLabel }}</span>
        <span>· {{ phaseBadge }}</span>
      </div>
    </header>

    <p v-if="statusMessage" class="yagoo-analysis-app__status">
      {{ statusMessage }}
    </p>
    <p v-if="dragOver" class="yagoo-analysis-app__drop">
      Drop SGF and/or NDJSON analysis files…
    </p>

    <div class="yagoo-analysis-app__board">
      <ReviewerLayout
        :sgf="sgfText"
        :winrate-data="series"
        :heat-map="heatMap.length ? heatMap : emptyHeat"
        :paint-map="paintMap"
        :ghost-stone-map="ghostStoneMap"
        :marker-map="markerMap"
        :lines="lines"
        :comment-override="analysisComment"
        comment-title="Analysis"
        :vertex-size="vertexSize"
        :show-coordinates="true"
        :fuzzy-stone-placement="true"
        :animate-stone-placement="true"
        :fuzzy-seed="42"
        @ply-change="onPlyChange"
      />
    </div>
  </div>
</template>

<style scoped>
.yagoo-analysis-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #0d0d0d;
  color: #eee;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial,
    sans-serif;
}

.yagoo-analysis-app--drag {
  outline: 2px dashed #0082f0;
  outline-offset: -4px;
}

.yagoo-analysis-app__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 0.55rem 0.85rem;
  background: #181818;
  border-bottom: 1px solid #333;
  flex: 0 0 auto;
}

.yagoo-analysis-app__brand {
  font-weight: 650;
  letter-spacing: 0.02em;
  color: #f2f2f2;
}

.yagoo-analysis-app__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.yagoo-analysis-app__btn {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.65rem;
  border: 1px solid #444;
  border-radius: 3px;
  background: #222;
  color: #eee;
  font-size: 0.82rem;
  cursor: pointer;
}

.yagoo-analysis-app__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.yagoo-analysis-app__btn:not(:disabled):hover {
  border-color: #0082f0;
}

.yagoo-analysis-app__meta {
  margin-left: auto;
  font-size: 0.78rem;
  color: #9a9a9a;
}

.yagoo-analysis-app__status,
.yagoo-analysis-app__drop {
  margin: 0;
  padding: 0.35rem 0.85rem;
  font-size: 0.8rem;
  color: #bbb;
  background: #141414;
  border-bottom: 1px solid #2a2a2a;
}

.yagoo-analysis-app__drop {
  color: #0082f0;
}

.yagoo-analysis-app__board {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
