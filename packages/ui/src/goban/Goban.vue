<script setup lang="ts">
/**
 * Vue port of SabakiHQ/Shudan Goban (MIT).
 * DOM / class / CSS-variable / map-prop API mirrors Shudan.
 */
import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import type {
  BoardMap,
  GhostStone,
  HeatVertex,
  LineMarker,
  Marker,
  Sign,
  Vertex,
} from "../types";
import Coord from "./Coord.vue";
import Grid from "./Grid.vue";
import {
  diffSignMap,
  getHoshis,
  neighborhood,
  range,
  vertexEquals,
} from "./helper";
import Line from "./Line.vue";
import {
  applyPlacementShift,
  createRandomMap,
  createRng,
  createShiftMap,
  type RandomMap,
  type Rng,
  type ShiftMap,
} from "./shifts";
import VertexCell from "./Vertex.vue";
import "./styles/goban.css";

const DEFAULT_STONE_VARIATION_COUNT = 5;

const props = withDefaults(
  defineProps<{
    id?: string;
    class?: string;
    className?: string;
    style?: Record<string, string | number>;
    busy?: boolean;
    vertexSize?: number;
    rangeX?: [number, number];
    rangeY?: [number, number];
    showCoordinates?: boolean;
    coordX?: (x: number) => string | number;
    coordY?: (y: number) => string | number;
    fuzzyStonePlacement?: boolean;
    animateStonePlacement?: boolean;
    /** Seed for fuzzy shifts / stone variations. Stable across remounts when set. */
    fuzzySeed?: number;
    animationDuration?: number;
    stoneVariationCounts?: Partial<Record<1 | -1, number>>;
    signMap?: BoardMap<Sign>;
    markerMap?: BoardMap<Marker | null>;
    paintMap?: BoardMap<number>;
    ghostStoneMap?: BoardMap<GhostStone | null>;
    heatMap?: BoardMap<HeatVertex | null>;
    selectedVertices?: Vertex[];
    dimmedVertices?: Vertex[];
    lines?: LineMarker[];
  }>(),
  {
    vertexSize: 24,
    rangeX: () => [0, Infinity],
    rangeY: () => [0, Infinity],
    showCoordinates: false,
    fuzzyStonePlacement: false,
    animateStonePlacement: false,
    animationDuration: 200,
    selectedVertices: () => [],
    dimmedVertices: () => [],
    lines: () => [],
  },
);

