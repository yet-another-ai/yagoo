<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useGame } from "../composables/useGame";
import Goban from "../goban/Goban.vue";
import OverlayLayer from "../overlays/OverlayLayer.vue";
import type { OverlayData } from "../overlays/OverlayRenderer";
import type { BoardMap, HeatVertex, Sign, Vertex } from "../types";
import BottomBar from "./BottomBar.vue";
import CommentBox from "./CommentBox.vue";
import WinrateGraph, { type WinratePoint } from "./WinrateGraph.vue";
import "./styles/reviewer.css";

const props = withDefaults(
  defineProps<{
    sgf?: string;
    winrateData?: WinratePoint[];
    vertexSize?: number;
    showCoordinates?: boolean;
    fuzzyStonePlacement?: boolean;
    animateStonePlacement?: boolean;
    fuzzySeed?: number;
    /** Demo group outline vertices (proves OverlayLayer alignment). */
    demoGroupOutline?: Vertex[];
    heatMap?: BoardMap<HeatVertex | null>;
  }>(),
  {
    vertexSize: 22,
    showCoordinates: true,
    fuzzyStonePlacement: true,
    animateStonePlacement: true,
    fuzzySeed: 42,
    demoGroupOutline: () => [],
    winrateData: () => [],
  },
);

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
  goToVariation,
  canGoForward,
  canGoBack,
  variationCount,
} = useGame();

const loaded = ref(false);

onMounted(() => {
  if (props.sgf) {
    loadSgf(props.sgf);
    loaded.value = true;
  }
});

const overlayData = computed<OverlayData>(() => ({
  groupOutlines:
    props.demoGroupOutline.length > 0
      ? [{ vertices: props.demoGroupOutline, color: "#0082F0" }]
      : [],
}));

const emptySignMap = computed<BoardMap<Sign>>(() => {
  const n = boardSize.value;
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0 as Sign),
  );
});

const displaySignMap = computed(() =>
  loaded.value ? signMap.value : emptySignMap.value,
);
</script>

<template>
  <div class="yagoo-reviewer">
    <main class="yagoo-reviewer__main">
      <div class="yagoo-reviewer__board-wrap">
        <Goban
          :sign-map="displaySignMap"
          :heat-map="heatMap"
          :vertex-size="vertexSize"
          :show-coordinates="showCoordinates"
          :fuzzy-stone-placement="fuzzyStonePlacement"
          :animate-stone-placement="animateStonePlacement"
          :fuzzy-seed="fuzzySeed"
        >
          <OverlayLayer
            :vertex-size="vertexSize"
            :width="boardSize"
            :height="boardSize"
            :data="overlayData"
          />
        </Goban>
      </div>
    </main>

    <aside class="yagoo-reviewer__sidebar">
      <WinrateGraph :data="winrateData" :current-index="moveNumber" />
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
      <CommentBox :comment="comment" />
    </aside>

    <BottomBar
      class="yagoo-reviewer__bar"
      :players="players"
      :current-player="currentPlayer"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :move-number="moveNumber"
      @back="goBack()"
      @forward="goForward()"
    />
  </div>
</template>
