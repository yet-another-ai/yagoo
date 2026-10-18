<script setup lang="ts">
import type { Marker as MarkerData, Sign } from "../types";

defineProps<{
  sign: Sign;
  type?: MarkerData["type"];
  label?: string | null;
  zIndex?: number;
}>();
</script>

<template>
  <div
    v-if="type === 'label'"
    class="shudan-marker"
    :style="{ position: 'absolute', zIndex }"
  >
    {{ label }}
  </div>
  <svg
    v-else
    class="shudan-marker"
    viewBox="0 0 1 1"
    :style="{ position: 'absolute', zIndex }"
  >
    <circle
      v-if="type === 'circle' || type === 'loader' || type === 'point'"
      cx="0.5"
      cy="0.5"
      :r="type === 'point' ? 0.18 : 0.25"
      vector-effect="non-scaling-stroke"
    />
    <rect
      v-else-if="type === 'square'"
      x="0.25"
      y="0.25"
      width="0.5"
      height="0.5"
      vector-effect="non-scaling-stroke"
    />
    <template v-else-if="type === 'cross'">
      <rect
        v-if="sign === 0"
        x="0.25"
        y="0.25"
        width="0.5"
        height="0.5"
        stroke="none"
      />
      <path
        d="M 0 0 L .5 .5 M .5 0 L 0 .5"
        transform="translate(.25 .25)"
        vector-effect="non-scaling-stroke"
      />
    </template>
    <path
      v-else-if="type === 'triangle'"
      d="M 0 .5 L .6 .5 L .3 0 z"
      transform="translate(.2 .2)"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