const emit = defineEmits<{
  (e: "vertex-click", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-mousedown", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-mouseup", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-mousemove", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-mouseenter", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-mouseleave", evt: MouseEvent, vertex: Vertex): void;
  (e: "vertex-pointerdown", evt: PointerEvent, vertex: Vertex): void;
  (e: "vertex-pointerup", evt: PointerEvent, vertex: Vertex): void;
  (e: "vertex-pointermove", evt: PointerEvent, vertex: Vertex): void;
  (e: "vertex-pointerenter", evt: PointerEvent, vertex: Vertex): void;
  (e: "vertex-pointerleave", evt: PointerEvent, vertex: Vertex): void;
}>();

const width = ref(0);
const height = ref(0);
const xs = ref<number[]>([]);
const ys = ref<number[]>([]);
const hoshis = ref<Vertex[]>([]);
const shiftMap = shallowRef<ShiftMap>([]);
const randomMap = shallowRef<RandomMap>([]);
const animatedVertices = shallowRef<Vertex[]>([]);
const prevSignMap = shallowRef<BoardMap<Sign> | undefined>(undefined);
let clearAnimatedVerticesHandler: ReturnType<typeof setTimeout> | null = null;
let rng: Rng = Math.random;

function makeRng(): Rng {
  return props.fuzzySeed != null ? createRng(props.fuzzySeed) : Math.random;
}

function boardSize(signMap: BoardMap<Sign> | undefined): {
  w: number;
  h: number;
} {
  const h = signMap?.length ?? 0;
  const w = h === 0 ? 0 : (signMap![0]?.length ?? 0);
  return { w, h };
}

function rebuildBoard(signMap: BoardMap<Sign> | undefined) {
  const { w, h } = boardSize(signMap);
  rng = makeRng();
  width.value = w;
  height.value = h;
  const rx = props.rangeX ?? [0, Infinity];
  const ry = props.rangeY ?? [0, Infinity];
  xs.value = range(w).slice(rx[0], rx[1] + 1);
  ys.value = range(h).slice(ry[0], ry[1] + 1);
  hoshis.value = getHoshis(w, h);
  shiftMap.value = createShiftMap(w, h, rng);
  randomMap.value = createRandomMap(w, h, rng);
  animatedVertices.value = [];
  if (clearAnimatedVerticesHandler != null) {
    clearTimeout(clearAnimatedVerticesHandler);
    clearAnimatedVerticesHandler = null;
  }
  prevSignMap.value = signMap;
}

function updateRange() {
  const rx = props.rangeX ?? [0, Infinity];
  const ry = props.rangeY ?? [0, Infinity];
  xs.value = range(width.value).slice(rx[0], rx[1] + 1);
  ys.value = range(height.value).slice(ry[0], ry[1] + 1);
}

watch(
  () => props.signMap,
  (signMap, oldSignMap) => {
    const { w, h } = boardSize(signMap);
    if (w !== width.value || h !== height.value) {
      rebuildBoard(signMap);
      return;
    }

    if (
      props.animateStonePlacement &&
      props.fuzzyStonePlacement &&
      clearAnimatedVerticesHandler == null &&
      oldSignMap != null
    ) {
      const added = diffSignMap(prevSignMap.value ?? oldSignMap, signMap);
      if (added.length > 0) {
        animatedVertices.value = added;
      }
    }

    prevSignMap.value = signMap;
  },
  { immediate: true },
);

watch(
  () => [props.rangeX, props.rangeY] as const,
  () => updateRange(),
);

watch(
  () => props.fuzzySeed,
  () => {
    // Re-seed maps when the seed changes (deterministic remount scenario).
    rebuildBoard(props.signMap);
  },
);

watch(animatedVertices, (vertices) => {
  if (
    !props.animateStonePlacement ||
    clearAnimatedVerticesHandler != null ||
    vertices.length === 0
  ) {
    return;
  }

  const next = shiftMap.value.map((row) => row.slice());
  for (const [x, y] of vertices) {
    applyPlacementShift(next, [x, y], rng);
  }
  shiftMap.value = next;

  clearAnimatedVerticesHandler = setTimeout(() => {
    animatedVertices.value = [];
    clearAnimatedVerticesHandler = null;
  }, props.animationDuration ?? 200);
});

onBeforeUnmount(() => {
  if (clearAnimatedVerticesHandler != null) {
    clearTimeout(clearAnimatedVerticesHandler);
  }
});

function getStoneVariation(sign: number, seed: number): number {
  let count = props.stoneVariationCounts?.[sign as 1 | -1];
  if (!Number.isSafeInteger(count) || (count ?? 0) < 1) {
    count = DEFAULT_STONE_VARIATION_COUNT;
  }
  return Math.floor(seed * (count as number));
}

const animatedNeighborhood = computed(() => {
  const set = new Set<string>();
  for (const v of animatedVertices.value) {
    for (const n of neighborhood(v)) {
      set.add(`${n[0]},${n[1]}`);
    }
  }
  return set;
});

const rootClass = computed(() => [
  "shudan-goban",
  "shudan-goban-image",
  `shudan-board-${width.value}x${height.value}`,
  {
    "shudan-busy": props.busy,
    "shudan-coordinates": props.showCoordinates,
  },
  props.class ?? props.className,
]);

const rootStyle = computed(() => ({
  display: "inline-grid",
  gridTemplateRows: props.showCoordinates ? "1em 1fr 1em" : "1fr",
  gridTemplateColumns: props.showCoordinates ? "1em 1fr 1em" : "1fr",
  fontSize: `${props.vertexSize}px`,
  lineHeight: "1em",
  ...(props.style ?? {}),
}));

function isSelected(x: number, y: number): boolean {
  return props.selectedVertices.some((v) => vertexEquals(v, [x, y]));
}

function isDimmed(x: number, y: number): boolean {
  return props.dimmedVertices.some((v) => vertexEquals(v, [x, y]));
}

function onVertexEvent(eventName: string, evt: Event, vertex: Vertex) {
  const map: Record<string, string> = {
    Click: "vertex-click",
    MouseDown: "vertex-mousedown",
    MouseUp: "vertex-mouseup",
    MouseMove: "vertex-mousemove",
    MouseEnter: "vertex-mouseenter",
    MouseLeave: "vertex-mouseleave",
    PointerDown: "vertex-pointerdown",
    PointerUp: "vertex-pointerup",
    PointerMove: "vertex-pointermove",
    PointerEnter: "vertex-pointerenter",
    PointerLeave: "vertex-pointerleave",
  };
  const name = map[eventName];
  if (name) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit(name as any, evt as any, vertex);
  }
}

