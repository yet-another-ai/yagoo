<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  GainLossLedger,
  GainLossLine,
  LlmCommentary,
  MoveComparison,
  SacrificeAnnotation,
} from "../analysis/modules";
import type { CandidateSnapshot, EngineAnalysis } from "../analysis/types";
import CandidatesPanel from "../layout/CandidatesPanel.vue";
import StubPane from "./StubPane.vue";
import LedgerPanel from "./LedgerPanel.vue";
import ComparisonPanel from "./ComparisonPanel.vue";
import SacrificePanel from "./SacrificePanel.vue";
import CommentaryPanel from "./CommentaryPanel.vue";
import type { CommentaryInput, CommentaryTarget, CommentaryOrigin, GroundedCommentary } from "../commentary/facts";
import type { CommentaryProvider } from "../commentary/session";

export type InspectorPerspective =
  | "ai"
  | "why"
  | "ledger"
  | "sacrifice"
  | "notes";

const props = withDefaults(
  defineProps<{
    candidates: CandidateSnapshot[];
    root?: EngineAnalysis | null;
    rootVisits?: number | null;
    previewIndex?: number | null;
    selectedIndex?: number;
    ledger?: GainLossLedger | null;
    comparison?: MoveComparison | null;
    showComparisonDifference?: boolean;
    sacrifices?: SacrificeAnnotation[] | null;
    commentary?: LlmCommentary | null;
    commentaryInput?: CommentaryInput;
    commentaryProvider?: CommentaryProvider | null;
    commentaryContextKey?: string | number;
    initialPerspective?: InspectorPerspective;
    /** Ply shown in the header, for key-move context. */
    ply?: number;
    keyIndex?: number;
    keyCount?: number;
  }>(),
  {
    root: null,
    rootVisits: null,
    previewIndex: null,
    selectedIndex: 0,
    ledger: null,
    comparison: null,
    showComparisonDifference: true,
    sacrifices: null,
    commentary: null,
    initialPerspective: "ai",
    ply: 0,
    keyIndex: -1,
    keyCount: 0,
  },
);

const emit = defineEmits<{
  (e: "preview", index: number): void;
  (e: "clear-preview"): void;
  (e: "toggle", index: number): void;
  (e: "select", index: number): void;
  (e: "preview-group", groupId: string): void;
  (e: "preview-ledger", line: GainLossLine): void;
  (e: "clear-ledger-preview"): void;
  (e: "preview-stones", stones: string[]): void;
  (e: "toggle-comparison-difference", enabled: boolean): void;
  (e: "perspective-change", perspective: InspectorPerspective): void;
  (e: "prev-key"): void;
  (e: "next-key"): void;
  (e: "commentary", result: GroundedCommentary | null, origin: CommentaryOrigin): void;
  (e: "cite-commentary", target: CommentaryTarget): void;
  (e: "clear-commentary-citation"): void;
}>();

const tabs: { id: InspectorPerspective; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "why", label: "Why not" },
  { id: "ledger", label: "Ledger" },
  { id: "sacrifice", label: "Sacrifice" },
  { id: "notes", label: "Notes" },
];

const perspective = ref<InspectorPerspective>(props.initialPerspective);
watch(perspective, (next) => {
  emit("clear-ledger-preview");
  emit("perspective-change", next);
});

watch(
  () => props.initialPerspective,
  (next) => {
    perspective.value = next;
  },
);

function onTabKey(event: KeyboardEvent, index: number) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  event.stopPropagation();
  const dir = event.key === "ArrowRight" ? 1 : -1;
  const next = (index + dir + tabs.length) % tabs.length;
  const tab = tabs[next];
  if (tab == null) return;
  perspective.value = tab.id;
  const button = (event.currentTarget as HTMLElement).parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    .item(next);
  button?.focus();
}

