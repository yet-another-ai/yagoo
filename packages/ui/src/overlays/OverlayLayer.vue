<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createBoardGeometry,
  type BoardGeometry,
} from "./BoardGeometry";
import type { OverlayData } from "./OverlayRenderer";
import { SvgOverlayRenderer } from "./SvgOverlayRenderer";

const props = withDefaults(
  defineProps<{
    vertexSize?: number;
    width?: number;
    height?: number;
    rangeX?: [number, number];
    rangeY?: [number, number];
    data?: OverlayData;
  }>(),
  {
    vertexSize: 24,
    width: 19,
    height: 19,
    rangeX: () => [0, 18],
    rangeY: () => [0, 18],
    data: () => ({}),
  },
);

const svgRef = ref<SVGSVGElement | null>(null);
let renderer: SvgOverlayRenderer | null = null;

function geometry(): BoardGeometry {
  return createBoardGeometry({
    vertexSize: props.vertexSize,
    width: props.width,
    height: props.height,
    rangeX: props.rangeX,
    rangeY: props.rangeY,
  });
}

function redraw() {
  if (renderer == null) return;
  renderer.setGeometry(geometry());
  renderer.draw(props.data);
}

onMounted(() => {
  if (svgRef.value == null) return;
  renderer = new SvgOverlayRenderer(svgRef.value);
  redraw();
});

watch(
  () => [props.data, props.vertexSize, props.width, props.height],
  () => redraw(),
  { deep: true },
);

onBeforeUnmount(() => {
  renderer?.dispose();
  renderer = null;
});

defineExpose({ redraw });
</script>

<template>
  <svg
    ref="svgRef"
    class="yagoo-overlay-layer"
    :style="{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: 3,
    }"
  />
</template>
