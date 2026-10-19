<script setup lang="ts">
import type { GamePlayerInfo } from "../composables/useGame";
import type { Sign } from "../types";

withDefaults(
  defineProps<{
    players?: [GamePlayerInfo, GamePlayerInfo];
    currentPlayer?: Sign;
    canGoBack?: boolean;
    canGoForward?: boolean;
    moveNumber?: number;
    tryMode?: boolean;
    reportMode?: boolean;
  }>(),
  {
    players: () => [
      { name: "Black", rank: "", captures: 0 },
      { name: "White", rank: "", captures: 0 },
    ],
    currentPlayer: 1,
    canGoBack: false,
    canGoForward: false,
    moveNumber: 0,
    tryMode: false,
    reportMode: false,
  },
);

const emit = defineEmits<{
  (e: "back"): void;
  (e: "forward"): void;
  (e: "toggle-try"): void;
  (e: "toggle-report"): void;
}>();
</script>

<template>
  <footer class="yagoo-bottom-bar">
    <div class="yagoo-bottom-bar__player yagoo-bottom-bar__player--black">
      <span class="yagoo-bottom-bar__name">{{ players[0].name }}</span>
      <span v-if="players[0].rank" class="yagoo-bottom-bar__rank">
        {{ players[0].rank }}
      </span>
      <span class="yagoo-bottom-bar__captures">{{ players[0].captures }}</span>
    </div>

    <div class="yagoo-bottom-bar__turn" :title="`Move ${moveNumber}`">
      <span
        class="yagoo-stone-icon yagoo-stone-icon--black"
        :class="{ 'yagoo-stone-icon--active': currentPlayer === 1 }"
      />
      <span
        class="yagoo-stone-icon yagoo-stone-icon--white"
        :class="{ 'yagoo-stone-icon--active': currentPlayer === -1 }"
      />
    </div>

    <div class="yagoo-bottom-bar__player yagoo-bottom-bar__player--white">
      <span class="yagoo-bottom-bar__captures">{{ players[1].captures }}</span>
      <span v-if="players[1].rank" class="yagoo-bottom-bar__rank">
        {{ players[1].rank }}
      </span>
      <span class="yagoo-bottom-bar__name">{{ players[1].name }}</span>
    </div>

    <div class="yagoo-bottom-bar__nav">
      <button
        type="button"
        aria-label="Previous move"
        :disabled="!canGoBack"
        @click="emit('back')"
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Next move"
        :disabled="!canGoForward"
        @click="emit('forward')"
      >
        →
      </button>
      <button
        type="button"
        data-testid="try-move-toggle"
        :aria-pressed="tryMode"
        @click="emit('toggle-try')"
      >
        {{ tryMode ? "End try" : "Try" }}
      </button>
      <button
        type="button"
        data-testid="report-toggle"
        :aria-pressed="reportMode"
        @click="emit('toggle-report')"
      >
        Report
      </button>
    </div>
  </footer>
</template>
