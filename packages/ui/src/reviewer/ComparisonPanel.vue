<script setup lang="ts">
import { computed } from "vue";
import type { GainLossLine, MoveComparison } from "../analysis/modules";
import LedgerPanel from "./LedgerPanel.vue";

const props = withDefaults(defineProps<{
  comparison: MoveComparison;
  showDifference?: boolean;
}>(), { showDifference: true });
const emit = defineEmits<{
  (e: "preview", line: GainLossLine): void;
  (e: "preview-stones", stones: string[]): void;
  (e: "clear-preview"): void;
  (e: "toggle-difference", enabled: boolean): void;
}>();
const transitions = computed(() => props.comparison.groupTempo.filter(
  (entry) => entry.actualStatus !== entry.preferredStatus,
));
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const points = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
</script>

<template>
  <section class="yagoo-comparison" data-testid="comparison-body">
    <p>
      Move {{ comparison.ply }} · {{ comparison.mover === "B" ? "Black" : "White" }}
      · before-move board (ply {{ comparison.rootPly }}).
      A = actual, AI = preferred.
    </p>
    <p v-if="comparison.actualMove === comparison.aiMove" data-testid="comparison-equal">
      The played move matches the preferred move. Both columns use the same branch.
    </p>
    <table>
      <thead><tr><th></th><th>Actual {{ comparison.actualMove }}</th><th>AI {{ comparison.aiMove }}</th></tr></thead>
      <tbody>
        <tr><th>Mover winrate</th><td>{{ percent(comparison.actualWinrate) }}</td><td>{{ percent(comparison.aiWinrate) }}</td></tr>
        <tr><th>Black score lead</th><td>{{ points(comparison.actualScoreLead) }}</td><td>{{ points(comparison.aiScoreLead) }}</td></tr>
        <tr><th>Candidate visits</th><td>{{ comparison.evidence.actualVisits ?? "—" }}</td><td>{{ comparison.evidence.aiVisits ?? "—" }}</td></tr>
      </tbody>
    </table>
    <p data-testid="comparison-loss">
      Estimated loss for {{ comparison.mover === "B" ? "Black" : "White" }}:
      {{ points(comparison.scoreLoss) }} points,
      {{ points(comparison.winrateLoss * 100) }} percentage points.
    </p>
    <p class="yagoo-comparison__note">
      Actual evidence: {{ comparison.evidence.actualSource === "forced" ? "restricted same-root search" : "root candidate" }}.
      Root visits {{ comparison.evidence.rootVisits ?? "—" }};
      requested {{ comparison.evidence.requestedVisits }}.
    </p>
    <label>
      <input type="checkbox" data-testid="comparison-difference" :checked="showDifference"
        @change="emit('toggle-difference', ($event.target as HTMLInputElement).checked)" />
      Show ownership difference
    </label>
    <p class="yagoo-comparison__note">
      Actual minus AI ownership: dark favors Black, light favors White.
      Opacity uses half the difference (range −2 to +2). Both maps use this same root.
    </p>
    <LedgerPanel v-if="comparison.ledgerDiff" :ledger="comparison.ledgerDiff"
      :tempo-evidence-available="comparison.groupTempo.length > 0"
      @preview="emit('preview', $event)" @clear-preview="emit('clear-preview')" />
    <p v-else>The root ledger is unavailable.</p>
    <details data-testid="comparison-tempo">
      <summary>Branch status evidence ({{ comparison.groupTempo.length }} group/color pairs)</summary>
      <p class="yagoo-comparison__note">
        Fixed root stone coordinates, evaluated with each branch's own root and pass probe.
        These status changes do not establish sente or gote.
      </p>
      <p v-if="comparison.groupTempo.length === 0">Status transitions are unassessed: branch/pass evidence is missing.</p>
      <p v-else-if="transitions.length === 0">These probes show no status changes between the two branches.</p>
      <ul v-else>
        <li v-for="entry in transitions" :key="`${entry.groupId}-${entry.color}`">
          <button type="button" @mouseenter="emit('preview-stones', entry.stones)"
            @focus="emit('preview-stones', entry.stones)" @mouseleave="emit('clear-preview')"
            @blur="emit('clear-preview')">
            {{ entry.groupId }} {{ entry.color }}:
            AI {{ entry.preferredStatus }} → actual {{ entry.actualStatus }}
          </button>
        </li>
      </ul>
    </details>
    <details>
      <summary>Evidence and limits</summary>
      <p>{{ comparison.evidence.rootQueryId }} / {{ comparison.evidence.actualQueryId }}</p>
      <ul><li v-for="limit in comparison.evidence.limitations" :key="limit">{{ limit }}</li></ul>
    </details>
  </section>
</template>

<style scoped>
.yagoo-comparison { padding: 0.4rem 0.7rem; font-size: 0.8rem; }
.yagoo-comparison table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.yagoo-comparison th, .yagoo-comparison td { text-align: left; padding: 0.3rem; border-bottom: 1px solid var(--yagoo-border, #ddd); }
.yagoo-comparison__note { color: var(--yagoo-muted, #5c5c66); }
.yagoo-comparison details { margin: 0.6rem 0; }
.yagoo-comparison button { color: var(--yagoo-accent, #0066cc); background: none; border: 0; font: inherit; cursor: pointer; text-align: left; }
</style>
