<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { CandidateSnapshot, GroupSnapshot } from "../analysis/types";
import { useGame } from "../composables/useGame";
import Goban from "../goban/Goban.vue";
import OverlayLayer from "../overlays/OverlayLayer.vue";
import type { OverlayData } from "../overlays/OverlayRenderer";
import type {
  BoardMap,
  GhostStone,
  HeatVertex,
  LineMarker,
  Marker,
  Sign,
  Vertex,
} from "../types";
import BottomBar from "./BottomBar.vue";
import CandidatesPanel from "./CandidatesPanel.vue";
import CommentBox from "./CommentBox.vue";
import GroupsPanel from "./GroupsPanel.vue";
import WinrateGraph, { type WinratePoint } from "./WinrateGraph.vue";
import "./styles/reviewer.css";

export type GroupOutlineProp = {
  vertices: Vertex[];
  color?: string;
  strokeWidth?: number;
  dasharray?: string;
  groupId?: string;
};

const props = withDefaults(
  defineProps<{
    sgf?: string;
    winrateData?: WinratePoint[];
    /**
     * Fixed vertex size in px. When omitted, size is computed from the board
     * container via ResizeObserver (Sabaki-style fill).
     */
    vertexSize?: number;
    showCoordinates?: boolean;
    fuzzyStonePlacement?: boolean;
    animateStonePlacement?: boolean;
    fuzzySeed?: number;
    /** @deprecated Prefer `groupOutlines` (块). Kept for the docs demo page. */
    demoGroupOutline?: Vertex[];
    /** Teaching group (块) outlines — distinct from chains (串). */
    groupOutlines?: GroupOutlineProp[];
    heatMap?: BoardMap<HeatVertex | null>;
    paintMap?: BoardMap<number>;
    ghostStoneMap?: BoardMap<GhostStone | null>;
    markerMap?: BoardMap<Marker | null>;
    lines?: LineMarker[];
    selectedVertices?: Vertex[];
    dimmedVertices?: Vertex[];
    /** Override the SGF node comment (e.g. live analysis text). */
    commentOverride?: string | null;
    commentTitle?: string;
    /** Analysis candidates for the current ply (sidebar panel). */
    candidates?: CandidateSnapshot[];
    /** Root visits for Sabaki-like dimming of low-visit candidates. */
    rootVisits?: number | null;
    previewCandidateIndex?: number | null;
    selectedCandidateIndex?: number;
    /** Teaching groups (块) for the current ply. */
    groups?: GroupSnapshot[];
    previewGroupId?: string | null;
    selectedGroupId?: string | null;
  }>(),
  {
    showCoordinates: true,
    fuzzyStonePlacement: true,
    animateStonePlacement: true,
    fuzzySeed: 42,
    demoGroupOutline: () => [],
    groupOutlines: () => [],
    winrateData: () => [],
    lines: () => [],
    selectedVertices: () => [],
    dimmedVertices: () => [],
    commentOverride: null,
    commentTitle: "Comment",
    candidates: () => [],
    rootVisits: null,
    previewCandidateIndex: null,
    selectedCandidateIndex: 0,
    groups: () => [],
    previewGroupId: null,
    selectedGroupId: null,
  },
);

const emit = defineEmits<{
  (e: "ply-change", ply: number): void;
  (e: "select-ply", ply: number): void;
  (e: "vertex-mouseenter", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-mouseleave", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-click", evt: MouseEvent, vertex: Vertex): void;
  (e: "preview-candidate", index: number): void;
  (e: "clear-preview"): void;
  (e: "toggle-candidate", index: number): void;
  (e: "select-candidate", index: number): void;
  (e: "preview-group", groupId: string): void;
  (e: "clear-group-preview"): void;
  (e: "select-group", groupId: string): void;
}>();

const {
  signMap,
  boardSize,
  currentPlayer,
  players,
  comment,
  moveNumber,
  loadSgf,
  goForward,
  goBack,
  goToPly,
  goToVariation,
  canGoForward,
  canGoBack,
  variationCount,
} = useGame();

const loaded = ref(false);
const mainEl = ref<HTMLElement | null>(null);
const autoVertexSize = ref(22);
let resizeObserver: ResizeObserver | null = null;

function load(contents: string | undefined) {
  if (!contents) return;
  loadSgf(contents);
  loaded.value = true;
  emit("ply-change", moveNumber.value);
  void nextTick(() => updateAutoVertexSize());
}

/**
 * Fit the goban into the main pane (width × height), leaving a small margin
 * and room for coordinate labels — same idea as Sabaki's board sizing.
 */
