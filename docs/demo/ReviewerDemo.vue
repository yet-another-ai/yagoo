<script setup lang="ts">
import EngineHost from "../engine/EngineHost.vue";

const home = import.meta.env.BASE_URL || "/";
</script>

<template>
  <div class="yagoo-demo-shell">
    <EngineHost layout="full" />
    <a class="yagoo-demo-home" :href="home">Docs</a>
  </div>
</template>

<style>
.yagoo-demo-shell {
  position: relative;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.yagoo-demo-home {
  position: absolute;
  z-index: 30;
  top: 0.62rem;
  left: 4.75rem;
  font: 600 12px/1 system-ui, sans-serif;
  letter-spacing: 0.01em;
  color: inherit;
  opacity: 0.55;
  text-decoration: none;
}

.yagoo-demo-home:hover,
.yagoo-demo-home:focus-visible {
  opacity: 1;
}
</style>
