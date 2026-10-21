<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  type BrowserEngineAdapter,
  type PositionSourceFactory,
  buildGroupOutlines,
  buildGroupVertexIndex,
  createBrowserEngineSource,
  createLiveNativeSource,
  createNdjsonTextSource,
  dimVerticesOutsideGroup,
  groupMemberVertices,
  isBrowserEngineAvailable,
  isLiveNativeAvailable,
  matchSgfOpening,
  parseGtpVertex,
  resolveSgfRules,
  useAnalysisStream,
} from "../analysis";
import { getSgfRootError } from "../composables/useGame";
import EngineSourcePanel from "../reviewer/EngineSourcePanel.vue";
import { keyMovesFromState } from "../reviewer/keyMoves";
import type { InspectorPerspective } from "../reviewer/MoveInspector.vue";
import OpeningBadge from "../reviewer/OpeningBadge.vue";
import { buildCommentaryFacts, resolveCommentary, type CommentaryInput, type CommentaryOrigin, type GroundedCommentary } from "../commentary/facts";
import type { CommentaryProvider } from "../commentary/session";
import { buildReviewReport } from "../report";
import type {
  BoardMap,
  GhostStone,
  HeatVertex,
  LineMarker,
  Marker,
  Vertex,
} from "../types";
import { messageRef, presentError, presentSource, storeLocale, useYagooI18n, type YagooLocale } from "../i18n";
import ReviewerLayout from "./ReviewerLayout.vue";
import "./styles/reviewer.css";

const props = defineProps<{
  /** Initial / bundled sample SGF. */
  initialSgf?: string;
  /** Initial / bundled NDJSON analysis (loaded progressively). */
  initialNdjson?: string;
  /** Provenance limitation shown only while using the initial recording. */
  initialAnalysisNotice?: string;
  /**
   * Optional fixed stone size. When omitted, `ReviewerLayout` sizes the board
   * from its container via ResizeObserver (fills available area).
   */
  vertexSize?: number;
  /** Force a theme. `auto` follows VitePress (`html.dark`) and these tokens. */
  theme?: "auto" | "light" | "dark";
  initialPerspective?: InspectorPerspective;
  /** Optional host-supplied adapter. Never called until explicit opt-in/action. */
  commentaryProvider?: CommentaryProvider | null;
  /** Set after a local bundle (or a configured remote URL) is staged. */
  browserEngine?: BrowserEngineAdapter | null;
  threadHint?: string | null;
  remoteManifestUrl?: string | null;
  modelStatus?: string | null;
  /** Explicit locale (`?lang=`, tests). Wins over storage and the host locale. */
  locale?: string | null;
  /** VitePress site locale, used only when the docs site configures locales. */
  hostLocale?: string | null;
}>();

const emit = defineEmits<{
  (e: "local-model-files", files: File[]): void;
  (e: "enable-threads"): void;
  (e: "load-remote-manifest"): void;
}>();