function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function points(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

defineExpose({ perspective });
</script>

<template>
  <section class="yagoo-inspector" data-testid="move-inspector" :aria-label="`Move ${ply} inspector`">
    <header class="yagoo-inspector__bar">
      <div class="yagoo-inspector__title">
        Move {{ ply }}
        <span v-if="keyCount > 0" class="yagoo-inspector__key">
          <template v-if="keyIndex >= 0">
            Key {{ keyIndex + 1 }} / {{ keyCount }}
          </template>
          <template v-else>Not a key move</template>
        </span>
      </div>
      <div class="yagoo-inspector__keys">
        <button
          type="button"
          data-testid="prev-key-move"
          :disabled="keyCount === 0"
          aria-label="Previous key move"
          @click="emit('prev-key')"
        >
          Prev key
        </button>
        <button
          type="button"
          data-testid="next-key-move"
          :disabled="keyCount === 0"
          aria-label="Next key move"
          @click="emit('next-key')"
        >
          Next key
        </button>
      </div>
    </header>

    <div class="yagoo-inspector__tabs" role="tablist" aria-label="Move perspectives">
      <button
        v-for="(tab, index) in tabs"
        :id="`yagoo-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :data-testid="`perspective-${tab.id}`"
        :aria-selected="perspective === tab.id"
        :tabindex="perspective === tab.id ? 0 : -1"
        :aria-controls="`yagoo-panel-${tab.id}`"
        @click="perspective = tab.id"
        @keydown="onTabKey($event, index)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div
      v-show="perspective === 'ai'"
      :id="'yagoo-panel-ai'"
      role="tabpanel"
      aria-labelledby="yagoo-tab-ai"
      class="yagoo-inspector__panel"
    >
      <dl v-if="root" class="yagoo-inspector__root">
        <div>
          <dt>Winrate</dt>
          <dd>{{ percent(root.winrate) }}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{{ points(root.scoreLead) }}</dd>
        </div>
        <div>
          <dt>Visits</dt>
          <dd>{{ root.visits ?? "—" }}</dd>
        </div>
      </dl>
      <p v-else class="yagoo-inspector__wait">No root analysis at this ply yet.</p>
      <CandidatesPanel
        embedded
        :candidates="candidates"
        :root-visits="rootVisits"
        :preview-index="previewIndex"
        :selected-index="selectedIndex"
        @preview="emit('preview', $event)"
        @clear-preview="emit('clear-preview')"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
      />
    </div>

    <div
      v-show="perspective === 'why'"
      id="yagoo-panel-why"
      role="tabpanel"
      aria-labelledby="yagoo-tab-why"
      class="yagoo-inspector__panel"
    >
      <ComparisonPanel v-if="comparison" :comparison="comparison"
        :show-difference="showComparisonDifference"
        @preview="emit('preview-ledger', $event)"
        @preview-stones="emit('preview-stones', $event)"
        @clear-preview="emit('clear-ledger-preview')"
        @toggle-difference="emit('toggle-comparison-difference', $event)" />
      <StubPane
        v-else
        :issue="24"
        title="Why not this move"
        summary="No comparison is available for this move. Deep analysis needs actual and preferred candidates from the historical board before this move. Scan-only positions, older recordings, or unsupported restricted queries may omit it."
      />
    </div>

    <div
      v-show="perspective === 'ledger'"
      id="yagoo-panel-ledger"
      role="tabpanel"
      aria-labelledby="yagoo-tab-ledger"
      class="yagoo-inspector__panel"
    >
      <LedgerPanel
        v-if="ledger"
        :ledger="ledger"
        @preview="emit('preview-ledger', $event)"
        @clear-preview="emit('clear-ledger-preview')"
      />
      <StubPane
        v-else
        :issue="23"
        title="Gain / loss by group"
        summary="No ledger is available at this position. Deep analysis needs matching candidate ownership, score, and a pass probe; scan-only or older recordings may omit them. Tempo transitions require additional branch probes."
      />
    </div>

    <div
      v-show="perspective === 'sacrifice'"
      id="yagoo-panel-sacrifice"
      role="tabpanel"
      aria-labelledby="yagoo-tab-sacrifice"
      class="yagoo-inspector__panel"
    >
      <SacrificePanel :comparison="comparison" :ply="ply"
        @preview-stones="emit('preview-stones', $event)"
        @clear-preview="emit('clear-ledger-preview')" />
    </div>

    <div
      v-show="perspective === 'notes'"
      id="yagoo-panel-notes"
      role="tabpanel"
      aria-labelledby="yagoo-tab-notes"
      class="yagoo-inspector__panel"
    >
      <CommentaryPanel
        :input="commentaryInput ?? { ply, root, candidates, ledger, comparison, sacrifices }"
        :context-key="commentaryContextKey"
        :provider="commentaryProvider"
        @result="(result, origin) => emit('commentary', result, origin)"
        @cite="emit('cite-commentary', $event)"
        @clear-citation="emit('clear-commentary-citation')"
      />
    </div>
  </section>
</template>

<style scoped>
.yagoo-inspector {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--yagoo-panel, #fff);
  color: var(--yagoo-text, #1a1a1a);
}

.yagoo-inspector__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.35rem 0.55rem 0.15rem;
}

.yagoo-inspector__title {
  font-size: 0.82rem;
  font-weight: 650;
}

.yagoo-inspector__key {
  margin-left: 0.4rem;
  font-weight: 500;
  color: var(--yagoo-muted, #5c5c66);
  font-size: 0.75rem;
}

.yagoo-inspector__keys {
  display: flex;
  gap: 0.3rem;
}

.yagoo-inspector__keys button,
.yagoo-inspector__tabs button {
  border: 1px solid transparent;
  background: transparent;
  color: var(--yagoo-muted, #5c5c66);
  font: inherit;
  font-size: 0.75rem;
  border-radius: 4px;
  padding: 0.22rem 0.45rem;
  cursor: pointer;
}

.yagoo-inspector__keys button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.yagoo-inspector__tabs {
  display: flex;
  gap: 0.1rem;
  padding: 0 0.35rem;
  border-bottom: 1px solid var(--yagoo-border, #e2e2e6);
  overflow-x: auto;
}

.yagoo-inspector__tabs button[aria-selected="true"] {
  color: var(--yagoo-text, #1a1a1a);
  font-weight: 700;
  box-shadow: inset 0 -2px 0 var(--yagoo-accent, #0082f0);
}

.yagoo-inspector__panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.yagoo-inspector__root {
  display: flex;
  gap: 0.8rem;
  margin: 0;
  padding: 0.45rem 0.7rem 0.1rem;
}

.yagoo-inspector__root div {
  display: flex;
  flex-direction: column;
}

.yagoo-inspector__root dt {
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--yagoo-muted, #5c5c66);
}

.yagoo-inspector__root dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.yagoo-inspector__wait {
  margin: 0;
  padding: 0.45rem 0.7rem;
  color: var(--yagoo-muted, #5c5c66);
  font-size: 0.8rem;
}

.yagoo-compare {
  padding: 0.55rem 0.7rem;
  font-size: 0.82rem;
}

.yagoo-compare table {
  width: 100%;
  border-collapse: collapse;
}

.yagoo-compare th,
.yagoo-compare td {
  text-align: left;
  padding: 0.25rem 0.35rem;
  border-bottom: 1px solid var(--yagoo-border, #e2e2e6);
}

.yagoo-ledger {
  list-style: none;
  margin: 0;
  padding: 0.2rem 0.45rem 0.6rem;
  font-size: 0.8rem;
}

.yagoo-ledger li {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.6rem;
  align-items: center;
  padding: 0.28rem 0.25rem;
  border-bottom: 1px solid var(--yagoo-border, #ececf1);
}

.yagoo-ledger__link {
  border: none;
  background: transparent;
  color: var(--yagoo-accent, #0066cc);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.yagoo-ledger__pts {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.yagoo-notes__opt {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0.85rem 0.8rem;
  color: var(--yagoo-muted, #5c5c66);
  font-size: 0.8rem;
}

.yagoo-ledger-wrap {
  padding-top: 0.25rem;
}
</style>
