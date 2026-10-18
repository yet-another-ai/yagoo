<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

const props = defineProps<{ code: string }>();
const container = ref<HTMLElement | null>(null);
const error = ref<string | null>(null);

async function render() {
  error.value = null;
  if (!container.value) return;
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    const source = decodeURIComponent(props.code);
    const { svg } = await mermaid.render(id, source);
    container.value.innerHTML = svg;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(render);
watch(() => props.code, render);
</script>

<template>
  <div class="mermaid-wrap">
    <div v-if="error" class="mermaid-error">{{ error }}</div>
    <div ref="container" class="mermaid" />
  </div>
</template>

<style scoped>
.mermaid-wrap {
  margin: 1rem 0;
  overflow-x: auto;
}
.mermaid-error {
  color: var(--vp-c-danger-1);
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
}
</style>
