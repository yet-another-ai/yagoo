<script setup lang="ts">
import type { OpeningMatch } from "../analysis/modules";

defineProps<{
  match: OpeningMatch | null;
}>();
</script>

<template>
  <div
    class="yagoo-opening"
    data-testid="opening-badge"
    :data-ready="match ? '1' : '0'"
  >
    <template v-if="match">
      <span class="yagoo-opening__kicker">{{ match.joseki ? "Joseki start" : "Opening" }}</span>
      <span class="yagoo-opening__name">{{ match.name }}</span>
      <span v-if="match.joseki" class="yagoo-opening__joseki">
        {{ match.joseki }}
      </span>
      <span
        v-if="match.deviationPly != null"
        class="yagoo-opening__dev"
      >
        outside the stored line at move {{ match.deviationPly }}
      </span>
      <span class="yagoo-opening__source">{{ match.source }}</span>
    </template>
    <template v-else>
      <span class="yagoo-opening__kicker">Opening</span>
      <span class="yagoo-opening__pending">No unique match in starter catalogue</span>
    </template>
  </div>
</template>

<style scoped>
.yagoo-opening {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.55rem;
  min-width: 0;
  font-size: 0.82rem;
}

.yagoo-opening__kicker {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--yagoo-muted, #5c5c66);
}

.yagoo-opening__name {
  font-weight: 650;
}

.yagoo-opening__joseki,
.yagoo-opening__dev,
.yagoo-opening__source,
.yagoo-opening__pending {
  color: var(--yagoo-muted, #5c5c66);
}

.yagoo-opening__pending {
  font-weight: 650;
  color: var(--yagoo-accent, #0066cc);
}
</style>
