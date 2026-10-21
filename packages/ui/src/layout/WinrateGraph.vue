<script setup lang="ts">
import { computed } from "vue";
import { useYagooI18n } from "../i18n";
const { t } = useYagooI18n();

export interface WinratePoint {
  /** Black winrate in percent, or null if unknown. */
  winrate: number | null;
  /** Winrate change vs previous move (percentage points). */
  change?: number | null;
  /** Black score lead in points (positive = Black ahead). */
  scoreLead?: number | null;
  /** Highlight plies selected for deepening (`deepPliesSelected`). */
  deepSelected?: boolean;
}

const props = withDefaults(
  defineProps<{
    data?: WinratePoint[];
    currentIndex?: number;
    height?: number;
    /** Show score-lead polyline (secondary axis). */
    showScoreLead?: boolean;
  }>(),
  {
    data: () => [],
    currentIndex: 0,
    height: 140,
    showScoreLead: true,
  },
);

const emit = defineEmits<{
  (e: "select", index: number): void;
}>();

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

const scoreLeadPath = computed(() => {
  if (!props.showScoreLead) return "";
  const pts = props.data;
  if (pts.length < 2) return "";
  const leads = pts
    .map((p) => p.scoreLead)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (leads.length < 2) return "";
  const maxAbs = Math.max(10, ...leads.map((v) => Math.abs(v)));
  const n = pts.length;
  const coords: string[] = [];
  for (let i = 0; i < n; i++) {
    const sl = pts[i]?.scoreLead;
    if (sl == null) continue;
    const x = pad + (i / Math.max(1, n - 1)) * (width - pad * 2);
    const y =
      pad + (1 - (sl / maxAbs + 1) / 2) * (props.height - pad * 2);
    coords.push(
      `${coords.length === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`,
    );
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

const deepMarkers = computed(() => {
  const pts = props.data;
  const n = pts.length;
  return pts
    .map((p, i) => {
      if (!p.deepSelected) return null;
      const x = pad + (i / Math.max(1, n - 1)) * (width - pad * 2);
      return { x, i };
    })
    .filter((v): v is { x: number; i: number } => v != null);
});

const marker = computed(() => {
  const i = Math.min(props.currentIndex, Math.max(0, props.data.length - 1));
  const wr = props.data[i]?.winrate ?? 50;
  return {
    x: pad + (i / Math.max(1, props.data.length - 1)) * (width - pad * 2),
    y: pad + (1 - wr / 100) * (props.height - pad * 2),
  };
});

function onClick(evt: MouseEvent) {
  const svg = evt.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || props.data.length === 0) return;
  const rel = (evt.clientX - rect.left) / rect.width;
  const index = Math.round(rel * (props.data.length - 1));
  emit("select", Math.max(0, Math.min(props.data.length - 1, index)));
}
</script>

<template>
  <div class="yagoo-winrate" role="img" :aria-label="t('graph.aria')">
    <svg
      class="yagoo-winrate__svg"
      :viewBox="`0 0 ${width} ${height}`"
      preserveAspectRatio="none"
      @click="onClick"
    >
      <line
        class="yagoo-winrate__grid"
        :x1="pad"
        :x2="width - pad"
        :y1="height / 2"
        :y2="height / 2"
      />
      <line
        v-for="m in deepMarkers"
        :key="`deep-${m.i}`"
        class="yagoo-winrate__deep"
        :x1="m.x"
        :x2="m.x"
        :y1="pad"
        :y2="height - pad"
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
      <path
        v-if="scoreLeadPath"
        class="yagoo-winrate__score"
        :d="scoreLeadPath"
      />
      <path v-if="pathD" class="yagoo-winrate__line" :d="pathD" />
      <circle
        class="yagoo-winrate__marker"
        :cx="marker.x"
        :cy="marker.y"
        r="3.2"
      />
    </svg>
  </div>
</template>
