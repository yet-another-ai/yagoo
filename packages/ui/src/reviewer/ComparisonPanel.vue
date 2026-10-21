<script setup lang="ts">
import { computed } from "vue";
import { groupStatusLabel } from "../analysis/groups";
import type { GainLossLine, MoveComparison } from "../analysis/modules";
import { useYagooI18n } from "../i18n";
import LedgerPanel from "./LedgerPanel.vue";

const { t } = useYagooI18n();

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
const playedTempo = computed(() => props.comparison.playedTempo ?? []);
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const points = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
</script>

<template>
  <section class="yagoo-comparison" data-testid="comparison-body">
    <p>
      {{ t("comparison.context", { ply: comparison.ply, mover: comparison.mover === "B" ? t("color.black") : t("color.white"), root: comparison.rootPly }) }}
    </p>
    <h3>{{ t("comparison.title") }}</h3>
    <p v-if="comparison.actualMove === comparison.aiMove" data-testid="comparison-equal">
      {{ t("comparison.equal") }}
    </p>
    <table>
      <thead><tr><th></th><th>{{ t("comparison.actual", { move: comparison.actualMove }) }}</th><th>{{ t("comparison.ai", { move: comparison.aiMove }) }}</th></tr></thead>
      <tbody>
        <tr><th>{{ t("comparison.moverWinrate") }}</th><td>{{ percent(comparison.actualWinrate) }}</td><td>{{ percent(comparison.aiWinrate) }}</td></tr>
        <tr><th>{{ t("comparison.scoreLead") }}</th><td>{{ points(comparison.actualScoreLead) }}</td><td>{{ points(comparison.aiScoreLead) }}</td></tr>
        <tr><th>{{ t("comparison.visits") }}</th><td>{{ comparison.evidence.actualVisits ?? "—" }}</td><td>{{ comparison.evidence.aiVisits ?? "—" }}</td></tr>
      </tbody>
    </table>
    <p data-testid="comparison-loss">
      {{ t("comparison.loss", { mover: comparison.mover === "B" ? t("color.black") : t("color.white"), score: points(comparison.scoreLoss), winrate: points(comparison.winrateLoss * 100) }) }}
    </p>
    <p class="yagoo-comparison__note">
      {{ t("comparison.evidence", { source: comparison.evidence.actualSource === "forced" ? t("comparison.sourceForced") : t("comparison.sourceRoot"), root: comparison.evidence.rootVisits ?? "—", requested: comparison.evidence.requestedVisits }) }}
    </p>
    <label>
      <input type="checkbox" data-testid="comparison-difference" :checked="showDifference"
        @change="emit('toggle-difference', ($event.target as HTMLInputElement).checked)" />
      {{ t("comparison.difference") }}
    </label>
    <p class="yagoo-comparison__note">
      {{ t("comparison.differenceNote") }}
    </p>
    <LedgerPanel v-if="comparison.ledgerDiff" :ledger="comparison.ledgerDiff"
      :tempo-evidence-available="comparison.groupTempo.length > 0"
      @preview="emit('preview', $event)" @clear-preview="emit('clear-preview')" />
    <p v-else>{{ t("comparison.noLedger") }}</p>
    <details data-testid="comparison-tempo">
      <summary>{{ t("comparison.tempoSummary", { count: comparison.groupTempo.length }) }}</summary>
      <p class="yagoo-comparison__note">
        {{ t("comparison.tempoNote") }}
      </p>
      <p v-if="comparison.groupTempo.length === 0">{{ t("comparison.tempoMissing") }}</p>
      <p v-else-if="transitions.length === 0">{{ t("comparison.tempoNone") }}</p>
      <ul v-else>
        <li v-for="entry in transitions" :key="`${entry.groupId}-${entry.color}`">
          <button type="button" @mouseenter="emit('preview-stones', entry.stones)"
            @focus="emit('preview-stones', entry.stones)" @mouseleave="emit('clear-preview')"
            @blur="emit('clear-preview')">
            {{ t("comparison.tempoRow", { group: entry.groupId, color: entry.color, preferred: groupStatusLabel(entry.preferredStatus), actual: groupStatusLabel(entry.actualStatus) }) }}
          </button>
        </li>
      </ul>
    </details>
    <section class="yagoo-comparison__played" data-testid="comparison-played">
      <h3>{{ t("comparison.playedTitle") }}</h3>
      <LedgerPanel v-if="comparison.playedLedger" :ledger="comparison.playedLedger"
        :tempo-evidence-available="playedTempo.length > 0" tempo-comparison="played"
        @preview="emit('preview', $event)" @clear-preview="emit('clear-preview')" />
      <p v-else data-testid="comparison-played-unavailable">
        {{ t("comparison.playedUnavailable") }}
      </p>
      <details data-testid="comparison-played-tempo">
        <summary>{{ t("comparison.playedTempoSummary", { count: playedTempo.length }) }}</summary>
        <p class="yagoo-comparison__note">
          {{ t("comparison.playedTempoNote", { move: comparison.actualMove }) }}
        </p>
        <p v-if="playedTempo.length === 0" data-testid="comparison-played-tempo-unavailable">
          {{ t("comparison.playedTempoMissing") }}
        </p>
        <ul v-else>
          <li v-for="entry in playedTempo" :key="`${entry.groupId}-${entry.color}`">
            <button type="button" :data-played-tempo-group="entry.groupId" :data-played-tempo-color="entry.color"
              @mouseenter="emit('preview-stones', entry.stones)"
              @focus="emit('preview-stones', entry.stones)" @mouseleave="emit('clear-preview')"
              @blur="emit('clear-preview')">
              {{ t("comparison.playedTempoRow", { group: entry.groupId, color: entry.color === "B" ? t("color.black") : t("color.white"), before: groupStatusLabel(entry.beforeStatus), after: groupStatusLabel(entry.afterStatus) }) }}
            </button>
          </li>
        </ul>
      </details>
    </section>
    <details>
      <summary>{{ t("comparison.limits") }}</summary>
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
.yagoo-comparison h3 { font-size: 0.9rem; margin: 0.8rem 0 0.5rem; }
.yagoo-comparison__played { border-top: 1px solid var(--yagoo-border, #ddd); margin-top: 0.8rem; }
.yagoo-comparison details { margin: 0.6rem 0; }
.yagoo-comparison button { color: var(--yagoo-accent, #0066cc); background: none; border: 0; font: inherit; cursor: pointer; text-align: left; }
</style>
