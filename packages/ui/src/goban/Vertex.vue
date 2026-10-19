<script setup lang="ts">
import { computed } from "vue";
import type {
  GhostStone,
  HeatVertex,
  Marker as MarkerData,
  Sign,
  Vertex as VertexPos,
} from "../types";
import { VERTEX_EVENTS } from "../types";
import { avg, signEquals } from "./helper";
import Marker from "./Marker.vue";

const props = defineProps<{
  position: VertexPos;
  shift?: number;
  random?: number;
  sign?: Sign;
  heat?: HeatVertex | null;
  paint?: number | null;
  paintLeft?: number | null;
  paintRight?: number | null;
  paintTop?: number | null;
  paintBottom?: number | null;
  paintTopLeft?: number | null;
  paintTopRight?: number | null;
  paintBottomLeft?: number | null;
  paintBottomRight?: number | null;
  dimmed?: boolean;
  marker?: MarkerData | null;
  ghostStone?: GhostStone | null;
  animate?: boolean;
  selected?: boolean;
  selectedLeft?: boolean;
  selectedRight?: boolean;
  selectedTop?: boolean;
  selectedBottom?: boolean;
}>();

const emit = defineEmits<{
  (e: "vertex-event", eventName: string, evt: Event, vertex: VertexPos): void;
}>();

const sign = computed(() => props.sign ?? 0);
const shift = computed(() => props.shift ?? 0);
const random = computed(() => props.random ?? 0);

const classList = computed(() => {
  const classes: string[] = [
    "shudan-vertex",
    `shudan-random_${random.value}`,
    `shudan-sign_${sign.value}`,
  ];

  if (shift.value) classes.push(`shudan-shift_${shift.value}`);
  if (props.heat) classes.push(`shudan-heat_${props.heat.strength}`);
  if (props.dimmed) classes.push("shudan-dimmed");
  if (props.animate) classes.push("shudan-animate");

  if (props.paint) {
    classes.push(`shudan-paint_${props.paint > 0 ? 1 : -1}`);
  }
  if (props.paint && signEquals(props.paintLeft, props.paint)) {
    classes.push("shudan-paintedleft");
  }
  if (props.paint && signEquals(props.paintRight, props.paint)) {
    classes.push("shudan-paintedright");
  }
  if (props.paint && signEquals(props.paintTop, props.paint)) {
    classes.push("shudan-paintedtop");
  }
  if (props.paint && signEquals(props.paintBottom, props.paint)) {
    classes.push("shudan-paintedbottom");
  }

  if (props.selected) classes.push("shudan-selected");
  if (props.selectedLeft) classes.push("shudan-selectedleft");
  if (props.selectedRight) classes.push("shudan-selectedright");
  if (props.selectedTop) classes.push("shudan-selectedtop");
  if (props.selectedBottom) classes.push("shudan-selectedbottom");

  if (props.marker?.type) classes.push(`shudan-marker_${props.marker.type}`);
  if (
    props.marker?.type === "label" &&
    (props.marker.label?.includes("\n") ||
      (props.marker.label?.length ?? 0) >= 3)
  ) {
    classes.push("shudan-smalllabel");
  }

  if (props.ghostStone) {
    classes.push(`shudan-ghost_${props.ghostStone.sign}`);
    if (props.ghostStone.type) {
      classes.push(`shudan-ghost_${props.ghostStone.type}`);
    }
    if (props.ghostStone.faint) classes.push("shudan-ghost_faint");
  }

  return classes;
});

const paintStyle = computed(() => {
  const paint = props.paint ?? 0;
  // Opacity must be non-negative — signed paint encodes color via
  // shudan-paint_±1; |paint| is the Sabaki territory strength.
  const sources = paint
    ? [Math.abs(paint)]
    : [props.paintLeft, props.paintRight, props.paintTop, props.paintBottom]
        .filter((x) => x !== 0 && x != null && !Number.isNaN(x))
        .map((x) => Math.abs(x!) * 0.5);

  const opacity = avg(sources as number[]);

  const corners: Array<[number, string] | null> = [
    signEquals(props.paintLeft, props.paintTop, props.paintTopLeft)
      ? [Math.sign(props.paintTop ?? 0), "-.5em -.5em"]
      : null,
    signEquals(props.paintRight, props.paintTop, props.paintTopRight)
      ? [Math.sign(props.paintTop ?? 0), ".5em -.5em"]
      : null,
    signEquals(props.paintLeft, props.paintBottom, props.paintBottomLeft)
      ? [Math.sign(props.paintBottom ?? 0), "-.5em .5em"]
      : null,
    signEquals(props.paintRight, props.paintBottom, props.paintBottomRight)
      ? [Math.sign(props.paintBottom ?? 0), ".5em .5em"]
      : null,
  ];

  const boxShadow = corners
    .filter((x): x is [number, string] => x != null && x[0] !== 0)
    .map(
      ([s, translation]) =>
        `${translation} 0 0 var(${
          s > 0
            ? "--shudan-black-background-color"
            : "--shudan-white-background-color"
        })`,
    )
    .join(",");

  return {
    position: "absolute" as const,
    zIndex: 3,
    "--shudan-paint-opacity": String(opacity),
    "--shudan-paint-box-shadow": boxShadow,
  };
});

function onDomEvent(eventName: string, evt: Event) {
  emit("vertex-event", eventName, evt, props.position);
}

const listeners = computed(() => {
  // Vue `v-on` object form wants DOM event names (`click`), not `onClick`.
  const result: Record<string, (evt: Event) => void> = {};
  for (const name of VERTEX_EVENTS) {
    result[name.toLowerCase()] = (evt: Event) => onDomEvent(name, evt);
  }
  return result;
});

function abs(zIndex?: number) {
  return { position: "absolute" as const, zIndex };
}
</script>

<template>
  <div
    class="shudan-vertex"
    :class="classList"
    :data-x="position[0]"
    :data-y="position[1]"
    :title="marker?.tooltip ?? marker?.label ?? undefined"
    :style="{ position: 'relative' }"
    v-on="listeners"
  >
    <div
      v-if="!sign && ghostStone"
      class="shudan-ghost"
      :style="abs(1)"
    />

    <!-- Marker above ghost so PV / candidate labels stay legible. -->
    <Marker
      v-if="!sign && marker"
      :sign="sign"
      :type="marker.type"
      :label="marker.label"
      :z-index="2"
    />

    <div class="shudan-stone" :style="abs(3)">
      <div
        v-if="sign"
        class="shudan-inner shudan-stone-image"
        :class="[`shudan-random_${random}`, `shudan-sign_${sign}`]"
        :style="abs()"
      >
        {{ sign }}
      </div>
      <Marker
        v-if="sign && marker"
        :sign="sign"
        :type="marker.type"
        :label="marker.label"
        :z-index="4"
      />
    </div>

    <div
      v-if="
        paint ||
        paintLeft ||
        paintRight ||
        paintTop ||
        paintBottom
      "
      class="shudan-paint"
      :style="paintStyle"
    />

    <div v-if="selected" class="shudan-selection" :style="abs(4)" />

    <!-- Heat under stones so ownership glow does not obscure them. -->
    <div class="shudan-heat" :style="abs(0)" />
    <div
      v-if="heat?.text != null"
      class="shudan-heatlabel"
      :style="abs(5)"
    >
      {{ heat.text.toString() }}
    </div>
  </div>
</template>
