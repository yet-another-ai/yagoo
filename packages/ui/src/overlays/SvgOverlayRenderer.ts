import {
  type BoardGeometry,
  verticesToOutlinePath,
} from "./BoardGeometry";
import type {
  OverlayData,
  OverlayRenderer,
} from "./OverlayRenderer";

/**
 * SVG implementation of OverlayRenderer.
 * Continuous fields are left for canvas2d; this draws polygons / group outlines.
 */
export class SvgOverlayRenderer implements OverlayRenderer {
  readonly kind = "svg" as const;
  private geometry: BoardGeometry | null = null;
  private svg: SVGSVGElement | null = null;
  private group: SVGGElement | null = null;

  constructor(host: SVGSVGElement) {
    this.svg = host;
    const g = host.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    g.setAttribute("class", "yagoo-overlay-root");
    host.appendChild(g);
    this.group = g;
  }

  setGeometry(geometry: BoardGeometry): void {
    this.geometry = geometry;
  }

  draw(data: OverlayData): void {
    if (this.group == null || this.geometry == null) return;
    this.clear();

    for (const outline of data.groupOutlines ?? []) {
      const path = this.group.ownerDocument!.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute(
        "d",
        verticesToOutlinePath(this.geometry, outline.vertices),
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", outline.color ?? "#0082F0");
      path.setAttribute(
        "stroke-width",
        String(outline.strokeWidth ?? 2),
      );
      if (outline.dasharray) {
        path.setAttribute("stroke-dasharray", outline.dasharray);
      }
      path.setAttribute("class", "yagoo-group-outline");
      if (outline.groupId) {
        path.setAttribute("data-group-id", outline.groupId);
      }
      this.group.appendChild(path);
    }

    for (const poly of data.polygons ?? []) {
      const path = this.group.ownerDocument!.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      const d =
        poly.vertices.length === 0
          ? ""
          : `M ${poly.vertices.map(([x, y]) => `${x} ${y}`).join(" L ")} Z`;
      path.setAttribute("d", d);
      path.setAttribute("fill", poly.color ?? "rgba(0,130,240,0.2)");
      path.setAttribute("stroke", poly.color ?? "#0082F0");
      path.setAttribute("class", "yagoo-overlay-polygon");
      this.group.appendChild(path);
    }

    for (const line of data.lines ?? []) {
      const path = this.group.ownerDocument!.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      path.setAttribute("x1", String(line.from[0]));
      path.setAttribute("y1", String(line.from[1]));
      path.setAttribute("x2", String(line.to[0]));
      path.setAttribute("y2", String(line.to[1]));
      path.setAttribute("stroke", line.color ?? "#5E2E0C");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("class", "yagoo-overlay-line");
      this.group.appendChild(path);
    }
  }

  clear(): void {
    if (this.group == null) return;
    while (this.group.firstChild) {
      this.group.removeChild(this.group.firstChild);
    }
  }

  dispose(): void {
    this.clear();
    this.group?.remove();
    this.group = null;
    this.svg = null;
    this.geometry = null;
  }
}
