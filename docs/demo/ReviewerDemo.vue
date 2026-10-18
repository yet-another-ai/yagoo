<script setup lang="ts">
import {
  ReviewerLayout,
  SAMPLE_GROUP_OUTLINE,
  SAMPLE_SGF,
  SAMPLE_WINRATE,
  sampleHeatMap,
} from "@yagoo/ui";
import "@yagoo/ui/styles.css";
</script>

<template>
  <div class="yagoo-docs-demo">
    <ReviewerLayout
      :sgf="SAMPLE_SGF"
      :winrate-data="SAMPLE_WINRATE"
      :demo-group-outline="SAMPLE_GROUP_OUTLINE"
      :heat-map="sampleHeatMap(9)"
      :vertex-size="28"
      :show-coordinates="true"
      :fuzzy-stone-placement="true"
      :animate-stone-placement="true"
      :fuzzy-seed="42"
    />
  </div>
</template>

<style scoped>
.yagoo-docs-demo {
  height: min(720px, 80vh);
  margin: 1rem 0 2rem;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
}
</style>
