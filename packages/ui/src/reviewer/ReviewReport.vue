<script setup lang="ts">
import type { ReviewReportDocument } from "../analysis/modules";
import {
  formatDeltaPoints,
  formatWinratePoints,
  type KeyMoveRow,
} from "./keyMoves";

defineProps<{
  rows: KeyMoveRow[];
  /** Pipeline report. Null until #29 emits one. */
  report: ReviewReportDocument | null;
  currentPly?: number;
}>();

const emit = defineEmits<{
  (e: "select", ply: number): void;
  (e: "close"): void;
}>();
</script>

<template>
  <section class="yagoo-report" data-testid="review-report" aria-label="Automatic review">
    <header class="yagoo-report__header">
      <div>
        <h2>Automatic review</h2>
        <p v-if="report == null" class="yagoo-report__badge">Coming in #29</p>
        <p v-else class="yagoo-report__badge yagoo-report__badge--ready">
          Report attached
        </p>
      </div>
      <div class="yagoo-report__actions">
        <button type="button" disabled title="Export is part of #29">
          Export
        </button>
        <button type="button" @click="emit('close')">Back to board</button>
      </div>
    </header>

    <p class="yagoo-report__lead">
      The moves listed here are the swing plies the scan already selected for
      deepening. A written report — recommendation, why the move is worse,
      group trade-offs, sacrifices, and optional commentary — waits on
      #29. This view does not draft that text.
    </p>

    <pre v-if="report?.markdown" class="yagoo-report__markdown">{{
      report.markdown
    }}</pre>

    <p v-if="rows.length === 0" class="yagoo-report__empty">
      No swing moves selected yet. They show up here after
      <code>deepPliesSelected</code>.
    </p>

    <ol v-else class="yagoo-report__list">
      <li v-for="row in rows" :key="row.ply">
        <button
          type="button"
          class="yagoo-report__row"
          :class="{ 'yagoo-report__row--current': currentPly === row.ply }"
          :data-report-ply="row.ply"
          @click="emit('select', row.ply)"
        >
          <span class="yagoo-report__ply">Move {{ row.ply }}</span>
          <span>ΔWR {{ formatWinratePoints(row.winrateDelta) }}</span>
          <span>Δscore {{ formatDeltaPoints(row.scoreLeadDelta) }}</span>
          <span>
            Top candidate
            {{ row.topMove ?? "—" }}
          </span>
          <span class="yagoo-report__gaps">
            Why #24 · Ledger #23 · Sacrifice #25 · Notes #28
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.yagoo-report {
  min-height: 0;
  overflow: auto;
  padding: 1.1rem 1.25rem 1.5rem;
  background: var(--yagoo-bg, #f6f6f7);
  color: var(--yagoo-text, #1a1a1a);
}

.yagoo-report__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
}

.yagoo-report h2 {
  margin: 0;
  font-size: 1.25rem;
}

.yagoo-report__badge {
  display: inline-block;
  margin: 0.35rem 0 0;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: var(--yagoo-accent-soft, rgba(0, 130, 240, 0.12));
  color: var(--yagoo-accent, #0066cc);
  font-size: 0.75rem;
  font-weight: 700;
}

.yagoo-report__badge--ready {
  background: var(--yagoo-success-soft, rgba(46, 125, 50, 0.12));
  color: var(--yagoo-success, #1b7a32);
}

.yagoo-report__actions {
  display: flex;
  gap: 0.4rem;
}

.yagoo-report__actions button {
  border: 1px solid var(--yagoo-border, #d0d0d6);
  background: var(--yagoo-panel, #fff);
  color: inherit;
  border-radius: 4px;
  padding: 0.35rem 0.7rem;
  cursor: pointer;
}

.yagoo-report__actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.yagoo-report__lead,
.yagoo-report__empty {
  max-width: 46rem;
  color: var(--yagoo-muted, #4a4a55);
  line-height: 1.45;
  font-size: 0.92rem;
}

.yagoo-report__markdown {
  white-space: pre-wrap;
  padding: 0.75rem;
  background: var(--yagoo-panel, #fff);
  border: 1px solid var(--yagoo-border, #d0d0d6);
  border-radius: 6px;
}

.yagoo-report__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.45rem;
  max-width: 52rem;
}

.yagoo-report__row {
  display: grid;
  grid-template-columns: 6.5rem 8.5rem 8rem 1fr;
  gap: 0.15rem 0.75rem;
  width: 100%;
  text-align: left;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--yagoo-border, #d0d0d6);
  border-radius: 8px;
  background: var(--yagoo-panel, #fff);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.yagoo-report__row--current {
  border-color: var(--yagoo-accent, #0082f0);
}

.yagoo-report__ply {
  font-weight: 700;
}

.yagoo-report__gaps {
  grid-column: 1 / -1;
  color: var(--yagoo-muted, #5c5c66);
  font-size: 0.78rem;
}

@media (max-width: 720px) {
  .yagoo-report__row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
