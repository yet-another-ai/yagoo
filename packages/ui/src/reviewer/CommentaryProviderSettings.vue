<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { createHttpCommentaryProvider, type HttpCommentaryProtocol } from "../commentary/httpProvider";
import type { CommentaryProvider } from "../commentary/session";

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
    error.value = "Enter a model and a complete HTTPS or loopback HTTP endpoint, without URL credentials, query, or fragment.";
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
    <summary>Configure an LLM endpoint</summary>
    <form @submit.prevent="apply">
      <label>API format
        <select v-model="protocol" data-testid="commentary-protocol">
          <option value="openai-chat">OpenAI-compatible chat</option>
          <option value="ollama-chat">Ollama chat</option>
        </select>
      </label>
      <label>Full endpoint URL
        <input v-model="endpoint" data-testid="commentary-endpoint" type="url" autocomplete="off" spellcheck="false" placeholder="http://localhost:11434/api/chat" />
      </label>
      <label>Model available at this endpoint
        <input v-model="model" data-testid="commentary-model" type="text" autocomplete="off" spellcheck="false" />
      </label>
      <label>Bearer token (optional)
        <input v-model="apiKey" data-testid="commentary-token" type="password" autocomplete="off" spellcheck="false" />
      </label>
      <p>Settings stay in this page's memory and clear when Notes is disabled or the game/source changes. Configuring makes no request. Use the separate Send button to send the displayed structured facts; no SGF, player names, or comments are included.</p>
      <button data-testid="commentary-configure" type="submit">Use endpoint</button>
      <button data-testid="commentary-forget" type="button" @click="clear">Forget endpoint</button>
      <p v-if="configured" role="status">Endpoint configured. Sending facts may use the endpoint's own billing.</p>
      <p v-if="error" role="alert">{{ error }}</p>
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
