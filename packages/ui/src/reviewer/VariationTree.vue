<script setup lang="ts">
import { useYagooI18n } from "../i18n";
import type { GameChildInfo } from "../composables/useGame";
import type { TryNode } from "./tryBranch";
import { tryPath, orderedTryNodes } from "./tryBranch";

const props = defineProps<{
  tryMode: boolean;
  variationActive?: boolean;
  cursorId: string | null;
  nodes: TryNode[];
  sgfChildren: GameChildInfo[];
  analysisStatus?: string;
  canAnalyze?: boolean;
  analyzing?: boolean;
}>();

const { t } = useYagooI18n();

const emit = defineEmits<{
  (e: "select-try", id: string | null): void;
  (e: "select-variation", index: number): void;
  (e: "pass"): void;
  (e: "analyze"): void;
  (e: "stop"): void;
}>();

function depthOf(id: string): number {
  return tryPath(props.nodes, id).length;
}
</script>

<template>
  <section class="yagoo-tree" data-testid="variation-tree" :aria-label="t('tree.aria')">
    <div class="yagoo-tree__title">{{ t("tree.title") }}</div>

    <p v-if="tryMode" class="yagoo-tree__note">
      {{ t("tree.tryNote", { status: analysisStatus }) }}
    </p>
    <p v-else-if="variationActive" class="yagoo-tree__note">
      {{ analysisStatus }}
    </p>
    <p v-else class="yagoo-tree__note">
      {{ t("tree.idle") }}
    </p>
    <div v-if="tryMode || variationActive" class="yagoo-tree__note">
      <button v-if="tryMode" type="button" data-testid="try-pass" @click="emit('pass')">{{ t("tree.pass") }}</button>
      <button v-if="analyzing" type="button" data-testid="stop-variation" @click="emit('stop')">{{ t("tree.stop") }}</button>
      <button v-else-if="canAnalyze" type="button" data-testid="analyze-variation" @click="emit('analyze')">{{ t("tree.analyze") }}</button>
    </div>

    <ol v-if="tryMode" class="yagoo-tree__list">
      <li>
        <button
          type="button"
          class="yagoo-tree__node"
          :class="{ 'yagoo-tree__node--current': cursorId == null }"
          :aria-current="cursorId == null ? 'true' : undefined"
          @click="emit('select-try', null)"
        >
          {{ t("tree.anchor") }}
        </button>
      </li>
      <li v-for="node in orderedTryNodes(nodes)" :key="node.id" :data-parent-id="node.parentId ?? 'anchor'">
        <button
          type="button"
          class="yagoo-tree__node"
          :class="{ 'yagoo-tree__node--current': cursorId === node.id }"
          :style="{ paddingLeft: `${0.55 + depthOf(node.id) * 0.75}rem` }"
          :aria-current="cursorId === node.id ? 'true' : undefined"
          @click="emit('select-try', node.id)"
        >
          {{ node.sign === 1 ? "B" : "W" }} {{ node.label }}
        </button>
      </li>
    </ol>
    <p v-if="tryMode && nodes.length === 0" class="yagoo-tree__empty">
      {{ t("tree.emptyTry") }}
    </p>

    <template v-if="!tryMode">
      <ul v-if="sgfChildren.length" class="yagoo-tree__list">
        <li v-for="child in sgfChildren" :key="child.index">
          <button
            type="button"
            class="yagoo-tree__node"
            @click="emit('select-variation', child.index)"
          >
            {{ child.index === 0 ? t("tree.main") : t("tree.variation", { index: child.index }) }}
            · {{ child.label }}
          </button>
        </li>
      </ul>
      <p v-else class="yagoo-tree__empty">{{ t("tree.none") }}</p>
    </template>
  </section>
</template>

<style scoped>
.yagoo-tree {
  min-height: 0;
  overflow: auto;
  padding-bottom: 0.4rem;
  color: var(--yagoo-text, #1a1a1a);
  font-size: 0.8rem;
}

.yagoo-tree__title {
  padding: 0.4rem 0.65rem 0.15rem;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--yagoo-muted, #5c5c66);
}

.yagoo-tree__note,
.yagoo-tree__empty {
  margin: 0;
  padding: 0.25rem 0.65rem 0.45rem;
  color: var(--yagoo-muted, #5c5c66);
  line-height: 1.4;
}

.yagoo-tree__list {
  list-style: none;
  margin: 0;
  padding: 0 0.35rem 0.35rem;
}

.yagoo-tree__node {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 0.28rem 0.45rem;
  cursor: pointer;
}

.yagoo-tree__node:hover,
.yagoo-tree__node--current {
  background: var(--yagoo-hover, rgba(0, 0, 0, 0.06));
}

.yagoo-tree__node--current {
  box-shadow: inset 2px 0 0 var(--yagoo-accent, #0082f0);
}
</style>
