<script setup lang="ts">
import {
  groupPrimaryColor,
  groupStatusLabel,
  groupStoneCount,
  groupValueLabel,
} from "../analysis/groups";
import type { GroupSnapshot } from "../analysis/types";

const props = defineProps<{
  groups: GroupSnapshot[];
  previewId?: string | null;
  selectedId?: string | null;
}>();

const emit = defineEmits<{
  (e: "preview", groupId: string): void;
  (e: "clear-preview"): void;
  (e: "select", groupId: string): void;
}>();

function swatchClass(g: GroupSnapshot): string {
  const c = groupPrimaryColor(g);
  if (c === "mixed") return "yagoo-groups__swatch--mixed";
  if (c === "W") return "yagoo-groups__swatch--white";
  return "yagoo-groups__swatch--black";
}

function statusClass(g: GroupSnapshot): string {
  return g.status ? `yagoo-groups__status--${g.status}` : "";
}
</script>

<template>
  <div class="yagoo-groups" data-testid="groups-panel">
    <div class="yagoo-groups__title">Groups / 块</div>
    <ul v-if="groups.length" class="yagoo-groups__list">
      <li
        v-for="g in groups"
        :key="g.groupId"
        class="yagoo-groups__row"
        :class="{
          'yagoo-groups__row--preview': previewId === g.groupId,
          'yagoo-groups__row--selected': selectedId === g.groupId,
        }"
        :data-group-id="g.groupId"
        @mouseenter="emit('preview', g.groupId)"
        @mouseleave="emit('clear-preview')"
        @click="emit('select', g.groupId)"
      >
        <span class="yagoo-groups__swatch" :class="swatchClass(g)" />
        <span class="yagoo-groups__id">{{ g.groupId }}</span>
        <span class="yagoo-groups__meta">
          <span class="yagoo-groups__kind">{{ g.kind }}</span>
          <span class="yagoo-groups__size">{{ groupStoneCount(g) }}st</span>
        </span>
        <span class="yagoo-groups__status" :class="statusClass(g)">
          {{ groupStatusLabel(g.status) }}
        </span>
        <span class="yagoo-groups__value">{{ groupValueLabel(g) }}</span>
      </li>
    </ul>
    <p v-else class="yagoo-groups__empty">
      No groups (块) at this ply — deepen a swing position for fate clustering.
    </p>
  </div>
</template>

<style scoped>
.yagoo-groups {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 32%;
  overflow: auto;
  background: var(--yagoo-panel, #181818);
  border-top: 1px solid #2a2a2a;
  border-bottom: 1px solid #2a2a2a;
  font-size: 0.78rem;
}

.yagoo-groups__title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.65rem 0.25rem;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #9a9a9a;
}

.yagoo-groups__list {
  list-style: none;
  margin: 0;
  padding: 0 0 0.35rem;
}

.yagoo-groups__row {
  display: grid;
  grid-template-columns: 0.7rem 2rem 1fr auto;
  grid-template-rows: auto auto;
  gap: 0.1rem 0.45rem;
  align-items: center;
  padding: 0.3rem 0.65rem;
  cursor: pointer;
  color: #ddd;
}

.yagoo-groups__row:hover,
.yagoo-groups__row--preview {
  background: #222;
}

.yagoo-groups__row--selected {
  outline: 1px solid #0082f0;
  outline-offset: -1px;
}

.yagoo-groups__swatch {
  grid-row: 1 / 3;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
}

.yagoo-groups__swatch--black {
  background: #222;
}
.yagoo-groups__swatch--white {
  background: #eee;
}
.yagoo-groups__swatch--mixed {
  background: linear-gradient(135deg, #222 50%, #eee 50%);
}

.yagoo-groups__id {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.yagoo-groups__meta {
  display: flex;
  gap: 0.4rem;
  color: #9a9a9a;
  font-size: 0.72rem;
}

.yagoo-groups__status {
  grid-column: 3;
  font-size: 0.72rem;
  color: #bbb;
}

.yagoo-groups__status--dead {
  color: #f56c5f;
  font-weight: 650;
}
.yagoo-groups__status--weak,
.yagoo-groups__status--tempo_critical {
  color: #f0a000;
  font-weight: 650;
}
.yagoo-groups__status--settled {
  color: #7dcea0;
}
.yagoo-groups__status--likely_seki {
  color: #c39bd3;
}

.yagoo-groups__value {
  grid-column: 4;
  grid-row: 1 / 3;
  font-variant-numeric: tabular-nums;
  color: #ccc;
  font-size: 0.72rem;
  text-align: right;
}

.yagoo-groups__empty {
  margin: 0;
  padding: 0.5rem 0.65rem 0.75rem;
  color: #777;
  font-size: 0.75rem;
  line-height: 1.35;
}
</style>
