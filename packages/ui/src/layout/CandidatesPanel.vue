<script setup lang="ts">
import {
  candidateVisibleOnBoard,
} from "../analysis/display";
import type { CandidateSnapshot } from "../analysis/types";

const props = withDefaults(
  defineProps<{
    candidates: CandidateSnapshot[];
    /** Root visits at this ply — used to dim sub-threshold rows. */
    rootVisits?: number | null;
    /** Index currently previewing PV (hover / tap). */
    previewIndex?: number | null;
    /** Persistently selected / best highlight. */
    selectedIndex?: number;
    /** Fill the parent scroller instead of capping height. */
    embedded?: boolean;
  }>(),
  {
    rootVisits: null,
    previewIndex: null,
    selectedIndex: 0,
    embedded: false,
  },
);

const emit = defineEmits<{
  (e: "preview", index: number): void;
  (e: "clear-preview"): void;
  (e: "toggle", index: number): void;
  (e: "select", index: number): void;
}>();

function formatWr(c: CandidateSnapshot): string {
  return c.winrate != null ? `${(c.winrate * 100).toFixed(1)}%` : "—";
}

function formatVisits(c: CandidateSnapshot): string {
  if (c.visits == null) return "—";
  return c.visits >= 1000
    ? `${(c.visits / 1000).toFixed(1)}k`
    : String(c.visits);
}

function orderClass(idx: number): string {
  const order = props.candidates[idx]?.order ?? idx;
  if (order === 0) return "yagoo-candidates__row--good";
  if (order === 1) return "yagoo-candidates__row--interesting";
  if (order === 2) return "yagoo-candidates__row--doubtful";
  return "yagoo-candidates__row--bad";
}

function isDimmed(c: CandidateSnapshot): boolean {
  return !candidateVisibleOnBoard(c, props.rootVisits);
}

const visibleCount = () => Math.min(8, props.candidates.length);

function onRowKey(event: KeyboardEvent, idx: number) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === "ArrowDown" ? idx + 1 : idx - 1;
    if (next < 0 || next >= visibleCount()) return;
    emit("preview", next);
    emit("select", next);
    const row = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(
      `[data-candidate-index="${next}"]`,
    );
    row?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("toggle", idx);
    emit("select", idx);
  }
}
</script>

<template>
  <div
    class="yagoo-candidates"
    :class="{ 'yagoo-candidates--embedded': embedded }"
    data-testid="candidates-panel"
  >
    <div class="yagoo-candidates__title">Candidates</div>
    <ul
      v-if="candidates.length"
      class="yagoo-candidates__list"
      role="listbox"
      aria-label="Candidate moves"
    >
      <li
        v-for="(c, idx) in candidates.slice(0, 8)"
        :key="`${c.move}-${idx}`"
        class="yagoo-candidates__row"
        role="option"
        :aria-selected="selectedIndex === idx"
        :tabindex="selectedIndex === idx ? 0 : -1"
        @keydown="onRowKey($event, idx)"
        :class="[
          orderClass(idx),
          {
            'yagoo-candidates__row--preview': previewIndex === idx,
            'yagoo-candidates__row--selected': selectedIndex === idx,
            'yagoo-candidates__row--dim': isDimmed(c),
          },
        ]"
        :data-candidate-index="idx"
        :data-candidate-dim="isDimmed(c) ? '1' : '0'"
        @mouseenter="emit('preview', idx)"
        @mouseleave="emit('clear-preview')"
        @click="emit('toggle', idx); emit('select', idx)"
      >
        <span class="yagoo-candidates__dot" aria-hidden="true" />
        <span class="yagoo-candidates__move">{{ c.move }}</span>
        <span class="yagoo-candidates__wr">{{ formatWr(c) }}</span>
        <span class="yagoo-candidates__visits">{{ formatVisits(c) }}</span>
      </li>
    </ul>
    <p v-else class="yagoo-candidates__empty">No candidates at this ply.</p>
  </div>
</template>

<style scoped>
.yagoo-candidates {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 40%;
  overflow: auto;
  background: var(--yagoo-panel, #181818);
  border-top: 1px solid var(--yagoo-border, #2a2a2a);
  border-bottom: 1px solid var(--yagoo-border, #2a2a2a);
  font-size: 0.8rem;
  color: var(--yagoo-text, #eee);
}

.yagoo-candidates--embedded {
  max-height: none;
  border: none;
  background: transparent;
}

.yagoo-candidates__title {
  padding: 0.4rem 0.65rem 0.25rem;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--yagoo-muted, #9a9a9a);
}

.yagoo-candidates__list {
  list-style: none;
  margin: 0;
  padding: 0 0 0.35rem;
}

.yagoo-candidates__row {
  display: grid;
  grid-template-columns: 0.7rem 2.4rem 1fr auto;
  gap: 0.35rem 0.5rem;
  align-items: center;
  padding: 0.28rem 0.65rem;
  cursor: pointer;
  color: var(--yagoo-text, #ddd);
}

.yagoo-candidates__row:hover,
.yagoo-candidates__row--preview {
  background: var(--yagoo-hover, #222);
}

.yagoo-candidates__row--selected {
  outline: 1px solid var(--yagoo-accent, #0082f0);
  outline-offset: -1px;
}

.yagoo-candidates__row--dim {
  opacity: 0.45;
}

.yagoo-candidates__dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: #4886d5;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.yagoo-candidates__row--good .yagoo-candidates__dot {
  background: #59a80f;
}
.yagoo-candidates__row--interesting .yagoo-candidates__dot {
  background: #4886d5;
}
.yagoo-candidates__row--doubtful .yagoo-candidates__dot {
  background: #92278f;
}
.yagoo-candidates__row--bad .yagoo-candidates__dot {
  background: #f02311;
}

.yagoo-candidates__move {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.yagoo-candidates__wr {
  font-variant-numeric: tabular-nums;
  color: var(--yagoo-text, #eee);
}

.yagoo-candidates__visits {
  font-variant-numeric: tabular-nums;
  color: var(--yagoo-muted, #9a9a9a);
  font-size: 0.75rem;
}

.yagoo-candidates__empty {
  margin: 0;
  padding: 0.5rem 0.65rem 0.75rem;
  color: var(--yagoo-muted, #777);
  font-size: 0.78rem;
}
</style>
