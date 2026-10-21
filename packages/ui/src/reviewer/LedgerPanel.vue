<script setup lang="ts">
import type { GainLossLedger, GainLossLine } from "../analysis/modules";

defineProps<{ ledger: GainLossLedger }>();
const emit = defineEmits<{
  (e: "preview", line: GainLossLine): void;
  (e: "clear-preview"): void;
}>();

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function label(line: GainLossLine): string {
  return line.kind === "group"
    ? `Group ${line.id}`
    : line.kind.replace(/_/g, " ");
}
</script>

<template>
  <div class="yagoo-ledger-panel" data-testid="ledger-body">
    <p>
      <strong>{{ ledger.move }} vs {{ ledger.vs === "pass" ? "pass" : `best (${ledger.referenceMove})` }}</strong>
      · {{ signed(ledger.value) }} search points for {{ ledger.mover === "B" ? "Black" : "White" }}
    </p>
    <p class="yagoo-ledger-panel__note">
      Candidate comparison at root ply {{ ledger.rootPly }}. Groups and highlighted
      intersections belong to this position.
    </p>
    <p v-if="!ledger.consistent" role="status" data-testid="ledger-inconsistent">
      Book and search inconsistent:
      {{ ledger.inconsistency === "zero_book" ? "the ownership book is near zero" : "the difference exceeds 3 points" }}.
      Showing signed shares of total absolute book contribution; line points are unavailable.
    </p>
    <ul>
      <li v-for="(line, index) in ledger.ledger" :key="`${line.kind}-${line.id ?? index}`">
        <button
          type="button"
          :data-ledger-group="line.id"
          :data-ledger-kind="line.kind"
          :aria-label="`Highlight ${label(line)}`"
          @mouseenter="emit('preview', line)"
          @mouseleave="emit('clear-preview')"
          @focus="emit('preview', line)"
          @blur="emit('clear-preview')"
        >
          <span>{{ label(line) }}</span>
          <strong v-if="ledger.consistent && line.points != null">{{ signed(line.points) }} pt</strong>
          <strong v-else>{{ signed(line.proportion * 100) }}%</strong>
        </button>
        <p v-for="change in line.strengthChanges ?? []" :key="change.color" class="yagoo-ledger-panel__note">
          {{ change.color === "B" ? "Black" : "White" }} strength:
          {{ change.reference.toFixed(2) }} → {{ change.candidate.toFixed(2) }}
          ({{ signed(change.delta) }})
        </p>
      </li>
    </ul>
    <p class="yagoo-ledger-panel__note" data-testid="ledger-tempo-limitation">
      Tempo transitions are unassessed: candidate branch pass probes are unavailable.
      Strength changes do not establish sente, gote, or a change in life status.
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
