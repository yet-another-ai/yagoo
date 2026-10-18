<script setup lang="ts">
import { computed } from "vue";
import type { Vertex } from "../types";

const props = defineProps<{
  vertexSize: number;
  width: number;
  height: number;
  xs: number[];
  ys: number[];
  hoshis: Vertex[];
}>();

const half = computed(() => props.vertexSize / 2);
const fl = Math.floor;
</script>

<template>
  <svg
    v-if="xs.length > 0 && ys.length > 0"
    class="shudan-grid"
    :style="{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      zIndex: 0,
    }"
  >
    <rect
      v-for="(_, i) in ys"
      :key="`h${i}`"
      class="shudan-gridline shudan-horizontal"
      :x="fl(xs[0] === 0 ? half : 0)"
      :y="fl((2 * i + 1) * half - 0.5)"
      :width="
        xs[xs.length - 1] === width - 1
          ? (2 * xs.length - 1) * half - (xs[0] === 0 ? half : 0)
          : xs.length * vertexSize - (xs[0] === 0 ? half : 0)
      "
      :height="1"
    />
    <rect
      v-for="(_, i) in xs"
      :key="`v${i}`"
      class="shudan-gridline shudan-vertical"
      :x="fl((2 * i + 1) * half - 0.5)"
      :y="fl(ys[0] === 0 ? half : 0)"
      :width="1"
      :height="
        ys[ys.length - 1] === height - 1
          ? (2 * ys.length - 1) * half - (ys[0] === 0 ? half : 0)
          : ys.length * vertexSize - (ys[0] === 0 ? half : 0)
      "
    />
    <template v-for="([x, y]) in hoshis" :key="`${x}-${y}`">
      <circle
        v-if="xs.indexOf(x) >= 0 && ys.indexOf(y) >= 0"
        class="shudan-hoshi"
        :cx="fl((2 * xs.indexOf(x) + 1) * half - 0.5) + 0.5"
        :cy="fl((2 * ys.indexOf(y) + 1) * half - 0.5) + 0.5"
        r=".1em"
      />
    </template>
  </svg>
</template>
