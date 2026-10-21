<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useYagooI18n } from "../i18n";
import { createHttpCommentaryProvider, type HttpCommentaryProtocol } from "../commentary/httpProvider";
import type { CommentaryProvider } from "../commentary/session";

const { t } = useYagooI18n();
const emit = defineEmits<{
  (e: "provider", value: CommentaryProvider | null, destination?: string): void;
}>();
const protocol = ref<HttpCommentaryProtocol>("openai-chat");
const endpoint = ref("");
const model = ref("");
const apiKey = ref("");
const configured = ref(false);
const error = ref("");

watch([protocol, endpoint, model, apiKey], () => {
  configured.value = false;
  error.value = "";
  emit("provider", null);
}, { flush: "sync" });

function apply() {
  try {
    const provider = createHttpCommentaryProvider({
      protocol: protocol.value, endpoint: endpoint.value,
      model: model.value, apiKey: apiKey.value,
    });
    emit("provider", provider, new URL(endpoint.value.trim()).href);
    configured.value = true;
    error.value = "";
  } catch {
    configured.value = false;
    emit("provider", null);
    error.value = "commentary.invalid";
  }
}

function clear() {
  endpoint.value = "";
  model.value = "";
  apiKey.value = "";
  configured.value = false;
  error.value = "";
  emit("provider", null);
}
onBeforeUnmount(clear);
</script>

<template>
  <details class="yagoo-commentary-provider" data-testid="commentary-provider-settings">
    <summary>{{ t("commentary.configure") }}</summary>
    <form @submit.prevent="apply">
      <label>{{ t("commentary.apiFormat") }}
        <select v-model="protocol" data-testid="commentary-protocol">
          <option value="openai-chat">{{ t("commentary.openai") }}</option>
          <option value="ollama-chat">{{ t("commentary.ollama") }}</option>
        </select>
      </label>
      <label>{{ t("commentary.endpoint") }}
        <input v-model="endpoint" data-testid="commentary-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="http://localhost:11434/api/chat" />
      </label>
      <label>{{ t("commentary.model") }}
        <input v-model="model" data-testid="commentary-model" type="text" autocomplete="off" spellcheck="false" />
      </label>
      <label>{{ t("commentary.token") }}
        <input v-model="apiKey" data-testid="commentary-token" type="password" autocomplete="off" spellcheck="false" />
      </label>
      <p>{{ t("commentary.settings") }}</p>
      <button data-testid="commentary-configure" type="submit">{{ t("commentary.useEndpoint") }}</button>
      <button data-testid="commentary-forget" type="button" @click="clear">{{ t("commentary.forget") }}</button>
      <p v-if="configured" role="status">{{ t("commentary.configured") }}</p>
      <p v-if="error" role="alert">{{ t(error) }}</p>
    </form>
  </details>
</template>

<style scoped>
.yagoo-commentary-provider { margin-top: 0.7rem; }
.yagoo-commentary-provider label { display: block; margin-top: 0.5rem; }
.yagoo-commentary-provider input, .yagoo-commentary-provider select { display: block; box-sizing: border-box; width: 100%; font: inherit; }
.yagoo-commentary-provider p { color: var(--yagoo-muted, #5c5c66); font-size: 0.76rem; }
.yagoo-commentary-provider button { margin-right: 0.4rem; }
</style>
