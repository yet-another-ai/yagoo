<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { presentError, useYagooI18n } from "../i18n";
import {
  buildCommentaryFacts, type CommentaryInput, type CommentaryTarget, type CommentaryOrigin,
  type GroundedCommentary,
} from "../commentary/facts";
import {
  CommentarySession, type CommentaryProvider, type CommentarySessionState,
} from "../commentary/session";
import CommentaryProviderSettings from "./CommentaryProviderSettings.vue";

const props = withDefaults(defineProps<{
  input: CommentaryInput;
  stored?: unknown;
  /** Hidden branch views must not edit main-line notes or keep requests alive. */
  active?: boolean;
  contextKey?: string | number;
  provider?: CommentaryProvider | null;
}>(), { active: true });
const emit = defineEmits<{
  (e: "result", value: GroundedCommentary | null, origin: CommentaryOrigin): void;
  (e: "cite", target: CommentaryTarget): void;
  (e: "clear-citation"): void;
}>();
const { t } = useYagooI18n();
const state = shallowRef<CommentarySessionState>({
  enabled: false, busy: false, awaitingManual: false, result: null, requestText: "",
});
const response = ref("");
const configuredProvider = shallowRef<CommentaryProvider | null>(null);
const configuredDestination = ref("");
const effectiveProvider = computed(() => props.provider ?? configuredProvider.value);
function configureProvider(provider: CommentaryProvider | null, destination = "") {
  configuredProvider.value = provider;
  configuredDestination.value = destination;
}
const facts = computed(() => buildCommentaryFacts(props.input));
const session = new CommentarySession((next, persist) => {
  state.value = next;
  if (persist && props.active !== false) {
    emit("result", next.result, { ply: props.input.ply, contextKey: props.contextKey });
  }
});
watch([facts, () => props.contextKey, () => props.stored], ([value, key, stored]) => {
  if (session.setContext(value, key, stored)) {
    response.value = "";
    emit("clear-citation");
  }
}, { immediate: true });
watch(() => props.active, (active) => {
  if (active === false) {
    session.cancel();
    response.value = "";
    emit("clear-citation");
  }
}, { flush: "sync" });
watch(effectiveProvider, () => session.cancel(), { flush: "sync" });
watch(() => props.contextKey, () => configureProvider(null), { flush: "sync" });
onBeforeUnmount(() => {
  configureProvider(null);
  session.setEnabled(false);
});
const cited = computed(() => state.value.result?.sentences.map((sentence) => ({
  ...sentence,
  fact: facts.value.find((fact) => fact.id === sentence.factId)!,
})) ?? []);

function enable(event: Event) {
  const checkbox = event.target as HTMLInputElement;
  if (props.active === false) {
    checkbox.checked = state.value.enabled;
    return;
  }
  const enabled = checkbox.checked;
  session.setEnabled(enabled);
  if (!enabled) {
    configureProvider(null);
    emit("clear-citation");
  }
}
function exportSelection() {
  if (props.active === false) return;
  session.exportRequest();
}
function runProvider() {
  if (props.active === false) return;
  if (effectiveProvider.value) void session.request(effectiveProvider.value);
}
function importSelection() {
  if (props.active === false) return;
  session.importResponse(response.value);
  response.value = "";
}
</script>

<template>
  <!-- Branch suspension must retain page-memory endpoint settings. -->
  <section v-show="active !== false" class="yagoo-commentary" data-testid="commentary-panel">
    <label>
      <input data-testid="commentary-enable" type="checkbox" :checked="state.enabled" @change="enable" />
      {{ t("commentary.show") }}
    </label>
    <p class="yagoo-commentary__hint">
      {{ t("commentary.hint") }}
    </p>
    <template v-if="state.enabled">
      <p v-if="!facts.length">{{ t("commentary.noFacts") }}</p>
      <div v-if="state.result" data-testid="commentary-body">
        <div v-for="sentence in cited" :key="sentence.factId" class="yagoo-commentary__sentence">
          <p>{{ sentence.text }}</p>
          <button
            v-if="sentence.fact.target"
            type="button"
            :data-fact-id="sentence.factId"
            @click="emit('cite', sentence.fact.target)"
            @focus="emit('cite', sentence.fact.target)"
            @blur="emit('clear-citation')"
          >{{ t("commentary.highlight") }}</button>
          <details>
            <summary>{{ t("commentary.sources", { id: sentence.factId }) }}</summary>
            <dl>
              <template v-for="source in sentence.fact.evidence" :key="source.path">
                <dt><code>{{ source.path }}</code></dt>
                <dd>{{ JSON.stringify(source.value) }}</dd>
              </template>
            </dl>
          </details>
        </div>
        <p class="yagoo-commentary__hint" data-testid="commentary-verification">
          {{ state.result.verified ? t("commentary.approved") : t("commentary.templates") }}
          · {{ state.result.provider }}
        </p>
        <p v-if="state.result.fallbackReason" role="status">{{ presentError(state.result.fallbackReason) }}</p>
      </div>
      <div class="yagoo-commentary__actions">
        <button type="button" :disabled="!facts.length" @click="exportSelection">{{ t("commentary.prepare") }}</button>
        <button v-if="effectiveProvider" data-testid="commentary-provider" type="button" :disabled="!facts.length" @click="runProvider">
          {{ t("commentary.send", { id: effectiveProvider.id }) }}
        </button>
        <button v-if="state.busy || state.awaitingManual" type="button" data-testid="commentary-cancel" @click="session.cancel()">{{ t("commentary.cancel") }}</button>
      </div>
      <p v-if="state.busy" role="status">{{ t("commentary.waiting") }}</p>
      <p v-if="configuredProvider && !provider" class="yagoo-commentary__hint" data-testid="commentary-destination">
        {{ t("commentary.destination", { url: configuredDestination }) }}
      </p>
      <p class="yagoo-commentary__hint">
        {{ t("commentary.promptHint") }}
      </p>
      <CommentaryProviderSettings
        v-if="!provider"
        :key="contextKey ?? 'local'"
        @provider="configureProvider"
      />
      <template v-if="state.awaitingManual">
        <label>{{ t("commentary.copy") }}
          <textarea data-testid="commentary-prompt" readonly :value="state.requestText" rows="6" />
        </label>
        <label>{{ t("commentary.paste") }}
          <textarea data-testid="commentary-response" v-model="response" rows="4" />
        </label>
        <button data-testid="commentary-import" type="button" @click="importSelection">{{ t("commentary.apply") }}</button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.yagoo-commentary { padding: 0.7rem; font-size: 0.82rem; }
.yagoo-commentary__hint { color: var(--yagoo-muted, #5c5c66); font-size: 0.76rem; }
.yagoo-commentary__sentence { border-bottom: 1px solid var(--yagoo-border, #e2e2e6); padding-bottom: 0.5rem; }
.yagoo-commentary details { overflow-wrap: anywhere; font-size: 0.72rem; margin-top: 0.4rem; }
.yagoo-commentary dt { margin-top: 0.4rem; }
.yagoo-commentary dd { margin-left: 0; }
.yagoo-commentary textarea { display: block; width: 100%; box-sizing: border-box; font: inherit; margin: 0.4rem 0; }
.yagoo-commentary button { font: inherit; cursor: pointer; }
.yagoo-commentary__actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.7rem; }
</style>
