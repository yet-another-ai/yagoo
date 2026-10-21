<script setup lang="ts">
import { computed } from "vue";
import type { MoveComparison } from "../analysis/modules";
import { alignedSacrificeAssessment } from "../analysis/sacrifices";
import { useYagooI18n } from "../i18n";

const { t } = useYagooI18n();

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
      {{ t("sacrifice.unavailable") }}
    </p>
    <template v-else>
      <p class="sacrifice-context">
        {{ t("sacrifice.context", { move: assessment.preferredMove, mover: assessment.mover === "B" ? t("color.black") : t("color.white"), root: assessment.rootPly }) }}
      </p>
      <p v-if="assessment.status === 'unassessed'" data-testid="sacrifice-unassessed">
        {{ t("sacrifice.unassessed") }}
      </p>
      <p v-else-if="assessment.annotations.length === 0" data-testid="sacrifice-none">
        {{ t("sacrifice.none") }}
      </p>
      <ol v-else data-testid="sacrifice-body" class="sacrifices">
        <li v-for="item in assessment.annotations" :key="item.groupId">
          <strong>{{ t("sacrifice.supported") }}</strong>
          <p>
            <button type="button" :data-sacrifice-group="item.groupId"
              @mouseenter="emit('preview-stones', item.stones)" @focus="emit('preview-stones', item.stones)"
              @mouseleave="emit('clear-preview')" @blur="emit('clear-preview')">
              {{ t("sacrifice.captured", { group: item.groupId, count: item.stones.length, offset: item.evidence.preferredCapturePlyOffset }) }}
            </button>
          </p>
          <p>
            {{ t("sacrifice.saving", { move: item.referenceMove, saving: item.referenceOwnership.toFixed(2), preferred: item.preferredOwnership.toFixed(2), flip: item.ownershipFlip.toFixed(2) }) }}
          </p>
          <p>
            {{ t("sacrifice.cost", { cost: item.costBook.toFixed(2), benefit: item.compensationBook.toFixed(2) }) }}
            <template v-if="item.compensationPoints != null">
              {{ t("sacrifice.priced", { points: signed(item.compensationPoints) }) }}
            </template>
            <template v-else>{{ t("sacrifice.unpriced") }}</template>
          </p>
          <ul class="exchange-list">
            <li v-for="(exchange, index) in item.exchanges" :key="index">
              <button type="button" :data-sacrifice-exchange="index"
                @mouseenter="emit('preview-stones', exchange.intersections)" @focus="emit('preview-stones', exchange.intersections)"
                @mouseleave="emit('clear-preview')" @blur="emit('clear-preview')">
                {{ t("sacrifice.book", { label: exchange.id ?? exchange.kind.replaceAll("_", " "), value: signed(exchange.bookValue) }) }}
              </button>
            </li>
          </ul>
          <p class="evidence">
            {{ t("sacrifice.advantage", { score: signed(item.evidence.scoreAdvantage), winrate: signed(item.evidence.winrateAdvantage * 100), preferred: item.evidence.preferredVisits, reference: item.evidence.referenceVisits, endpoint: item.evidence.endpointVisits }) }}
          </p>
          <details>
            <summary>{{ t("sacrifice.pv") }}</summary>
            <p>{{ t("sacrifice.preferredPv", { pv: item.pv.join(" → ") }) }}</p>
            <p>{{ t("sacrifice.savingPv", { pv: item.evidence.referencePv.join(" → ") }) }}</p>
            <p>{{ t("sacrifice.queries", { root: item.evidence.rootQueryId, reference: item.evidence.referenceQueryId, preferred: item.evidence.preferredPvQueryId }) }}</p>
            <p>{{ t("sacrifice.savingEvidence", { source: (item.evidence.referenceSource ?? "root_candidate").replaceAll("_", " "), hash: item.evidence.referenceRootHash ?? item.evidence.rootHash ?? "unavailable" }) }}</p>
          </details>
        </li>
      </ol>
      <details class="criteria">
        <summary>{{ t("sacrifice.criteria") }}</summary>
        <p>
          {{ t("sacrifice.criteriaBody", {
            stones: assessment.parameters.minimumStones,
            visits: assessment.parameters.minimumVisits,
            saving: assessment.parameters.savingOwnershipMinimum,
            preferred: assessment.parameters.preferredOwnershipMaximum,
            endpoint: assessment.parameters.endpointOwnershipMaximum,
          }) }}
        </p>
        <ul>
          <li v-for="limitation in assessment.limitations" :key="limitation">{{ limitation }}</li>
        </ul>
        <ul v-if="assessment.checks.length" data-testid="sacrifice-checks">
          <li v-for="check in assessment.checks" :key="check.groupId">
            {{ t("sacrifice.check", { group: check.groupId, reason: check.reason.replaceAll("_", " ") }) }}
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
