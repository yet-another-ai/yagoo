<script setup lang="ts">
import { computed } from "vue";

export interface WinratePoint {
  /** Black winrate in percent, or null if unknown. */
  winrate: number | null;
  /** Winrate change vs previous move (percentage points). */
  change?: number | null;
}

const props = withDefaults(
  defineProps<{
    data?: WinratePoint[];
    currentIndex?: number;
    height?: number;
  }>(),
  {
    data: () => [],
    currentIndex: 0,
    height: 80,
  },
);

const width = 280;
const pad = 4;

const pathD = computed(() => {
  const pts = props.data;
  if (pts.length < 2) return "";
  const n = pts.length;
  const coords: string[] = [];
  for (let i = 0; i < n; i++) {
    const wr = pts[i]?.winrate;
    if (wr == null) continue;
    const x = pad + (i / Math.max(1, n - 1)) * (width - pad * 2);
    const y = pad + (1 - wr / 100) * (props.height - pad * 2);
    coords.push(`${coords.length === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return coords.join(" ");
});

const changeBars = computed(() => {
  const pts = props.data;
  const n = pts.length;
  const mid = props.height / 2;
  return pts.map((p, i) => {
    const change = p.change ?? 0;
    const x = pad + (i / Math.max(1, n - 1)) * (width - pad * 2);
    const h = Math.min(Math.abs(change), 30) * 0.8;
    return {
      x,
      y1: mid,
      y2: change >= 0 ? mid - h : mid + h,
    };
  });
});

const marker = computed(() => {
  const i = Math.min(props.currentIndex, Math.max(0, props.data.length - 1));
  const wr = props.data[i]?.winrate ?? 50;
  return {
    x: pad + (i / Math.max(1, props.data.length - 1)) * (width - pad * 2),
    y: pad + (1 - wr / 100) * (props.height - pad * 2),
  };
});
</script>

<template>
  <div class="yagoo-winrate" role="img" aria-label="Winrate graph">
    <svg
      class="yagoo-winrate__svg"
      :viewBox="`0 0 ${width} ${height}`"
      preserveAspectRatio="none"
    >
      <line
        class="yagoo-winrate__grid"
        :x1="pad"
        :x2="width - pad"
        :y1="height / 2"
        :y2="height / 2"
      />
      <line
        v-for="(bar, i) in changeBars"
        :key="i"
        class="yagoo-winrate__change"
        :x1="bar.x"
        :x2="bar.x"
        :y1="bar.y1"
        :y2="bar.y2"
      />
      <path v-if="pathD" class="yagoo-winrate__line" :d="pathD" />
      <circle
        :cx="marker.x"
        :cy="marker.y"
        r="3"
        fill="#0082F0"
      />
    </svg>
  </div>
</template>
