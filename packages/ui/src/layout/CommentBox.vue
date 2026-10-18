<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    comment?: string;
  }>(),
  {
    title: "Comment",
    comment: "",
  },
);
</script>

<template>
  <section class="yagoo-comment">
    <header class="yagoo-comment__header">
      <span>{{ title }}</span>
      <span aria-hidden="true">✎</span>
    </header>
    <pre class="yagoo-comment__body">{{ comment || "—" }}</pre>
  </section>
</template>
