<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import type { ReviewReportDocument } from "../report";
import { downloadReviewFile, ReviewExportSession, type ReviewExportFormat } from "../report";
import { reportNumber } from "../report/export";
import type { KeyMoveRow } from "./keyMoves";

const props = defineProps<{
  /** Legacy shell input; never used to infer played-move loss. */
  rows?: KeyMoveRow[];
  report: ReviewReportDocument | null;
  currentPly?: number;
}>();
const emit = defineEmits<{
  (e: "select", ply: number): void;
  (e: "close"): void;
  (e: "cancel"): void;
}>();
const exporting = ref(false);
const exportError = ref("");
let exportGeneration = 0;
const session = new ReviewExportSession(downloadReviewFile);
function cancelExport() {
  exportGeneration++;
  session.cancel();
  exporting.value = false;
}
watch(() => props.report, () => {
  cancelExport();
  exportError.value = "";
}, { flush: "sync" });
onBeforeUnmount(cancelExport);
async function exportReport(format: ReviewExportFormat) {
  if (!props.report) return;
  const generation = ++exportGeneration;
  exporting.value = true;
  exportError.value = "";
  try {
    await session.export(props.report, format);
  } catch {
    if (generation === exportGeneration) exportError.value = "Export failed. Please try again.";
  } finally {
    if (generation === exportGeneration) exporting.value = false;
  }
}
const showPlies = (values: number[]) => values.join(", ") || "none";
</script>

<template>
  <section class="yagoo-report" data-testid="review-report" aria-label="Automatic review">
    <header class="yagoo-report__header">
      <div>
        <h2>Automatic review</h2>
        <p class="yagoo-report__badge" role="status">{{ report?.status.replace("_", " ") ?? "No analysis loaded" }}</p>
      </div>
      <div class="yagoo-report__actions">
        <button data-testid="export-markdown" type="button" :disabled="!report" @click="exportReport('markdown')">Markdown</button>
        <button data-testid="export-html" type="button" :disabled="!report" @click="exportReport('html')">HTML</button>
        <button v-if="exporting" type="button" @click="cancelExport">Cancel export</button>
        <button v-if="report?.streamStatus === 'streaming'" data-testid="cancel-review" type="button" @click="emit('cancel')">Stop analysis</button>
        <button type="button" @click="emit('close')">Back to board</button>
      </div>
    </header>
    <p v-if="exportError" role="alert">{{ exportError }}</p>
    <p v-if="!report" class="yagoo-report__empty">Load recorded results or choose an engine and select Review to analyze this game.</p>
    <template v-else>
      <p>Source: {{ report.source }}</p>
      <dl class="yagoo-report__metadata">
        <template v-for="entry in report.metadata" :key="entry.label"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></template>
      </dl>
      <section aria-label="Coverage" data-testid="report-coverage">
        <h3>Coverage and overview</h3>
        <p>Completed positions {{ report.coverage.completedPositionPlies.length }}/{{ report.coverage.moveCount + 1 }}.
          Compared played moves {{ report.overview.comparedMoves }}/{{ report.coverage.moveCount }}.
          {{ report.overview.matchesPreferred }} match the preferred move.</p>
        <p>Sum of positive score differences on compared moves only:
          Black {{ reportNumber(report.overview.blackPositiveScoreLoss) }},
          White {{ reportNumber(report.overview.whitePositiveScoreLoss) }} points. This is not a full-game rating.</p>
        <p v-if="report.streamStatus === 'streaming'">Analysis is running. The report updates as completed comparisons arrive.</p>
        <p v-else-if="report.status !== 'complete'">Partial coverage. Missing comparisons cannot establish whether a move was good or bad.</p>
        <details><summary>Missing coverage</summary>
          <p>Positions: {{ showPlies(report.coverage.missingPositionPlies) }}</p>
          <p>Played-move comparisons: {{ showPlies(report.coverage.missingComparisonPlies) }}</p>
        </details>
      </section>
      <p v-if="report.opening">Catalogue opening: {{ report.opening.name }} ({{ report.opening.source }}).</p>
      <h3>Ranked compared moves</h3>
      <p>Signed score loss, then winrate loss, from the mover's perspective. Equality and negative search estimates remain visible.</p>
      <p v-if="!report.moves.length">No validated played-move comparisons are available.</p>
      <ol class="yagoo-report__list">
        <li v-for="row in report.moves" :key="row.ply" class="yagoo-report__move">
          <button type="button" class="yagoo-report__row"
            :class="{ 'yagoo-report__row--current': currentPly === row.ply }"
            :data-report-ply="row.ply" @click="emit('select', row.ply)">
            <strong>{{ row.rank }}. Move {{ row.ply }}: {{ row.mover }} {{ row.actualMove }}</strong>
            <span>Preferred {{ row.aiMove }} at root {{ row.rootPly }}</span>
            <span>Score loss {{ reportNumber(row.scoreLoss) }} points</span>
            <span>Winrate loss {{ reportNumber(row.winrateLoss * 100) }} pp</span>
          </button>
          <p>{{ row.explanation.text }}</p>
          <p class="yagoo-report__categories">{{ row.categories.map((c) => c.replaceAll("_", " ")).join(" · ") }}</p>
          <ul><li v-for="recommendation in row.recommendations" :key="recommendation.text">{{ recommendation.text }}</li></ul>
          <ul><li v-for="missing in row.missingEvidence" :key="missing">{{ missing }}</li></ul>
          <details><summary>Source facts and comparison limits</summary>
            <ul><li v-for="fact in row.facts" :key="fact.id">
              <strong>{{ fact.id }}</strong>: {{ fact.variants[0] }}
              <code v-for="evidence in fact.evidence" :key="evidence.path">{{ evidence.path }} = {{ JSON.stringify(evidence.value) }}</code>
            </li><li v-for="limit in row.comparison.evidence.limitations" :key="limit">{{ limit }}</li></ul>
          </details>
        </li>
      </ol>
      <section v-if="report.unassessedPlies.length">
        <h3>Unassessed scan leads</h3>
        <p>These plies were selected for analysis. Their unsigned swings do not establish played-move loss.</p>
        <button v-for="ply in report.unassessedPlies" :key="ply" type="button" :data-report-ply="ply" @click="emit('select', ply)">Move {{ ply }}</button>
      </section>
      <section><h3>Limits and provenance</h3><ul><li v-for="warning in report.warnings" :key="warning">{{ warning }}</li></ul></section>
    </template>
  </section>
