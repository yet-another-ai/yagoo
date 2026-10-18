import { defineCustomElement, h } from "vue";
import Goban from "../goban/Goban.vue";
import type {
  BoardMap,
  GhostStone,
  HeatVertex,
  LineMarker,
  Marker,
  Sign,
  Vertex,
} from "../types";

/**
 * Framework-agnostic `<yagoo-board>` custom element wrapping Goban.
 * Styles from goban.css are not automatically inlined; consumers should
 * also include `@yagoo/ui/goban.css` (or rely on the host page).
 */
export const YagooBoardElement = defineCustomElement(
  {
    props: {
      signMap: { type: Array, default: () => [] },
      markerMap: { type: Array, default: undefined },
      paintMap: { type: Array, default: undefined },
      ghostStoneMap: { type: Array, default: undefined },
      heatMap: { type: Array, default: undefined },
      lines: { type: Array, default: () => [] },
      selectedVertices: { type: Array, default: () => [] },
      dimmedVertices: { type: Array, default: () => [] },
      vertexSize: { type: Number, default: 24 },
      showCoordinates: { type: Boolean, default: false },
      fuzzyStonePlacement: { type: Boolean, default: false },
      animateStonePlacement: { type: Boolean, default: false },
      fuzzySeed: { type: Number, default: undefined },
      busy: { type: Boolean, default: false },
    },
    emits: ["vertex-click"],
    setup(
      props: {
        signMap: BoardMap<Sign>;
        markerMap?: BoardMap<Marker | null>;
        paintMap?: BoardMap<number>;
        ghostStoneMap?: BoardMap<GhostStone | null>;
        heatMap?: BoardMap<HeatVertex | null>;
        lines: LineMarker[];
        selectedVertices: Vertex[];
        dimmedVertices: Vertex[];
        vertexSize: number;
        showCoordinates: boolean;
        fuzzyStonePlacement: boolean;
        animateStonePlacement: boolean;
        fuzzySeed?: number;
        busy: boolean;
      },
      { emit },
    ) {
      return () =>
        h(Goban, {
          ...props,
          onVertexClick: (evt: MouseEvent, vertex: Vertex) =>
            emit("vertex-click", evt, vertex),
        });
    },
  },
  { shadowRoot: false },
);

export function registerYagooBoard(
  tagName = "yagoo-board",
): void {
  if (typeof customElements === "undefined") return;
  if (customElements.get(tagName) != null) return;
  customElements.define(tagName, YagooBoardElement);
}
