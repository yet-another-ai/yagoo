<script setup lang="ts">
import { computed } from "vue";
import {
  candidateVisibleOnBoard,
  candidateVisitsReliable,
  candidateWinrateAuthoritative,
  topCandidateVisits,
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

const topVisits = computed(() => topCandidateVisits(props.candidates));

function reliable(c: CandidateSnapshot): boolean {
  return candidateVisitsReliable(c, topVisits.value);
}

function authoritative(c: CandidateSnapshot): boolean {
  return candidateWinrateAuthoritative(c, topVisits.value);
}

const listed = computed(() => {
  const rows = props.candidates.map((candidate, index) => ({
    candidate,
    index,
  }));
  const strong = rows.filter((row) => reliable(row.candidate));
  // Early searches can be entirely under the visit floor. Show them, but
  // still withhold the unsettled winrate.
  const source = strong.length > 0 ? strong : rows;
  return source.slice(0, 8);
});

const focusIndex = computed(() => {
  if (listed.value.some((row) => row.index === props.selectedIndex)) {
    return props.selectedIndex;
  }
  return listed.value[0]?.index ?? -1;
});

const hiddenLow = computed(() => {
  if (listed.value.length === 0) return 0;
  const shown = new Set(listed.value.map((row) => row.index));
  return props.candidates.filter(
    (candidate, index) => !shown.has(index) && !reliable(candidate),
  ).length;
});

function formatWr(c: CandidateSnapshot): string {
  if (!authoritative(c)) return "low";
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

function onRowKey(event: KeyboardEvent, position: number) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === "ArrowDown" ? position + 1 : position - 1;
    const row = listed.value[next];
    if (row == null) return;
    emit("preview", row.index);
    emit("select", row.index);
    const el = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(
      `[data-candidate-index="${row.index}"]`,
    );
    el?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const row = listed.value[position];
    if (row == null) return;
    emit("toggle", row.index);
    emit("select", row.index);
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
        v-for="(row, position) in listed"
        :key="`${row.candidate.move}-${row.index}`"
        class="yagoo-candidates__row"
        role="option"
        :aria-selected="selectedIndex === row.index"
        :tabindex="focusIndex === row.index ? 0 : -1"
        @keydown="onRowKey($event, position)"
        :class="[
          orderClass(row.index),
          {
            'yagoo-candidates__row--preview': previewIndex === row.index,
            'yagoo-candidates__row--selected': selectedIndex === row.index,
            'yagoo-candidates__row--dim': isDimmed(row.candidate),
            'yagoo-candidates__row--low': !authoritative(row.candidate),
          },
        ]"
        :data-candidate-index="row.index"
        :data-candidate-dim="isDimmed(row.candidate) ? '1' : '0'"
        :data-winrate-authoritative="authoritative(row.candidate) ? '1' : '0'"
        @mouseenter="emit('preview', row.index)"
        @mouseleave="emit('clear-preview')"
        @click="emit('toggle', row.index); emit('select', row.index)"
      >
        <span class="yagoo-candidates__dot" aria-hidden="true" />
        <span class="yagoo-candidates__move">{{ row.candidate.move }}</span>
        <span
          class="yagoo-candidates__wr"
          :class="{ 'yagoo-candidates__wr--low': !authoritative(row.candidate) }"
          :title="
            authoritative(row.candidate)
              ? undefined
              : 'Too few visits to treat this winrate as a result'
          "
        >{{ formatWr(row.candidate) }}</span>
        <span class="yagoo-candidates__visits">{{ formatVisits(row.candidate) }}</span>
      </li>
    </ul>
    <p v-if="hiddenLow" class="yagoo-candidates__low" data-testid="low-visit-note">
      {{ hiddenLow }} low-visit
      {{ hiddenLow === 1 ? "move" : "moves" }} hidden. Winrate is withheld
      under 5% of the top move's visits.
    </p>
    <p v-else-if="!candidates.length" class="yagoo-candidates__empty">No candidates at this ply.</p>
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
  grid-template-columns: 0.75rem minmax(2.8rem, auto) minmax(3.4rem, 1fr) auto;
  gap: 0.35rem 0.65rem;
  align-items: center;
  padding: 0.38rem 0.75rem;
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

.yagoo-candidates__row--dim,
.yagoo-candidates__row--low {
  opacity: 0.55;
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

.yagoo-candidates__wr--low {
  color: var(--yagoo-muted, #9a9a9a);
  font-style: italic;
  font-weight: 500;
}

.yagoo-candidates__visits {
  font-variant-numeric: tabular-nums;
  color: var(--yagoo-muted, #9a9a9a);
  font-size: 0.75rem;
}

.yagoo-candidates__low {
  margin: 0;
  padding: 0.15rem 0.75rem 0.55rem;
  color: var(--yagoo-muted, #9a9a9a);
  font-size: 0.75rem;
  line-height: 1.35;
}

.yagoo-candidates__empty {
  margin: 0;
  padding: 0.5rem 0.65rem 0.75rem;
  color: var(--yagoo-muted, #777);
  font-size: 0.78rem;
}
</style>
