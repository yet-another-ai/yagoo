<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { presentError, presentSource, useYagooI18n } from "../i18n";
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
const { t } = useYagooI18n();
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
    if (generation === exportGeneration) exportError.value = "report.exportFailed";
  } finally {
    if (generation === exportGeneration) exporting.value = false;
  }
}
const showPlies = (values: number[]) => values.join(", ") || t("report.none");
</script>

<template>
  <section class="yagoo-report" data-testid="review-report" :aria-label="t('report.aria')">
    <header class="yagoo-report__header">
      <div>
        <h2>{{ t("report.title") }}</h2>
        <p class="yagoo-report__badge" role="status">{{ report ? t(`report.status.${report.status}`) : t("report.noAnalysis") }}</p>
      </div>
      <div class="yagoo-report__actions">
        <button data-testid="export-markdown" type="button" :disabled="!report" @click="exportReport('markdown')">{{ t("report.markdown") }}</button>
        <button data-testid="export-html" type="button" :disabled="!report" @click="exportReport('html')">{{ t("report.html") }}</button>
        <button v-if="exporting" type="button" @click="cancelExport">{{ t("report.cancelExport") }}</button>
        <button v-if="report?.streamStatus === 'streaming'" data-testid="cancel-review" type="button" @click="emit('cancel')">{{ t("report.stop") }}</button>
        <button type="button" @click="emit('close')">{{ t("report.back") }}</button>
      </div>
    </header>
    <p v-if="exportError" role="alert">{{ t(exportError) }}</p>
    <p v-if="!report" class="yagoo-report__empty">{{ t("report.empty") }}</p>
    <template v-else>
      <p>{{ t("report.source", { source: presentSource(report.source) }) }}</p>
      <dl class="yagoo-report__metadata">
        <template v-for="entry in report.metadata" :key="entry.label"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></template>
      </dl>
      <section :aria-label="t('report.coverageAria')" data-testid="report-coverage">
        <h3>{{ t("report.coverageTitle") }}</h3>
        <p>{{ t("report.coverage", { done: report.coverage.completedPositionPlies.length, total: report.coverage.moveCount + 1, compared: report.overview.comparedMoves, moves: report.coverage.moveCount, matches: report.overview.matchesPreferred }) }}</p>
        <p>{{ t("report.scoreSum", { black: reportNumber(report.overview.blackPositiveScoreLoss), white: reportNumber(report.overview.whitePositiveScoreLoss) }) }}</p>
        <p v-if="report.streamStatus === 'streaming'">{{ t("report.running") }}</p>
        <p v-else-if="report.status === 'empty'" class="yagoo-report__empty">{{ t("report.noPositions") }}</p>
        <p v-else-if="report.status === 'partial'">{{ t("report.partial") }}</p>
        <details><summary>{{ t("report.missing") }}</summary>
          <p>{{ t("report.missingPositions", { plies: showPlies(report.coverage.missingPositionPlies) }) }}</p>
          <p>{{ t("report.missingComparisons", { plies: showPlies(report.coverage.missingComparisonPlies) }) }}</p>
        </details>
      </section>
      <p v-if="report.opening">{{ t("report.opening", { name: report.opening.name, source: report.opening.source }) }}</p>
      <h3>{{ t("report.ranked") }}</h3>
      <p>{{ t("report.rankedNote") }}</p>
      <p v-if="!report.moves.length">{{ t("report.noMoves") }}</p>
      <ol class="yagoo-report__list">
        <li v-for="row in report.moves" :key="row.ply" class="yagoo-report__move">
          <button type="button" class="yagoo-report__row"
            :class="{ 'yagoo-report__row--current': currentPly === row.ply }"
            :data-report-ply="row.ply" @click="emit('select', row.ply)">
            <strong>{{ t("report.move", { rank: row.rank, ply: row.ply, mover: row.mover, actual: row.actualMove }) }}</strong>
            <span>{{ t("report.preferred", { move: row.aiMove, root: row.rootPly }) }}</span>
            <span>{{ t("report.scoreLoss", { value: reportNumber(row.scoreLoss) }) }}</span>
            <span>{{ t("report.winrateLoss", { value: reportNumber(row.winrateLoss * 100) }) }}</span>
          </button>
          <p>{{ row.explanation.text }}</p>
          <section v-for="section in row.evidenceSections" :key="section.id"
            class="yagoo-report__evidence-section" :data-report-evidence="section.id">
            <h4>{{ section.title }}</h4>
            <p v-if="section.emptyMessage">{{ section.emptyMessage }}</p>
            <ul v-if="section.facts.length" class="yagoo-report__evidence-facts">
              <li v-for="fact in section.facts" :key="fact.id" :data-report-fact="fact.id">
                <p>{{ fact.variants[0] }}</p>
                <details>
                  <summary>{{ t("report.evidence") }}</summary>
                  <code v-for="evidence in fact.evidence" :key="evidence.path">{{ evidence.path }} = {{ JSON.stringify(evidence.value) }}</code>
                </details>
              </li>
            </ul>
            <p v-if="section.omittedFacts > 0" class="yagoo-report__omitted">
              {{ t("report.omitted", { count: section.omittedFacts, noun: section.omittedFacts === 1 ? t("report.fact") : t("report.facts") }) }}
            </p>
          </section>
          <p class="yagoo-report__categories">{{ row.categories.map((c) => c.replaceAll("_", " ")).join(" · ") }}</p>
          <ul><li v-for="recommendation in row.recommendations" :key="recommendation.text">{{ recommendation.text }}</li></ul>
          <ul><li v-for="missing in row.missingEvidence" :key="missing">{{ missing }}</li></ul>
          <details><summary>{{ t("report.limits") }}</summary>
            <ul><li v-for="fact in row.facts" :key="fact.id">
              <strong>{{ fact.id }}</strong>: {{ fact.variants[0] }}
              <code v-for="evidence in fact.evidence" :key="evidence.path">{{ evidence.path }} = {{ JSON.stringify(evidence.value) }}</code>
            </li><li v-for="limit in row.comparison.evidence.limitations" :key="limit">{{ limit }}</li></ul>
          </details>
        </li>
      </ol>
      <section v-if="report.unassessedPlies.length">
        <h3>{{ t("report.unassessed") }}</h3>
        <p>{{ t("report.unassessedNote") }}</p>
        <button v-for="ply in report.unassessedPlies" :key="ply" type="button" :data-report-ply="ply" @click="emit('select', ply)">{{ t("report.unassessedMove", { ply }) }}</button>
      </section>
      <section><h3>{{ t("report.provenance") }}</h3><ul><li v-for="warning in report.warnings" :key="warning">{{ presentError(warning) }}</li></ul></section>
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
.yagoo-report__evidence-section{margin:.85rem 0}
.yagoo-report__evidence-section h4{margin:0 0 .35rem;font-size:.95rem}
.yagoo-report__evidence-facts{margin:0;padding-left:1.2rem}
.yagoo-report__evidence-facts li{margin:.45rem 0}
.yagoo-report__evidence-facts p{margin:.2rem 0}
.yagoo-report__evidence-facts details,.yagoo-report__omitted{font-size:.8rem;color:var(--yagoo-muted,#5c5c66)}
.yagoo-report__metadata{display:grid;grid-template-columns:auto 1fr;gap:.2rem 1rem}
.yagoo-report dt{font-weight:600}.yagoo-report dd{margin:0}
.yagoo-report code{display:block;overflow-wrap:anywhere;white-space:pre-wrap;font-size:.75rem}
@media(max-width:720px){.yagoo-report__row{grid-template-columns:1fr}}
</style>