function parseBoardSize(sgf: string): number {
  const n = Number.parseInt(/SZ\[(\d+)/i.exec(sgf)?.[1] ?? "19", 10);
  return Number.isFinite(n) && n >= 2 ? n : 19;
}

const { t, locale } = useYagooI18n({ explicit: props.locale, host: props.hostLocale });

function toggleLocale() {
  const next: YagooLocale = locale.value === "zh-CN" ? "en" : "zh-CN";
  locale.value = next;
  storeLocale(next);
}

const sgfLoadError = ref(getSgfRootError(props.initialSgf?.trim() ? props.initialSgf : "(;)"));
const hasAcceptedSgf = ref(sgfLoadError.value == null);
const sgfText = ref(hasAcceptedSgf.value ? props.initialSgf ?? "" : "");
// Local SGF recognition is independent of engine/model availability and cannot
// inherit a label from an analysis file belonging to a different loaded game.
const sgfOpening = computed(() => matchSgfOpening(sgfText.value));
const rulesLabel = computed(() => resolveSgfRules(sgfText.value));
const boardSizeFromSgf = computed(() => parseBoardSize(sgfText.value));
const dragOver = ref(false);
const sourceOpen = ref(false);
const nativeUrl = ref("http://127.0.0.1:8710/analyze");
const activeNative = ref(false);
const variationActive = ref(false);
const sourceGeneration = ref(0);
const statusMessage = ref("");
const stoppedByUser = ref(false);
const selectedCandidate = ref(0);
const reviewer = ref<InstanceType<typeof ReviewerLayout> | null>(null);
const chosenSource = ref<"recorded" | "browser" | "native" | null>(null);
let fileGeneration = 0;
const currentPly = ref(0);
/** Hover / panel preview index (cleared on leave unless touch-pinned). */
const previewCandidate = ref<number | null>(null);
/** Touch tap-to-toggle pin; survives mouseleave until toggled off or ply change. */
const pinnedPreview = ref<number | null>(null);
/** Hovered / selected teaching group (块). */
const previewGroupId = ref<string | null>(null);
const pinnedGroupId = ref<string | null>(null);
const selectedGroupId = ref<string | null>(null);

const {
  state,
  gameGeneration,
  series,
  sourceLabel,
  isStreaming,
  reset: resetStream,
  attachSource,
  stop,
  overlaysFor,
  commentFor,
} = useAnalysisStream();

// A loaded SGF is authoritative, including no unique local match. Only an
// analysis-only review may use the stream's opening label.
const effectiveOpening = computed(() => sgfText.value ? sgfOpening.value : state.value.opening);

function reset() {
  stoppedByUser.value = false;
  statusMessage.value = "";
  resetStream();
}

function resetForSgf() {
  reset();
  // Recordings belong to one game; an explicit live engine choice remains until
  // the user changes it. Loading an SGF still waits for Review before sending it.
  if (chosenSource.value === "recorded") chosenSource.value = null;
}

function replaceSgf(text: string): boolean {
  sgfLoadError.value = getSgfRootError(text.trim() ? text : "(;)");
  if (sgfLoadError.value) return false;
  resetForSgf();
  sgfText.value = text;
  hasAcceptedSgf.value = true;
  return true;
}

function stopAnalysis() {
  stop();
  stoppedByUser.value = true;
  statusMessage.value = messageRef("status.stopped");
}

const emptyHeat = computed<BoardMap<HeatVertex | null>>(() => []);
const heatMap = ref<BoardMap<HeatVertex | null>>([]);
const paintMap = ref<BoardMap<number>>([]);
const ghostStoneMap = ref<BoardMap<GhostStone | null>>([]);
const markerMap = ref<BoardMap<Marker | null>>([]);
const lines = ref<LineMarker[]>([]);

const activePreview = computed(() => {
  if (pinnedPreview.value != null) return pinnedPreview.value;
  return previewCandidate.value;
});

const activeGroupId = computed(() => {
  if (pinnedGroupId.value != null) return pinnedGroupId.value;
  return previewGroupId.value ?? selectedGroupId.value;
});

const currentCandidates = computed(
  () => state.value.plies[currentPly.value]?.candidates ?? [],
);

const currentRootVisits = computed(
  () => state.value.plies[currentPly.value]?.root?.visits ?? null,
);

const currentGroups = computed(
  () => state.value.plies[currentPly.value]?.groups ?? [],
);

/** Map board vertex → candidate index for the current ply. */
const candidateVertexIndex = computed(() => {
  const size = state.value.size ?? boardSizeFromSgf.value;
  const map = new Map<string, number>();
  currentCandidates.value.forEach((c, idx) => {
    const v = parseGtpVertex(c.move, size);
    if (v == null) return;
    map.set(`${v[0]},${v[1]}`, idx);
  });
  return map;
});

const groupVertexIndex = computed(() => {
  const size = state.value.size ?? boardSizeFromSgf.value;
  return buildGroupVertexIndex(currentGroups.value, size);
});

const groupOutlines = computed(() => {
  const size = state.value.size ?? boardSizeFromSgf.value;
  return buildGroupOutlines(currentGroups.value, size, activeGroupId.value);
});

const dimmedVertices = computed(() => {
  const size = state.value.size ?? boardSizeFromSgf.value;
  const focus = currentGroups.value.find(
    (g) => g.groupId === activeGroupId.value,
  );
  return dimVerticesOutsideGroup(focus, size);
});

const selectedVertices = computed(() => {
  const size = state.value.size ?? boardSizeFromSgf.value;
  const focus = currentGroups.value.find(
    (g) => g.groupId === activeGroupId.value,
  );
  if (focus == null) return [] as Vertex[];
  return groupMemberVertices(focus, size);
});

function refreshOverlays() {
  const size = state.value.size ?? boardSizeFromSgf.value;
  const overlays = overlaysFor(currentPly.value, size, {
    selectedCandidate: selectedCandidate.value,
    previewCandidate: activePreview.value,
  });
  heatMap.value = overlays.heatMap;
  paintMap.value = overlays.paintMap;
  ghostStoneMap.value = overlays.ghostStoneMap;
  markerMap.value = overlays.markerMap;
  lines.value = overlays.lines;
}

watch(
  [() => state.value, currentPly, selectedCandidate, activePreview, locale],
  refreshOverlays,
  { deep: true },
);

watch(currentPly, () => {
  previewCandidate.value = null;
  pinnedPreview.value = null;
  selectedCandidate.value = 0;
  previewGroupId.value = null;
  pinnedGroupId.value = null;
  selectedGroupId.value = null;
});

watch(
  () => state.value.status,
  (status) => {
    if (status === "completed" && sourceLabel.value) {
      statusMessage.value = messageRef("status.loaded", { label: sourceLabel.value });
    } else if (status === "error" && state.value.lastError) {
      statusMessage.value = state.value.lastError;
    }
  },
);

const analysisComment = computed(() =>
  commentFor(currentPly.value, /* sgf comment merged inside */ ""),
);

const keyMoves = computed(() => keyMovesFromState(state.value));
const reviewReport = computed(() => buildReviewReport(state.value, {
  sgf: sgfText.value, source: sourceLabel.value,
}));
const currentPlyAnalysis = computed(
  () => state.value.plies[currentPly.value] ?? null,
);
const commentaryInput = computed<CommentaryInput>(() => ({
  ply: currentPly.value,
  toPlay: currentPlyAnalysis.value?.toPlay,
  root: currentPlyAnalysis.value?.root,
  candidates: currentPlyAnalysis.value?.candidates,
  groups: currentPlyAnalysis.value?.groups,
  ledger: currentPlyAnalysis.value?.ledger,
  comparison: currentPlyAnalysis.value?.comparison,
  sacrifices: currentPlyAnalysis.value?.sacrifices,
  opening: effectiveOpening.value,
}));
// Kept inside the reviewer; this context key is never in the provider packet.
const commentaryContextKey = computed(() => `${gameGeneration.value}:${sgfText.value}`);
function saveCommentary(result: GroundedCommentary | null, origin: CommentaryOrigin) {
  // Hiding/disposing the panel is not an edit to the main-line record.
  if (!result || variationActive.value) return;
  if (origin.contextKey !== commentaryContextKey.value || origin.ply !== currentPly.value) return;
  if (resolveCommentary(buildCommentaryFacts(commentaryInput.value), result).fallbackReason) return;
  const ply = state.value.plies[currentPly.value];
  if (!ply || JSON.stringify(ply.commentary) === JSON.stringify(result)) return;
  state.value = {
    ...state.value,
    plies: { ...state.value.plies, [currentPly.value]: { ...ply, commentary: result } },
  };
}
const themeClass = computed(() =>
  props.theme === "dark"
    ? "yagoo-theme-dark"
    : props.theme === "light"
      ? "yagoo-theme-light"
      : "",
);

const liveAvailable = isLiveNativeAvailable();
const browserAvailable = computed(() =>
  isBrowserEngineAvailable(props.browserEngine),
);
const positionSource = computed<PositionSourceFactory | null>(() => {
  if (!hasAcceptedSgf.value) return null;
  // Explicit reconnects must restart the selected position even for the same engine.
  void sourceGeneration.value;
  if (activeNative.value) {
    const url = nativeUrl.value;
    return ({ sgf, ...position }) => createLiveNativeSource({ url, sgf, position });
  }
  const engine = props.browserEngine;
  if (!engine?.analyzePosition) return null;
  return ({ sgf, ...position }) => createBrowserEngineSource({ engine, sgf, position });
});

onMounted(() => {
  if (props.initialNdjson && hasAcceptedSgf.value) {
    loadNdjsonText(props.initialNdjson, "bundled sample analysis");
  } else {
    refreshOverlays();
  }
});
onBeforeUnmount(() => { fileGeneration++; });

watch(
  () => props.initialSgf,
  (v) => {
    fileGeneration++;
    const nextSgf = v ?? "";
    if (nextSgf !== sgfText.value) {
      replaceSgf(nextSgf);
    } else {
      sgfLoadError.value = null;
      hasAcceptedSgf.value = true;
    }
  },
);

watch(sgfText, () => {
  resetForSgf();
  currentPly.value = 0;
}, { flush: "sync" });

function loadNdjsonText(text: string, label: string) {
  fileGeneration++;
  // Cancel the position request before changing adapters or attaching the file.
  // Otherwise a queued source watcher can restart Try and stop the new stream.
  reviewer.value?.leaveVariation();
  activeNative.value = false;
  reset();
  chosenSource.value = "recorded";
  statusMessage.value = messageRef("status.loading", { label });
  attachSource(
    createNdjsonTextSource(text, {
      progressive: true,
      batchSize: 3,
      label,
    }),
  );
  statusMessage.value = messageRef("status.streaming", { label });
}

async function onSgfFile(file: File): Promise<boolean> {
  const generation = ++fileGeneration;
  const text = await file.text();
  if (generation !== fileGeneration || !replaceSgf(text)) return false;
  statusMessage.value = messageRef("status.loadedSgf", {
    name: file.name,
    rules: resolveSgfRules(text),
  });
  return true;
}

async function onNdjsonFile(file: File) {
  const generation = ++fileGeneration;
  const text = await file.text();
  if (generation !== fileGeneration) return;
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

async function onDrop(ev: DragEvent) {
  ev.preventDefault();
  dragOver.value = false;
  const files = ev.dataTransfer?.files;
  if (!files?.length) return;
  const dropped = Array.from(files);
  const sgfFile = dropped.find((f) => /\.sgf(?:\.txt)?$/i.test(f.name));
  const analysisFile = dropped.find((f) => /\.(ndjson|jsonl|json)$/i.test(f.name));
  if (!sgfFile && !analysisFile) return;
  const generation = ++fileGeneration;
  const [sgfContents, analysisContents] = await Promise.all([
    sgfFile?.text(), analysisFile?.text(),
  ]);
  if (generation !== fileGeneration) return;
  if (sgfContents !== undefined) {
    if (!replaceSgf(sgfContents)) return;
  }
  if (analysisContents !== undefined) loadNdjsonText(analysisContents, analysisFile!.name);
}

function tryLiveNative(url = nativeUrl.value) {
  if (!hasAcceptedSgf.value) return;
  fileGeneration++;
  sourceGeneration.value++;
  chosenSource.value = "native";
  nativeUrl.value = url;
  activeNative.value = true;
  if (variationActive.value) {
    statusMessage.value = messageRef("status.variationNative");
    return;
  }
  reset();
  statusMessage.value = messageRef("status.connectingNative");
  attachSource(createLiveNativeSource({ url, sgf: sgfText.value }));
}

function tryBrowserEngine() {
  if (!hasAcceptedSgf.value) return;
  if (!props.browserEngine) {
    statusMessage.value = messageRef("status.needModel");
    return;
  }
  sourceGeneration.value++;
  activeNative.value = false;
  fileGeneration++;
  chosenSource.value = "browser";
  if (variationActive.value && props.browserEngine.analyzePosition) {
    statusMessage.value = messageRef("status.variationBrowser");
    return;
  }
  reset();
  statusMessage.value = messageRef("status.startingBrowser");
  attachSource(
    createBrowserEngineSource({
      engine: props.browserEngine,
      sgf: sgfText.value,
      label: "Browser engine (experimental)",
    }),
  );
}

function reviewGame() {
  if (isStreaming.value || chosenSource.value === "recorded") {
    reviewer.value?.openReport();
    return;
  }
  if (!sgfText.value.trim()) {
    statusMessage.value = messageRef("status.needSgf");
    return;
  }
  if (chosenSource.value === "native" && liveAvailable) {
    reviewer.value?.prepareReview();
    tryLiveNative();
  } else if (props.browserEngine && chosenSource.value !== "native") {
    reviewer.value?.prepareReview();
    tryBrowserEngine();
  } else {
    sourceOpen.value = true;
    statusMessage.value = messageRef("status.chooseEngine");
    return;
  }
}

function onPlyChange(ply: number) {
  currentPly.value = ply;
}

function setPreview(index: number) {
  previewCandidate.value = index;
}

function clearPreview() {
  // Keep board preview while touch-pinned.
  if (pinnedPreview.value != null) return;
  previewCandidate.value = null;
}

function togglePreview(index: number) {
  if (pinnedPreview.value === index) {
    pinnedPreview.value = null;
    previewCandidate.value = null;
  } else {
    pinnedPreview.value = index;
    previewCandidate.value = index;
    selectedCandidate.value = index;
  }
}

function setGroupPreview(groupId: string) {
  previewGroupId.value = groupId;
}

function clearGroupPreview() {
  if (pinnedGroupId.value != null) return;
  previewGroupId.value = null;
}

function selectGroup(groupId: string) {
  if (selectedGroupId.value === groupId && pinnedGroupId.value === groupId) {
    selectedGroupId.value = null;
    pinnedGroupId.value = null;
    previewGroupId.value = null;
    return;
  }
  selectedGroupId.value = groupId;
  pinnedGroupId.value = groupId;
  previewGroupId.value = groupId;
}

function onVertexMouseEnter(_evt: MouseEvent, vertex: Vertex) {
  const key = `${vertex[0]},${vertex[1]}`;
  const idx = candidateVertexIndex.value.get(key);
  if (idx != null) {
    setPreview(idx);
    return;
  }
  const gid = groupVertexIndex.value.get(key);
  if (gid != null) setGroupPreview(gid);
}

function onVertexMouseLeave(_evt: MouseEvent, _vertex: Vertex) {
  clearPreview();
  clearGroupPreview();
}

function onVertexClick(evt: MouseEvent, vertex: Vertex) {
  const key = `${vertex[0]},${vertex[1]}`;
  const idx = candidateVertexIndex.value.get(key);
  if (idx != null) {
    const isTouch =
      evt.detail === 0 ||
      ("pointerType" in evt &&
        (evt as PointerEvent).pointerType === "touch") ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(pointer: coarse)")?.matches);
    if (isTouch || evt.detail >= 1) {
      togglePreview(idx);
    }
    return;
  }
  const gid = groupVertexIndex.value.get(key);
  if (gid != null) selectGroup(gid);
}

const phaseBadge = computed(() => {
  const s = state.value;
  if (s.status === "error") return t("phase.error", { message: presentError(s.lastError ?? "?") });
  if (stoppedByUser.value) return t("phase.stopped", { count: s.eventCount });
  if (s.currentPhase) {
    const named = t(`phase.name.${s.currentPhase}`);
    const phase = named === `phase.name.${s.currentPhase}` ? s.currentPhase : named;
    return t("phase.active", {
      phase,
      ply: s.activePly ?? "—",
      count: s.eventCount,
    });
  }
  if (s.status === "completed") {
    return t("phase.complete", {
      count: s.eventCount,
      deep: s.deepPlies.join(",") || "—",
    });
  }
  if (isStreaming.value) return t("phase.streaming", { count: s.eventCount });
  return t("phase.idle");
});
</script>

<template>
  <div
    class="yagoo-analysis-app"
    :class="[themeClass, { 'yagoo-analysis-app--drag': dragOver }]"
    @dragenter.prevent="dragOver = true"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop="onDrop"
  >
    <header class="yagoo-analysis-app__toolbar">
      <div class="yagoo-analysis-app__brand">Yagoo</div>
      <OpeningBadge :match="effectiveOpening" />
      <div class="yagoo-analysis-app__meta">
        <span>{{ t("toolbar.rules", { rules: rulesLabel }) }}</span>
        <span v-if="sourceLabel">· {{ presentSource(sourceLabel) }}</span>
        <span>· {{ phaseBadge }}</span>
      </div>
      <div class="yagoo-analysis-app__controls">
        <button type="button" class="yagoo-analysis-app__btn" data-testid="review-game" @click="reviewGame">{{ t("toolbar.review") }}</button>
        <button
          v-if="isStreaming"
          type="button"
          class="yagoo-analysis-app__btn"
          data-testid="stop-analysis"
          @click="stopAnalysis"
        >{{ t("toolbar.stop") }}</button>
        <label class="yagoo-analysis-app__btn">
          {{ t("toolbar.openSgf") }}
          <input
            type="file"
            accept=".sgf,text/plain"
            hidden
            @change="onFileInput('sgf', $event)"
          />
        </label>
        <button
          type="button"
          class="yagoo-analysis-app__btn"
          data-testid="engine-source-button"
          :aria-expanded="sourceOpen"
          @click="sourceOpen = !sourceOpen"
        >
          {{ t("toolbar.engine") }}
        </button>
        <button
          type="button"
          class="yagoo-analysis-app__btn"
          data-testid="locale-toggle"
          :aria-label="t('toolbar.language')"
          @click="toggleLocale"
        >
          {{ locale === "zh-CN" ? t("toolbar.languageToEn") : t("toolbar.languageToZh") }}
        </button>
      </div>
    </header>

    <EngineSourcePanel
      v-if="sourceOpen"
      class="yagoo-analysis-app__source"
      :native-available="liveAvailable"
      :browser-available="browserAvailable"
      :source-label="sourceLabel"
      :thread-hint="threadHint"
      :remote-manifest-url="remoteManifestUrl"
      :model-status="modelStatus"
      :native-url="nativeUrl"
      @close="sourceOpen = false"
      @sgf-file="onSgfFile"
      @ndjson-file="onNdjsonFile"
      @connect-native="tryLiveNative"
      @connect-browser="tryBrowserEngine"
      @local-model-files="emit('local-model-files', $event)"
      @enable-threads="emit('enable-threads')"
      @load-remote-manifest="emit('load-remote-manifest')"
    />

    <p v-if="sgfLoadError" class="yagoo-analysis-app__status" role="alert">
      {{ t("status.sgfError", { message: presentError(sgfLoadError) }) }}
      {{ hasAcceptedSgf ? t("status.sgfUnchanged") : t("status.sgfNeedValid") }}
    </p>
    <p v-if="statusMessage" class="yagoo-analysis-app__status">
      {{ presentError(statusMessage) }}
    </p>
    <p
      v-if="initialAnalysisNotice && sourceLabel === 'bundled sample analysis'"
      class="yagoo-analysis-app__status"
      role="note"
      data-testid="recording-provenance-notice"
    >
      {{ initialAnalysisNotice }}
    </p>
    <p v-if="dragOver" class="yagoo-analysis-app__drop">
      {{ t("toolbar.drop") }}
    </p>

    <div class="yagoo-analysis-app__board">
      <ReviewerLayout
        ref="reviewer"
        :sgf="sgfText"
        :position-source="positionSource"
        @variation-analysis="stop"
        @variation-change="variationActive = $event"
        :winrate-data="series"
        :heat-map="heatMap.length ? heatMap : emptyHeat"
        :paint-map="paintMap"
        :ghost-stone-map="ghostStoneMap"
        :marker-map="markerMap"
        :lines="lines"
        :candidates="currentCandidates"
        :root-visits="currentRootVisits"
        :preview-candidate-index="activePreview"
        :selected-candidate-index="selectedCandidate"
        :groups="currentGroups"
        :preview-group-id="previewGroupId ?? pinnedGroupId"
        :selected-group-id="selectedGroupId"
        :group-outlines="groupOutlines"
        :dimmed-vertices="dimmedVertices"
        :selected-vertices="selectedVertices"
        :comment-override="analysisComment"
        :comment-title="t('comment.analysis')"
        :root-analysis="currentPlyAnalysis?.root ?? null"
        :key-moves="keyMoves"
        :ledger="currentPlyAnalysis?.ledger ?? null"
        :comparison="currentPlyAnalysis?.comparison ?? null"
        :sacrifices="currentPlyAnalysis?.sacrifices ?? null"
        :commentary="currentPlyAnalysis?.commentary ?? null"
        :commentary-input="commentaryInput"
        :commentary-context-key="commentaryContextKey"
        :commentary-provider="commentaryProvider"
        :report-document="reviewReport"
        :initial-perspective="initialPerspective"
        :vertex-size="vertexSize"
        :show-coordinates="true"
        :fuzzy-stone-placement="true"
        :animate-stone-placement="true"
        :fuzzy-seed="42"
        @ply-change="onPlyChange"
        @vertex-mouseenter="onVertexMouseEnter"
        @vertex-mouseleave="onVertexMouseLeave"
        @vertex-click="onVertexClick"
        @preview-candidate="setPreview"
        @clear-preview="clearPreview"
        @toggle-candidate="togglePreview"
        @select-candidate="(i) => (selectedCandidate = i)"
        @preview-group="setGroupPreview"
        @clear-group-preview="clearGroupPreview"
        @select-group="selectGroup"
        @commentary="saveCommentary"
        @cancel-review="stopAnalysis"
      />
    </div>
  </div>
</template>

<style scoped>
.yagoo-analysis-app {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--yagoo-bg, #f6f6f7);
  color: var(--yagoo-text, #1b1b1f);
  font-family: var(--yagoo-font, system-ui, sans-serif);
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
  padding: 0.45rem 0.75rem;
  background: var(--yagoo-panel, #fff);
  border-bottom: 1px solid var(--yagoo-border, #e2e2e6);
  color: var(--yagoo-text, #1b1b1f);
  flex: 0 0 auto;
}

.yagoo-analysis-app__brand {
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--yagoo-text, #1b1b1f);
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
  border: 1px solid var(--yagoo-border, #c8c8d0);
  border-radius: 4px;
  background: var(--yagoo-panel-2, #f3f3f6);
  color: var(--yagoo-text, #1b1b1f);
  font-size: 0.82rem;
  cursor: pointer;
}

.yagoo-analysis-app__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.yagoo-analysis-app__btn:not(:disabled):hover {
  border-color: var(--yagoo-accent, #0082f0);
}

.yagoo-analysis-app__meta {
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--yagoo-muted, #5c5c66);
}

.yagoo-analysis-app__status,
.yagoo-analysis-app__drop {
  margin: 0;
  padding: 0.35rem 0.85rem;
  font-size: 0.8rem;
  color: var(--yagoo-muted, #5c5c66);
  background: var(--yagoo-panel, #fff);
  border-bottom: 1px solid var(--yagoo-border, #e2e2e6);
}

.yagoo-analysis-app .yagoo-analysis-app__source {
  position: absolute;
  top: 3.1rem;
  right: 0.75rem;
  bottom: 0.75rem;
  z-index: 30;
  width: min(28rem, calc(100% - 1.5rem));
  max-height: none;
  overflow: auto;
}

.yagoo-analysis-app__drop {
  color: var(--yagoo-accent, #0082f0);
}

.yagoo-analysis-app__board {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
