<script setup lang="ts">
import { alpha } from "./helper";

defineProps<{
  axis: "x" | "y";
  indices: number[];
  height?: number;
  coordX?: (x: number) => string | number;
  coordY?: (y: number) => string | number;
  style?: Record<string, string | number>;
}>();

function defaultCoordX(i: number): string {
  return alpha[i] ?? alpha[alpha.length - 1]!;
}

function defaultCoordY(i: number, height: number): number {
  return height - i;
}
</script>

<template>
  <div
    v-if="axis === 'x'"
    class="shudan-coordx"
    :style="{ display: 'flex', textAlign: 'center', ...style }"
  >
    <div v-for="i in indices" :key="i" :style="{ width: '1em' }">
      <span :style="{ display: 'block' }">
        {{ (coordX ?? defaultCoordX)(i) }}
      </span>
    </div>
  </div>
  <div
    v-else
    class="shudan-coordy"
    :style="{ textAlign: 'center', ...style }"
  >
    <div v-for="i in indices" :key="i" :style="{ height: '1em' }">
      <span :style="{ display: 'block' }">
        {{ (coordY ?? ((y) => defaultCoordY(y, height ?? 0)))(i) }}
      </span>
    </div>
  </div>
</template>