function updateAutoVertexSize() {
  if (props.vertexSize != null) return;
  const el = mainEl.value;
  if (el == null) return;
  const size = Math.max(2, boardSize.value);
  const coordExtra = props.showCoordinates ? 1.35 : 0.4;
  const marginPx = 24;
  const availW = Math.max(0, el.clientWidth - marginPx);
  const availH = Math.max(0, el.clientHeight - marginPx);
  const avail = Math.min(availW, availH);
  if (avail <= 0) return;
  const vs = Math.floor(avail / (size + coordExtra));
  autoVertexSize.value = Math.max(12, Math.min(40, vs));
}

const effectiveVertexSize = computed(
  () => props.vertexSize ?? autoVertexSize.value,
);

onMounted(() => {
  load(props.sgf);
  if (typeof ResizeObserver !== "undefined" && mainEl.value) {
    resizeObserver = new ResizeObserver(() => updateAutoVertexSize());
    resizeObserver.observe(mainEl.value);
  }
  updateAutoVertexSize();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

watch(
  () => props.sgf,
  (next) => {
    if (next) load(next);
  },
);

watch(boardSize, () => updateAutoVertexSize());
watch(moveNumber, (n) => emit("ply-change", n));

const overlayData = computed<OverlayData>(() => {
  if (props.groupOutlines.length > 0) {
    return { groupOutlines: props.groupOutlines };
  }
  // Legacy demo prop (docs ReviewerDemo).
  if (props.demoGroupOutline.length > 0) {
    return {
      groupOutlines: [
        { vertices: props.demoGroupOutline, color: "#0082F0" },
      ],
    };
  }
  return { groupOutlines: [] };
});

const emptySignMap = computed<BoardMap<Sign>>(() => {
  const n = boardSize.value;
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0 as Sign),
  );
});

const displaySignMap = computed(() =>
  loaded.value ? signMap.value : emptySignMap.value,
);

const displayComment = computed(
  () => props.commentOverride ?? comment.value,
);

function onBack() {
  goBack();
}

function onForward() {
  goForward();
}

function onSelectPly(ply: number) {
  goToPly(ply);
  emit("select-ply", ply);
}

defineExpose({
  boardSize,
  moveNumber,
  goToPly,
  goForward,
  goBack,
  loadSgf: load,
  effectiveVertexSize,
});
</script>

<template>
  <div class="yagoo-reviewer">
    <main ref="mainEl" class="yagoo-reviewer__main">
      <div class="yagoo-reviewer__board-wrap">
        <Goban
          :sign-map="displaySignMap"
          :heat-map="heatMap"
          :paint-map="paintMap"
          :ghost-stone-map="ghostStoneMap"
          :marker-map="markerMap"
          :lines="lines"
          :selected-vertices="selectedVertices"
          :dimmed-vertices="dimmedVertices"
          :vertex-size="effectiveVertexSize"
          :show-coordinates="showCoordinates"
          :fuzzy-stone-placement="fuzzyStonePlacement"
          :animate-stone-placement="animateStonePlacement"
          :fuzzy-seed="fuzzySeed"
          @vertex-mouseenter="(evt, v) => emit('vertex-mouseenter', evt, v)"
          @vertex-mouseleave="(evt, v) => emit('vertex-mouseleave', evt, v)"
          @vertex-click="(evt, v) => emit('vertex-click', evt, v)"
        >
          <OverlayLayer
            :vertex-size="effectiveVertexSize"
            :width="boardSize"
            :height="boardSize"
            :data="overlayData"
          />
        </Goban>
      </div>
    </main>

    <aside class="yagoo-reviewer__sidebar">
      <WinrateGraph
        :data="winrateData"
        :current-index="moveNumber"
        :height="140"
        :show-score-lead="true"
        @select="onSelectPly"
      />
      <CandidatesPanel
        :candidates="candidates"
        :root-visits="rootVisits"
        :preview-index="previewCandidateIndex"
        :selected-index="selectedCandidateIndex"
        @preview="(i) => emit('preview-candidate', i)"
        @clear-preview="emit('clear-preview')"
        @toggle="(i) => emit('toggle-candidate', i)"
        @select="(i) => emit('select-candidate', i)"
      />
      <GroupsPanel
        :groups="groups"
        :preview-id="previewGroupId"
        :selected-id="selectedGroupId"
        @preview="(id) => emit('preview-group', id)"
        @clear-preview="emit('clear-group-preview')"
        @select="(id) => emit('select-group', id)"
      />
      <div class="yagoo-gametree-placeholder">
        Game tree panel — placeholder (out of scope for MVP).
        <div v-if="variationCount > 1">
          Variations at this node: {{ variationCount }}
          <button
            v-for="i in variationCount"
            :key="i"
            type="button"
            @click="goToVariation(i - 1)"
          >
            {{ i }}
          </button>
        </div>
      </div>
      <CommentBox :title="commentTitle" :comment="displayComment" />
    </aside>

    <BottomBar
      class="yagoo-reviewer__bar"
      :players="players"
      :current-player="currentPlayer"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :move-number="moveNumber"
      @back="onBack"
      @forward="onForward"
    />
  </div>
</template>
