<script setup lang="ts">
const props = defineProps<{
  /** Issue number without a hash, for example `24`. */
  issue: number;
  title: string;
  summary: string;
}>();

const href = `https://github.com/yet-another-ai/yagoo/issues/${props.issue}`;
</script>

<template>
  <section class="yagoo-stub" data-testid="module-stub" :data-issue="issue">
    <p class="yagoo-stub__badge">Coming in #{{ issue }}</p>
    <h3 class="yagoo-stub__title">{{ title }}</h3>
    <p class="yagoo-stub__summary">{{ summary }}</p>
    <p class="yagoo-stub__link">
      <a :href="href">Issue #{{ issue }}</a>
    </p>
  </section>
</template>

<style scoped>
.yagoo-stub {
  margin: 0.75rem;
  padding: 0.9rem 0.95rem;
  border: 1px dashed var(--yagoo-border, #c8c8d0);
  border-radius: 8px;
  background: var(--yagoo-panel, #fff);
  color: var(--yagoo-text, #1a1a1a);
}

.yagoo-stub__badge {
  display: inline-block;
  margin: 0 0 0.45rem;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: var(--yagoo-accent-soft, rgba(0, 130, 240, 0.12));
  color: var(--yagoo-accent, #0066cc);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.yagoo-stub__title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 650;
}

.yagoo-stub__summary {
  margin: 0;
  color: var(--yagoo-muted, #4a4a55);
  font-size: 0.84rem;
  line-height: 1.45;
}

.yagoo-stub__link {
  margin: 0.55rem 0 0;
  font-size: 0.8rem;
}

.yagoo-stub__link a {
  color: var(--yagoo-accent, #0066cc);
}
</style>
