<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type {
  GainLossLedger,
  GainLossLine,
  LlmCommentary,
  MoveComparison,
  ReviewReportDocument,
  SacrificeAnnotation,
} from "../analysis/modules";
import type { CandidateSnapshot, EngineAnalysis, GroupSnapshot } from "../analysis/types";
import { formatGtpVertex, parseGtpVertex, ownershipToPaintMap } from "../analysis/coords";
import { comparisonBoard, comparisonMarkers, isAlignedComparison } from "../analysis/comparison";
import { buildGroupOutlines, groupMemberVertices } from "../analysis/groups";
import { useGame, type GamePlayerInfo } from "../composables/useGame";
import Goban from "../goban/Goban.vue";
import OverlayLayer from "../overlays/OverlayLayer.vue";
import type { OverlayData } from "../overlays/OverlayRenderer";
import MoveInspector, {
  type InspectorPerspective,
} from "../reviewer/MoveInspector.vue";
import ReviewReport from "../reviewer/ReviewReport.vue";
import type { KeyMoveRow } from "../reviewer/keyMoves";
import {
  applyTryMoves,
  tryPath,
  type TryNode,
} from "../reviewer/tryBranch";
import VariationTree from "../reviewer/VariationTree.vue";
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
import CommentBox from "./CommentBox.vue";
import GroupsPanel from "./GroupsPanel.vue";
import WinrateGraph, { type WinratePoint } from "./WinrateGraph.vue";
import "./styles/reviewer.css";

defineOptions({ name: "ReviewerLayout" });

export type GroupOutlineProp = {
  vertices: Vertex[];
  color?: string;
  strokeWidth?: number;
  dasharray?: string;
  groupId?: string;
};

type CompactSection = "graph" | "inspector" | "groups" | "tree" | "comment";

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
    /** Root analysis for the move inspector. */
    rootAnalysis?: EngineAnalysis | null;
    previewCandidateIndex?: number | null;
    selectedCandidateIndex?: number;
    /** Teaching groups (块) for the current ply. */
    groups?: GroupSnapshot[];
    previewGroupId?: string | null;
    selectedGroupId?: string | null;
    /** Swing plies from `deepPliesSelected`. */
    keyMoves?: KeyMoveRow[];
    ledger?: GainLossLedger | null;
    comparison?: MoveComparison | null;
    sacrifices?: SacrificeAnnotation[] | null;
    commentary?: LlmCommentary | null;
    reportDocument?: ReviewReportDocument | null;
    initialPerspective?: InspectorPerspective;
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
    rootAnalysis: null,
    previewCandidateIndex: null,
    selectedCandidateIndex: 0,
    groups: () => [],
    previewGroupId: null,
    selectedGroupId: null,
    keyMoves: () => [],
    ledger: null,
    comparison: null,
    sacrifices: null,
    commentary: null,
    reportDocument: null,
    initialPerspective: "ai",
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
  onMainLine,
  children,
  loadSgf,
  goForward,
  goBack,
  goToPly,
  goToVariation,
  canGoForward,
  canGoBack,
} = useGame();

const loaded = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const mainEl = ref<HTMLElement | null>(null);
const autoVertexSize = ref(22);
const sidebarWidth = ref(420);
const sidebarUserSized = ref(false);
const compact = ref(false);
const section = ref<CompactSection>("inspector");
const lowerTab = ref<"groups" | "tree">("groups");
const view = ref<"board" | "report">("board");
const tryMode = ref(false);
const ledgerPreview = ref<Vertex[] | null>(null);
const inspectorPerspective = ref<InspectorPerspective>(props.initialPerspective);
const comparisonDifference = ref(true);
const tryNodes = ref<TryNode[]>([]);
const tryCursor = ref<string | null>(null);
const anchorSign = ref<BoardMap<Sign>>([]);
const anchorPlayer = ref<Sign>(1);
let trySeq = 0;
let resizeObserver: ResizeObserver | null = null;

const sections: { id: CompactSection; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "inspector", label: "Move" },
  { id: "groups", label: "Groups" },
  { id: "tree", label: "Tree" },
  { id: "comment", label: "Notes" },
];

function load(contents: string | undefined) {
  if (!contents) return;
  ledgerPreview.value = null;
  tryMode.value = false;
  clearTry();
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

const SIDEBAR_MIN = 340;
const SIDEBAR_MAX = 560;

function preferredSidebar(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(380, Math.round(width * 0.36)));
}

