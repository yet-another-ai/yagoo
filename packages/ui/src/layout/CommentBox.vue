<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    comment?: string;
    /** Shorter dock used under the move inspector. */
    dock?: boolean;
  }>(),
  {
    title: "Comment",
    comment: "",
    dock: false,
  },
);
</script>

<template>
  <section class="yagoo-comment" :class="{ 'yagoo-comment--dock': dock }">
    <header class="yagoo-comment__header">
      <span>{{ title }}</span>
      <span aria-hidden="true">✎</span>
    </header>
    <pre class="yagoo-comment__body">{{ comment || "—" }}</pre>
  </section>
</template>

<style scoped>
.yagoo-comment--dock {
  flex: 0 0 auto;
  min-height: 5.5rem;
  max-height: 8.5rem;
}
</style>
