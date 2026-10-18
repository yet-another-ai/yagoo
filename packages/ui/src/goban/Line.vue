<script setup lang="ts">
import { computed } from "vue";
import type { Vertex } from "../types";
import { vertexEquals } from "./helper";

const props = withDefaults(
  defineProps<{
    v1: Vertex;
    v2: Vertex;
    type?: "line" | "arrow";
    vertexSize: number;
  }>(),
  { type: "line" },
);

const pathD = computed(() => {
  if (vertexEquals(props.v1, props.v2)) return null;

  const [pos1, pos2] = [props.v1, props.v2].map((v) =>
    v.map((x) => x * props.vertexSize),
  ) as [number[], number[]];
  const [dx, dy] = pos1.map((x, i) => pos2[i]! - x) as [number, number];
  const [left, top] = pos1.map(
    (x, i) => (x + pos2[i]! + props.vertexSize) / 2,
  ) as [number, number];

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const length = Math.sqrt(dx * dx + dy * dy);
  const right = left + length;

  let d = `M ${left} ${top} h ${length}`;
  if (props.type === "arrow") {
    const x1 = right - props.vertexSize / 2;
    const y1 = top - props.vertexSize / 4;
    const x2 = right - props.vertexSize / 2;
    const y2 = top + props.vertexSize / 4;
    d += ` L ${x1} ${y1} M ${right} ${top} L ${x2} ${y2}`;
  }

  return {
    d,
    transform: `rotate(${angle} ${left} ${top}) translate(${-length / 2} 0)`,
  };
});
</script>

<template>
  <path
    v-if="pathD"
    :class="`shudan-${type}`"
    :d="pathD.d"
    :transform="pathD.transform"
  />
</template>