/** Expose shift map for unit tests. */
defineExpose({
  shiftMap,
  randomMap,
  animatedVertices,
  width,
  height,
});
</script>

<template>
  <div
    :id="id"
    :class="rootClass"
    :data-shudan-board-width="width"
    :data-shudan-board-height="height"
    :style="rootStyle"
  >
    <Coord
      v-if="showCoordinates"
      axis="x"
      :indices="xs"
      :coord-x="coordX"
      :style="{ gridRow: '1', gridColumn: '2' }"
    />
    <Coord
      v-if="showCoordinates"
      axis="y"
      :indices="ys"
      :height="height"
      :coord-y="coordY"
      :style="{ gridRow: '2', gridColumn: '1' }"
    />

    <div
      class="shudan-content"
      :style="{
        position: 'relative',
        width: `${xs.length}em`,
        height: `${ys.length}em`,
        gridRow: showCoordinates ? '2' : '1',
        gridColumn: showCoordinates ? '2' : '1',
      }"
    >
      <Grid
        :vertex-size="vertexSize"
        :width="width"
        :height="height"
        :xs="xs"
        :ys="ys"
        :hoshis="hoshis"
      />

      <div
        class="shudan-vertices"
        :style="{
          display: 'grid',
          gridTemplateColumns: `repeat(${xs.length}, 1em)`,
          gridTemplateRows: `repeat(${ys.length}, 1em)`,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1,
        }"
      >
        <template v-for="y in ys" :key="`row-${y}`">
          <VertexCell
            v-for="x in xs"
            :key="`${x}-${y}`"
            :position="[x, y]"
            :shift="fuzzyStonePlacement ? shiftMap[y]?.[x] ?? 0 : 0"
            :random="
              getStoneVariation(
                (signMap?.[y]?.[x] || ghostStoneMap?.[y]?.[x]?.sign) ?? 0,
                randomMap[y]?.[x] ?? 0,
              )
            "
            :sign="(signMap?.[y]?.[x] ?? 0) as Sign"
            :heat="heatMap?.[y]?.[x] ?? null"
            :marker="markerMap?.[y]?.[x] ?? null"
            :ghost-stone="ghostStoneMap?.[y]?.[x] ?? null"
            :dimmed="isDimmed(x, y)"
            :animate="animatedNeighborhood.has(`${x},${y}`)"
            :paint="paintMap?.[y]?.[x] ?? 0"
            :paint-left="paintMap?.[y]?.[x - 1]"
            :paint-right="paintMap?.[y]?.[x + 1]"
            :paint-top="paintMap?.[y - 1]?.[x]"
            :paint-bottom="paintMap?.[y + 1]?.[x]"
            :paint-top-left="paintMap?.[y - 1]?.[x - 1]"
            :paint-top-right="paintMap?.[y - 1]?.[x + 1]"
            :paint-bottom-left="paintMap?.[y + 1]?.[x - 1]"
            :paint-bottom-right="paintMap?.[y + 1]?.[x + 1]"
            :selected="isSelected(x, y)"
            :selected-left="
              isSelected(x, y) &&
              selectedVertices.some((v) => vertexEquals(v, [x - 1, y]))
            "
            :selected-right="
              isSelected(x, y) &&
              selectedVertices.some((v) => vertexEquals(v, [x + 1, y]))
            "
            :selected-top="
              isSelected(x, y) &&
              selectedVertices.some((v) => vertexEquals(v, [x, y - 1]))
            "
            :selected-bottom="
              isSelected(x, y) &&
              selectedVertices.some((v) => vertexEquals(v, [x, y + 1]))
            "
            @vertex-event="onVertexEvent"
          />
        </template>
      </div>

      <svg
        class="shudan-lines"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2,
        }"
      >
        <g
          :transform="`translate(-${(rangeX?.[0] ?? 0) * vertexSize} -${(rangeY?.[0] ?? 0) * vertexSize})`"
        >
          <Line
            v-for="(line, i) in lines"
            :key="i"
            :v1="line.v1"
            :v2="line.v2"
            :type="line.type"
            :vertex-size="vertexSize"
          />
        </g>
      </svg>

      <slot />
    </div>

    <Coord
      v-if="showCoordinates"
      axis="y"
      :indices="ys"
      :height="height"
      :coord-y="coordY"
      :style="{ gridRow: '2', gridColumn: '3' }"
    />
    <Coord
      v-if="showCoordinates"
      axis="x"
      :indices="xs"
      :coord-x="coordX"
      :style="{ gridRow: '3', gridColumn: '2' }"
    />
  </div>
</template>