</template>

<style scoped>
.yagoo-report{width:100%;height:100%;box-sizing:border-box;min-height:0;overflow:auto;padding:1.1rem 1.5rem 1.5rem;background:var(--yagoo-bg,#f6f6f7);color:var(--yagoo-text,#1a1a1a);line-height:1.5}
.yagoo-report__header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.75rem;align-items:flex-start}
.yagoo-report h2{margin:0;font-size:1.25rem}
.yagoo-report__badge{display:inline-block;margin:.35rem 0 0;padding:.12rem .45rem;border-radius:999px;background:var(--yagoo-accent-soft,#e4effb);font-size:.8rem;font-weight:700}
.yagoo-report__actions{display:flex;gap:.4rem;flex-wrap:wrap}
.yagoo-report button{border:1px solid var(--yagoo-border,#d0d0d6);background:var(--yagoo-panel,#fff);color:inherit;border-radius:4px;padding:.35rem .7rem;cursor:pointer}
.yagoo-report button:disabled{opacity:.45;cursor:not-allowed}
.yagoo-report__list{list-style:none;margin:0;padding:0;display:grid;gap:.8rem}
.yagoo-report__move{padding:.8rem;border:1px solid var(--yagoo-border,#d0d0d6);border-radius:8px;background:var(--yagoo-panel,#fff)}
.yagoo-report__row{display:grid;grid-template-columns:1fr 1fr;gap:.2rem .8rem;width:100%;text-align:left;font:inherit}
.yagoo-report__row--current{outline:2px solid var(--yagoo-accent,#0082f0)}
.yagoo-report__categories{font-size:.8rem;color:var(--yagoo-muted,#5c5c66)}
.yagoo-report__metadata{display:grid;grid-template-columns:auto 1fr;gap:.2rem 1rem}
.yagoo-report dt{font-weight:600}.yagoo-report dd{margin:0}
.yagoo-report code{display:block;overflow-wrap:anywhere;white-space:pre-wrap;font-size:.75rem}
@media(max-width:720px){.yagoo-report__row{grid-template-columns:1fr}}
</style>
