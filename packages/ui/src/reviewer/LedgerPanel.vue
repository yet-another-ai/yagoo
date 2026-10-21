<script setup lang="ts">
import { groupStatusLabel } from "../analysis/groups";
import type { GainLossLedger, GainLossLine } from "../analysis/modules";
import { useYagooI18n } from "../i18n";

const { t } = useYagooI18n();

withDefaults(defineProps<{
  ledger: GainLossLedger;
  tempoEvidenceAvailable?: boolean;
  tempoComparison?: "branches" | "played";
}>(), { tempoComparison: "branches" });
const emit = defineEmits<{
  (e: "preview", line: GainLossLine): void;
  (e: "clear-preview"): void;
}>();

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function colorName(color: string): string {
  return color === "B" ? t("color.black") : t("color.white");
}

function label(line: GainLossLine): string {
  if (line.kind === "group") return t("ledger.group", { id: line.id });
  const key = `ledger.kind.${line.kind}`;
  const via = t(key);
  return via === key ? line.kind.replace(/_/g, " ") : via;
}
</script>

<template>
  <div class="yagoo-ledger-panel" data-testid="ledger-body">
    <p>
      <strong>{{ ledger.vs === "pass" ? t("ledger.versusPass", { move: ledger.move }) : t("ledger.versusBest", { move: ledger.move, reference: ledger.referenceMove }) }}</strong>
      · {{ t("ledger.points", { value: signed(ledger.value), mover: colorName(ledger.mover) }) }}
    </p>
    <p class="yagoo-ledger-panel__note">
      {{ t("ledger.note", { ply: ledger.rootPly }) }}
    </p>
    <p v-if="!ledger.consistent" role="status" data-testid="ledger-inconsistent">
      {{ t("ledger.inconsistent", { reason: ledger.inconsistency === "zero_book" ? t("ledger.zeroBook") : t("ledger.overPoints") }) }}
    </p>
    <ul>
      <li v-for="(line, index) in ledger.ledger" :key="`${line.kind}-${line.id ?? index}`">
        <button
          type="button"
          :data-ledger-group="line.id"
          :data-ledger-kind="line.kind"
          :aria-label="t('ledger.highlight', { label: label(line) })"
          @mouseenter="emit('preview', line)"
          @mouseleave="emit('clear-preview')"
          @focus="emit('preview', line)"
          @blur="emit('clear-preview')"
        >
          <span>{{ label(line) }}</span>
          <strong v-if="ledger.consistent && line.points != null">{{ t("ledger.pointsShort", { value: signed(line.points) }) }}</strong>
          <strong v-else>{{ signed(line.proportion * 100) }}%</strong>
        </button>
        <p v-for="change in line.strengthChanges ?? []" :key="change.color" class="yagoo-ledger-panel__note">
          {{ t("ledger.strength", { color: colorName(change.color), from: change.reference.toFixed(2), to: change.candidate.toFixed(2), delta: signed(change.delta) }) }}
        </p>
        <p v-for="change in line.tempoChanges ?? []" :key="`tempo-${change.color}`" class="yagoo-ledger-panel__note">
          {{ t("ledger.branchStatus", { color: change.color, preferred: groupStatusLabel(change.preferredStatus), actual: groupStatusLabel(change.actualStatus) }) }}
        </p>
        <p v-for="change in line.playedTempoChanges ?? []" :key="`played-tempo-${change.color}`"
          class="yagoo-ledger-panel__note" data-testid="ledger-played-tempo">
          {{ t("ledger.playedStatus", { color: colorName(change.color), before: groupStatusLabel(change.beforeStatus), after: groupStatusLabel(change.afterStatus) }) }}
        </p>
      </li>
    </ul>
    <p v-if="!tempoEvidenceAvailable" class="yagoo-ledger-panel__note" data-testid="ledger-tempo-limitation">
      {{ t("ledger.tempoMissing", { which: tempoComparison === "played" ? t("ledger.tempoPlayed") : t("ledger.tempoBranch") }) }}
    </p>
    <p v-else-if="tempoComparison === 'played'" class="yagoo-ledger-panel__note">
      {{ t("ledger.playedNote") }}
    </p>
    <p v-else class="yagoo-ledger-panel__note">
      {{ t("ledger.branchNote") }}
    </p>
  </div>
</template>

<style scoped>
.yagoo-ledger-panel p { margin: 0 0 0.65rem; }
.yagoo-ledger-panel ul { margin: 0; padding: 0; list-style: none; }
.yagoo-ledger-panel li { border-top: 1px solid var(--yagoo-border); padding: 0.4rem 0; }
.yagoo-ledger-panel button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.4rem;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.yagoo-ledger-panel button:hover,
.yagoo-ledger-panel button:focus-visible { background: var(--yagoo-hover, #8882); }
.yagoo-ledger-panel__note { font-size: 0.8rem; color: var(--yagoo-text-muted); }
</style>
