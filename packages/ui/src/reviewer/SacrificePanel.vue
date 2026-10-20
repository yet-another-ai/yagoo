<script setup lang="ts">
import { computed } from "vue";
import type { MoveComparison } from "../analysis/modules";
import { alignedSacrificeAssessment } from "../analysis/sacrifices";

const props = defineProps<{ comparison: MoveComparison | null; ply: number }>();
const emit = defineEmits<{
  (e: "preview-stones", stones: string[]): void;
  (e: "clear-preview"): void;
}>();
const assessment = computed(() => alignedSacrificeAssessment(
  props.comparison, props.ply, props.comparison?.context.board.size ?? 0,
));
function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(2)}`; }
</script>

<template>
  <section class="sacrifice-panel" data-testid="sacrifice-panel">
    <p v-if="!assessment" data-testid="sacrifice-unavailable">
      Sacrifice assessment is unavailable for this move. It needs the historical
      pre-move root, saving alternatives and a legal preferred PV with endpoint analysis.
    </p>
    <template v-else>
      <p class="sacrifice-context">
        Preferred {{ assessment.preferredMove }} ·
        {{ assessment.mover === "B" ? "Black" : "White" }} ·
        before-move board (ply {{ assessment.rootPly }}).
      </p>
      <p v-if="assessment.status === 'unassessed'" data-testid="sacrifice-unassessed">
        Unassessed: the required evidence is incomplete or has too few visits.
      </p>
      <p v-else-if="assessment.annotations.length === 0" data-testid="sacrifice-none">
        No supported sacrifice candidate among the retained branches.
        This does not rule out sacrifices outside the sampled alternatives or PV horizon.
      </p>
      <ol v-else data-testid="sacrifice-body" class="sacrifices">
        <li v-for="item in assessment.annotations" :key="item.groupId">
          <strong>Supported sacrifice candidate</strong>
          <p>
            <button type="button" :data-sacrifice-group="item.groupId"
              @mouseenter="emit('preview-stones', item.stones)" @focus="emit('preview-stones', item.stones)"
              @mouseleave="emit('clear-preview')" @blur="emit('clear-preview')">
              Group {{ item.groupId }} · {{ item.stones.length }} original stones
            </button>
            is captured by PV move {{ item.evidence.preferredCapturePlyOffset }}.
          </p>
          <p>
            Saving alternative {{ item.referenceMove }} retains these stones through that horizon.
            Own-color ownership: {{ item.referenceOwnership.toFixed(2) }} saving →
            {{ item.preferredOwnership.toFixed(2) }} preferred
            (flip {{ item.ownershipFlip.toFixed(2) }}).
          </p>
          <p>
            Group cost {{ item.costBook.toFixed(2) }}; net benefit elsewhere
            {{ item.compensationBook.toFixed(2) }} ownership-book units.
            <template v-if="item.compensationPoints != null">
              Search-scaled benefit elsewhere: {{ signed(item.compensationPoints) }} points.
            </template>
            <template v-else>The exchange is unpriced in points.</template>
          </p>
          <ul class="exchange-list">
            <li v-for="(exchange, index) in item.exchanges" :key="index">
              <button type="button" :data-sacrifice-exchange="index"
                @mouseenter="emit('preview-stones', exchange.intersections)" @focus="emit('preview-stones', exchange.intersections)"
                @mouseleave="emit('clear-preview')" @blur="emit('clear-preview')">
                {{ exchange.id ?? exchange.kind.replaceAll("_", " ") }}
                · {{ signed(exchange.bookValue) }} book units
              </button>
            </li>
          </ul>
          <p class="evidence">
            Preferred versus saving: mover score {{ signed(item.evidence.scoreAdvantage) }},
            winrate {{ signed(item.evidence.winrateAdvantage * 100) }} percentage points.
            Visits: {{ item.evidence.preferredVisits }} preferred /
            {{ item.evidence.referenceVisits }} saving /
            {{ item.evidence.endpointVisits }} endpoint.
          </p>
          <details>
            <summary>PV and evidence</summary>
            <p>Preferred: {{ item.pv.join(" → ") }}</p>
            <p>Saving: {{ item.evidence.referencePv.join(" → ") }}</p>
            <p>Queries: {{ item.evidence.rootQueryId }}, {{ item.evidence.referenceQueryId }},
              {{ item.evidence.preferredPvQueryId }}.</p>
            <p>Saving evidence: {{ (item.evidence.referenceSource ?? 'root_candidate').replaceAll('_', ' ') }}.
              Root hash: {{ item.evidence.referenceRootHash ?? item.evidence.rootHash ?? 'unavailable' }}.</p>
          </details>
        </li>
      </ol>
      <details class="criteria">
        <summary>Criteria and limitations</summary>
        <p>
          At least {{ assessment.parameters.minimumStones }} original stones and
          {{ assessment.parameters.minimumVisits }} visits per branch and endpoint.
          Saving ownership ≥ {{ assessment.parameters.savingOwnershipMinimum }};
          preferred ≤ {{ assessment.parameters.preferredOwnershipMaximum }};
          endpoint ≤ {{ assessment.parameters.endpointOwnershipMaximum }}.
          All original group stones must be captured in the preferred PV.
        </p>
        <ul>
          <li v-for="limitation in assessment.limitations" :key="limitation">{{ limitation }}</li>
        </ul>
        <ul v-if="assessment.checks.length" data-testid="sacrifice-checks">
          <li v-for="check in assessment.checks" :key="check.groupId">
            {{ check.groupId }}: {{ check.reason.replaceAll("_", " ") }}
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.sacrifice-panel { padding: .5rem .7rem; font-size: .8rem; line-height: 1.45; }
.sacrifice-panel p { margin: .35rem 0; }
.sacrifice-context, .evidence, .criteria { color: var(--yagoo-muted, #5c5c66); }
.sacrifices { list-style: none; margin: .5rem 0; padding: 0; }
.sacrifices > li { padding: .5rem 0; border-bottom: 1px solid var(--yagoo-border, #e2e2e6); }
.sacrifice-panel button { color: var(--yagoo-accent, #0082f0); background: transparent; border: 0; padding: .2rem 0; cursor: pointer; text-align: left; font: inherit; }
.sacrifice-panel button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.exchange-list { padding-left: 1rem; }
summary { cursor: pointer; }
</style>
