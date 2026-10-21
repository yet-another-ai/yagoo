<script setup lang="ts">
import { useYagooI18n } from "../i18n";
import type { GamePlayerInfo } from "../composables/useGame";
import type { Sign } from "../types";

const { t } = useYagooI18n();

function playerName(name: string): string {
  if (name === "Black") return t("color.black");
  if (name === "White") return t("color.white");
  return name;
}

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
      <span class="yagoo-bottom-bar__name">{{ playerName(players[0].name) }}</span>
      <span v-if="players[0].rank" class="yagoo-bottom-bar__rank">
        {{ players[0].rank }}
      </span>
      <span class="yagoo-bottom-bar__captures" data-testid="captures-black">{{
        players[0].captures
      }}</span>
    </div>

    <div
      class="yagoo-bottom-bar__turn"
      :title="t('bottom.move', { n: moveNumber })"
      :data-to-play="currentPlayer"
    >
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
      <span class="yagoo-bottom-bar__captures" data-testid="captures-white">{{
        players[1].captures
      }}</span>
      <span v-if="players[1].rank" class="yagoo-bottom-bar__rank">
        {{ players[1].rank }}
      </span>
      <span class="yagoo-bottom-bar__name">{{ playerName(players[1].name) }}</span>
    </div>

    <div class="yagoo-bottom-bar__nav">
      <button
        type="button"
        :aria-label="t('bottom.prev')"
        :disabled="!canGoBack"
        @click="emit('back')"
      >
        ←
      </button>
      <button
        type="button"
        :aria-label="t('bottom.next')"
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
        {{ tryMode ? t("bottom.endTry") : t("bottom.try") }}
      </button>
      <button
        type="button"
        data-testid="report-toggle"
        :aria-pressed="reportMode"
        @click="emit('toggle-report')"
      >
        {{ t("bottom.report") }}
      </button>
    </div>
  </footer>
</template>