function updateCompact() {
  const width = rootEl.value?.clientWidth ?? 0;
  // Width 0 means the test environment has not laid the page out.
  compact.value = width > 0 && width < 960;
  if (!compact.value && width > 0 && !sidebarUserSized.value) {
    sidebarWidth.value = preferredSidebar(width);
  }
}

const effectiveVertexSize = computed(
  () => props.vertexSize ?? autoVertexSize.value,
);

onMounted(() => {
  load(props.sgf);
  if (typeof ResizeObserver !== "undefined" && rootEl.value) {
    resizeObserver = new ResizeObserver(() => {
      updateAutoVertexSize();
      updateCompact();
    });
    resizeObserver.observe(rootEl.value);
    if (mainEl.value) resizeObserver.observe(mainEl.value);
  }
  updateAutoVertexSize();
  updateCompact();
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
watch(moveNumber, (n) => {
  ledgerPreview.value = null;
  emit("ply-change", n);
  if (tryMode.value) captureAnchor();
});

const sortedKeys = computed(() =>
  [...props.keyMoves].sort((a, b) => a.ply - b.ply),
);

const keyIndex = computed(() =>
  sortedKeys.value.findIndex((row) => row.ply === moveNumber.value),
);

const tryDepth = computed(() =>
  tryMode.value ? tryPath(tryNodes.value, tryCursor.value).length : 0,
);

const suspendAnalysis = computed(
  () => tryDepth.value > 0 || (loaded.value && !onMainLine.value),
);
watch([() => props.ledger, () => props.comparison, suspendAnalysis, inspectorPerspective], () => {
  ledgerPreview.value = null;
});
watch(() => props.initialPerspective, (value) => { inspectorPerspective.value = value; });

const alignedComparison = computed(() =>
  !suspendAnalysis.value && !tryMode.value
    && isAlignedComparison(props.comparison, moveNumber.value, boardSize.value)
    ? props.comparison : null,
);
const activeComparison = computed(() =>
  ["why", "sacrifice"].includes(inspectorPerspective.value) ? alignedComparison.value : null,
);
const displayedGroups = computed(() => activeComparison.value?.context.groups ?? props.groups);

function previewLedger(line: GainLossLine) {
  previewStones(line.intersections);
}

function previewStones(stones: string[]) {
  ledgerPreview.value = stones
    .map((coordinate) => parseGtpVertex(coordinate, boardSize.value))
    .filter((vertex): vertex is Vertex => vertex != null);
}

function previewDisplayedGroup(id: string) {
  if (!activeComparison.value) { emit("preview-group", id); return; }
  const group = displayedGroups.value.find((entry) => entry.groupId === id);
  ledgerPreview.value = group ? groupMemberVertices(group, boardSize.value) : null;
}
function clearDisplayedGroup() {
  ledgerPreview.value = null;
  emit("clear-group-preview");
}
function selectDisplayedGroup(id: string) {
  if (activeComparison.value) previewDisplayedGroup(id);
  else emit("select-group", id);
}

const overlayData = computed<OverlayData>(() => {
  if (suspendAnalysis.value) return { groupOutlines: [] };
  if (activeComparison.value) return {
    groupOutlines: buildGroupOutlines(activeComparison.value.context.groups, boardSize.value),
  };
  if (props.groupOutlines.length > 0) {
    return { groupOutlines: props.groupOutlines };
  }
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

const tryPosition = computed(() => {
  if (!tryMode.value) return null;
  const path = tryPath(tryNodes.value, tryCursor.value);
  return applyTryMoves(
    boardSize.value,
    anchorSign.value,
    anchorPlayer.value,
    path.map((node) => node.vertex),
  );
});

const displaySignMap = computed(() => {
  if (tryPosition.value) return tryPosition.value.signMap;
  if (activeComparison.value) return comparisonBoard(activeComparison.value);
  return loaded.value ? signMap.value : emptySignMap.value;
});

const displayPlayer = computed(
  () => tryPosition.value?.toPlay
    ?? (activeComparison.value ? (activeComparison.value.mover === "B" ? 1 : -1) : currentPlayer.value),
);

const displayPlayers = computed<[GamePlayerInfo, GamePlayerInfo]>(() => {
  const extra = tryPosition.value?.captures;
  if (extra == null) return players.value;
  const [black, white] = players.value;
  return [
    { ...black, captures: black.captures + extra.black },
    { ...white, captures: white.captures + extra.white },
  ];
});

const tryHasChild = computed(() =>
  tryNodes.value.some((node) => node.parentId === tryCursor.value),
);

const canStepBack = computed(
  () => (tryMode.value && tryCursor.value != null) || canGoBack.value,
);

const canStepForward = computed(() =>
  tryMode.value ? tryHasChild.value : canGoForward.value,
);

const displayComment = computed(() => {
  if (activeComparison.value) {
    const comparison = activeComparison.value;
    return `Move ${comparison.ply}: ${comparison.actualMove} versus ${comparison.aiMove}, evaluated at root ply ${comparison.rootPly}. The board shows the position before this move.`;
  }
  if (tryDepth.value > 0) {
    return "This variation is not analyzed.\nAI suggestions for tried moves — Coming in #26.";
  }
  if (loaded.value && !onMainLine.value) {
    return "This SGF variation is not on the analyzed main line.\nAI suggestions for tried moves — Coming in #26.";
  }
  return props.commentOverride ?? comment.value;
});

const boardHeat = computed(() =>
  suspendAnalysis.value || activeComparison.value ? [] : (props.heatMap ?? []),
);
const boardPaint = computed(() => {
  if (suspendAnalysis.value) return [];
  if (activeComparison.value) return inspectorPerspective.value === "why" && comparisonDifference.value
    ? ownershipToPaintMap(activeComparison.value.ownershipDelta.map((value) => value / 2), boardSize.value, 0.04)
    : [];
  return props.paintMap ?? [];
});
const boardGhosts = computed(() =>
  suspendAnalysis.value || activeComparison.value ? [] : (props.ghostStoneMap ?? []),
);
const boardMarkers = computed(() =>
  suspendAnalysis.value ? []
    : activeComparison.value ? comparisonMarkers(activeComparison.value) : (props.markerMap ?? []),
);
const boardLines = computed(() =>
  suspendAnalysis.value || activeComparison.value ? [] : props.lines,
);
const boardDimmed = computed(() => {
  if (suspendAnalysis.value) return [];
  if (ledgerPreview.value == null) return activeComparison.value ? [] : props.dimmedVertices;
  const included = new Set(ledgerPreview.value.map(([x, y]) => `${x},${y}`));
  const dimmed: Vertex[] = [];
  for (let y = 0; y < boardSize.value; y += 1) {
    for (let x = 0; x < boardSize.value; x += 1) {
      if (!included.has(`${x},${y}`)) dimmed.push([x, y]);
    }
  }
  return dimmed;
});
const boardSelected = computed(() =>
  suspendAnalysis.value ? [] : (ledgerPreview.value ?? (activeComparison.value ? [] : props.selectedVertices)),
);

function clearTry() {
  tryNodes.value = [];
  tryCursor.value = null;
}

function captureAnchor() {
  anchorSign.value = signMap.value.map((row) => [...row]);
  anchorPlayer.value = currentPlayer.value;
  clearTry();
}

function toggleTry() {
  tryMode.value = !tryMode.value;
  view.value = "board";
  if (tryMode.value) {
    captureAnchor();
    lowerTab.value = "tree";
    section.value = "tree";
  } else {
    clearTry();
  }
}

function playAt(vertex: Vertex): boolean {
  if (!tryMode.value) return false;
  const path = tryPath(tryNodes.value, tryCursor.value);
  const played = applyTryMoves(
    boardSize.value,
    anchorSign.value,
    anchorPlayer.value,
    [...path.map((node) => node.vertex), vertex],
  );
  if (played == null) return false;
  const sign: Sign =
    path.length % 2 === 0
      ? anchorPlayer.value
      : anchorPlayer.value === 1
        ? -1
        : 1;
  const id = `try-${++trySeq}`;
  tryNodes.value = [
    ...tryNodes.value,
    {
      id,
      parentId: tryCursor.value,
      vertex,
      sign,
      label: formatGtpVertex(vertex, boardSize.value),
    },
  ];
  tryCursor.value = id;
  return true;
}

function onBack() {
  if (tryMode.value && tryCursor.value != null) {
    const node = tryNodes.value.find((item) => item.id === tryCursor.value);
    tryCursor.value = node?.parentId ?? null;
    return;
  }
  if (tryMode.value) {
    // At the try anchor: leave the variation, then step to its parent ply.
    tryMode.value = false;
    clearTry();
  }
  goBack();
}

function onForward() {
  if (tryMode.value) {
    const child = [...tryNodes.value]
      .reverse()
      .find((node) => node.parentId === tryCursor.value);
    if (child) tryCursor.value = child.id;
    return;
  }
  goForward();
}

function onSelectPly(ply: number) {
  if (tryMode.value) {
    tryMode.value = false;
    clearTry();
  }
  goToPly(ply);
  emit("select-ply", ply);
}

function stepKey(dir: 1 | -1) {
  const rows = sortedKeys.value;
  const next =
    dir > 0
      ? rows.find((row) => row.ply > moveNumber.value)
      : [...rows].reverse().find((row) => row.ply < moveNumber.value);
  if (next == null) return;
  onSelectPly(next.ply);
  view.value = "board";
}

function onReportSelect(ply: number) {
  view.value = "board";
  onSelectPly(ply);
}

function onRootKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (
    target?.closest(
      "input, textarea, select, [role='tab'], [role='separator']",
    )
  ) {
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    onBack();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    onForward();
  } else if (event.key === "[") {
    stepKey(-1);
  } else if (event.key === "]") {
    stepKey(1);
  }
}

function onVertexClick(evt: MouseEvent, vertex: Vertex) {
  if (tryMode.value) {
    playAt(vertex);
    return;
  }
  emit("vertex-click", evt, vertex);
}

function panelVisible(id: CompactSection): boolean {
  return !compact.value || section.value === id;
}

function showLower(): boolean {
  if (!compact.value) return true;
  return section.value === "groups" || section.value === "tree";
}

function showGroups(): boolean {
  if (compact.value) return section.value === "groups";
  return lowerTab.value === "groups";
}

function showTree(): boolean {
  if (compact.value) return section.value === "tree";
  return lowerTab.value === "tree";
}

let resizeDrag: { x: number; width: number } | null = null;

function onSplitterDown(event: PointerEvent) {
  if (compact.value) return;
  resizeDrag = { x: event.clientX, width: sidebarWidth.value };
  window.addEventListener("pointermove", onSplitterMove);
  window.addEventListener("pointerup", onSplitterUp);
}

function onSplitterMove(event: PointerEvent) {
  if (resizeDrag == null) return;
  sidebarUserSized.value = true;
  const next = resizeDrag.width - (event.clientX - resizeDrag.x);
  sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
}

function onSplitterUp() {
  resizeDrag = null;
  window.removeEventListener("pointermove", onSplitterMove);
  window.removeEventListener("pointerup", onSplitterUp);
  updateAutoVertexSize();
}

function onSplitterKey(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  event.stopPropagation();
  sidebarUserSized.value = true;
  if (event.key === "ArrowLeft") {
    sidebarWidth.value = Math.min(SIDEBAR_MAX, sidebarWidth.value + 16);
  } else {
    sidebarWidth.value = Math.max(SIDEBAR_MIN, sidebarWidth.value - 16);
  }
}

defineExpose({
  boardSize,
  moveNumber,
  goToPly,
  goForward,
  goBack,
  loadSgf: load,
  effectiveVertexSize,
  tryMode,
  view,
});
</script>

<template>
  <div
    ref="rootEl"
    class="yagoo-reviewer"
    :class="{
      'yagoo-reviewer--compact': compact,
      'yagoo-reviewer--report': view === 'report',
    }"
    :style="{ '--yagoo-sidebar-width': `${sidebarWidth}px` }"
    tabindex="-1"
    @keydown="onRootKey"
  >
    <ReviewReport
      v-if="view === 'report'"
      class="yagoo-reviewer__report"
      :rows="keyMoves"
      :report="reportDocument"
      :current-ply="moveNumber"
      @select="onReportSelect"
      @close="view = 'board'"
    />

    <template v-else>
      <main ref="mainEl" class="yagoo-reviewer__main">
        <p v-if="activeComparison" class="yagoo-try-banner" data-testid="comparison-board-banner">
          Move {{ activeComparison.ply }} comparison · board before the move (ply {{ activeComparison.rootPly }}).
          A = actual {{ activeComparison.actualMove }} · AI = {{ activeComparison.aiMove }}.
        </p>
        <p
          v-if="suspendAnalysis"
          class="yagoo-try-banner"
          data-testid="try-banner"
        >
          Variation is not analyzed. AI suggestions — Coming in #26.
        </p>
        <div class="yagoo-reviewer__board-wrap">
          <Goban
            :sign-map="displaySignMap"
            :heat-map="boardHeat"
            :paint-map="boardPaint"
            :ghost-stone-map="boardGhosts"
            :marker-map="boardMarkers"
            :lines="boardLines"
            :selected-vertices="boardSelected"
            :dimmed-vertices="boardDimmed"
            :vertex-size="effectiveVertexSize"
            :show-coordinates="showCoordinates"
            :fuzzy-stone-placement="fuzzyStonePlacement"
            :animate-stone-placement="animateStonePlacement"
            :fuzzy-seed="fuzzySeed"
            @vertex-mouseenter="(evt, v) => emit('vertex-mouseenter', evt, v)"
            @vertex-mouseleave="(evt, v) => emit('vertex-mouseleave', evt, v)"
            @vertex-click="onVertexClick"
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

      <div
        v-show="!compact"
        class="yagoo-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabindex="0"
        :aria-valuenow="sidebarWidth"
        aria-valuemin="340"
        aria-valuemax="560"
        @pointerdown="onSplitterDown"
        @keydown.stop="onSplitterKey"
      />

      <aside class="yagoo-reviewer__sidebar">
        <div
          v-if="compact"
          class="yagoo-section-tabs"
          role="tablist"
          aria-label="Sidebar sections"
        >
          <button
            v-for="item in sections"
            :key="item.id"
            type="button"
            role="tab"
            :aria-selected="section === item.id"
            :data-testid="`section-${item.id}`"
            @click="section = item.id"
          >
            {{ item.label }}
          </button>
        </div>

        <WinrateGraph
          v-show="panelVisible('graph')"
          :data="winrateData"
          :current-index="moveNumber"
          :height="108"
          :show-score-lead="true"
          @select="onSelectPly"
        />

        <MoveInspector
          v-show="panelVisible('inspector')"
          class="yagoo-reviewer__inspector"
          :candidates="candidates"
          :root="rootAnalysis"
          :root-visits="rootVisits"
          :preview-index="previewCandidateIndex"
          :selected-index="selectedCandidateIndex"
          :ledger="ledger"
          :comparison="alignedComparison"
          :show-comparison-difference="comparisonDifference"
          :sacrifices="sacrifices"
          :commentary="commentary"
          :initial-perspective="initialPerspective"
          :ply="moveNumber"
          :key-index="keyIndex"
          :key-count="sortedKeys.length"
          @preview="(i) => emit('preview-candidate', i)"
          @clear-preview="emit('clear-preview')"
          @toggle="(i) => emit('toggle-candidate', i)"
          @select="(i) => emit('select-candidate', i)"
          @preview-group="(id) => emit('preview-group', id)"
          @preview-ledger="previewLedger"
          @preview-stones="previewStones"
          @perspective-change="inspectorPerspective = $event"
          @toggle-comparison-difference="comparisonDifference = $event"
          @clear-ledger-preview="ledgerPreview = null"
          @prev-key="stepKey(-1)"
          @next-key="stepKey(1)"
        />

        <div v-show="showLower()" class="yagoo-reviewer__lower">
          <div
            v-if="!compact"
            class="yagoo-subtabs"
            role="tablist"
            aria-label="Groups and tree"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="lowerTab === 'groups'"
              data-testid="lower-groups"
              @click="lowerTab = 'groups'"
            >
              Groups
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="lowerTab === 'tree'"
              data-testid="lower-tree"
              @click="lowerTab = 'tree'"
            >
              Tree
            </button>
          </div>
          <GroupsPanel
            v-show="showGroups()"
            embedded
            :groups="displayedGroups"
            :preview-id="activeComparison ? null : previewGroupId"
            :selected-id="activeComparison ? null : selectedGroupId"
            @preview="previewDisplayedGroup"
            @clear-preview="clearDisplayedGroup"
            @select="selectDisplayedGroup"
          />
          <VariationTree
            v-show="showTree()"
            :try-mode="tryMode"
            :cursor-id="tryCursor"
            :nodes="tryNodes"
            :sgf-children="children"
            @select-try="(id) => (tryCursor = id)"
            @select-variation="(index) => goToVariation(index)"
          />
        </div>

        <CommentBox
          v-show="panelVisible('comment')"
          dock
          :title="commentTitle"
          :comment="displayComment"
        />
      </aside>
    </template>

    <BottomBar
      class="yagoo-reviewer__bar"
      :players="displayPlayers"
      :current-player="displayPlayer"
      :can-go-back="canStepBack"
      :can-go-forward="canStepForward"
      :move-number="moveNumber"
      :try-mode="tryMode"
      :report-mode="view === 'report'"
      @back="onBack"
      @forward="onForward"
      @toggle-try="toggleTry"
      @toggle-report="view = view === 'report' ? 'board' : 'report'"
    />
  </div>
</template>
