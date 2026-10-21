import { translate } from "../i18n/active";
import type { Vertex } from "../types";
import { parseGtpVertex } from "./coords";
import type {
  GroupSnapshot,
  GroupStatus,
} from "./types";

/** Sabaki-ish outline colors by group status / kind. */
export function groupOutlineColor(group: GroupSnapshot): string {
  switch (group.status) {
    case "dead":
      return "#F02311";
    case "tempo_critical":
      return "#F0A000";
    case "weak":
      return "#E67E22";
    case "likely_seki":
      return "#92278F";
    case "settled":
      return groupPrimaryColor(group) === "W" ? "#9aa3ad" : "#4a7c59";
    default:
      return group.kind === "contested" ? "#92278F" : "#0082F0";
  }
}

/** Dominant stone color in the group (for panel swatch). */
export function groupPrimaryColor(group: GroupSnapshot): "B" | "W" | "mixed" {
  const b = group.members.blackStones.length;
  const w = group.members.whiteStones.length;
  if (b > 0 && w > 0) return "mixed";
  if (w > 0) return "W";
  return "B";
}

export function groupStoneCount(group: GroupSnapshot): number {
  return group.members.blackStones.length + group.members.whiteStones.length;
}

export function groupValueLabel(group: GroupSnapshot): string {
  const s = group.strength;
  if (s?.black != null && s?.white != null) {
    return translate("groups.strengthBoth", {
      black: s.black.toFixed(2),
      white: s.white.toFixed(2),
    });
  }
  if (s?.black != null) return translate("groups.strengthBlack", { value: s.black.toFixed(2) });
  if (s?.white != null) return translate("groups.strengthWhite", { value: s.white.toFixed(2) });
  if (group.gPlus != null) return translate("groups.strengthPlus", { value: group.gPlus.toFixed(2) });
  return "—";
}

export function groupStatusLabel(status: GroupStatus | undefined): string {
  const key = `groups.status.${status ?? "unknown"}`;
  const via = translate(key);
  return via === key ? "—" : via;
}

/** All board vertices belonging to the group (stones + empties). */
export function groupMemberVertices(
  group: GroupSnapshot,
  size: number,
): Vertex[] {
  const out: Vertex[] = [];
  const seen = new Set<string>();
  const add = (gtp: string) => {
    const v = parseGtpVertex(gtp, size);
    if (v == null) return;
    const key = `${v[0]},${v[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  for (const s of group.members.blackStones) add(s);
  for (const s of group.members.whiteStones) add(s);
  for (const s of group.members.empty) add(s);
  return out;
}

/** Stone-only vertices (for outlines that should not cover empty eye space). */
export function groupStoneVertices(
  group: GroupSnapshot,
  size: number,
): Vertex[] {
  const out: Vertex[] = [];
  const seen = new Set<string>();
  const add = (gtp: string) => {
    const v = parseGtpVertex(gtp, size);
    if (v == null) return;
    const key = `${v[0]},${v[1]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };
  for (const s of group.members.blackStones) add(s);
  for (const s of group.members.whiteStones) add(s);
  return out;
}

export interface GroupOutlineSpec {
  vertices: Vertex[];
  color: string;
  groupId: string;
  strokeWidth: number;
  dasharray?: string;
}

/**
 * Build overlay outlines for all groups. When `focusId` is set, emphasize that
 * group (thicker stroke) and still draw others faintly.
 */
export function buildGroupOutlines(
  groups: GroupSnapshot[],
  size: number,
  focusId?: string | null,
): GroupOutlineSpec[] {
  return groups
    .map((g) => {
      const focused = focusId != null && g.groupId === focusId;
      const dimOthers = focusId != null && !focused;
      const deadish =
        g.status === "dead" || g.status === "weak" || g.status === "tempo_critical";
      return {
        groupId: g.groupId,
        vertices: groupStoneVertices(g, size),
        color: groupOutlineColor(g),
        strokeWidth: focused ? 3.5 : dimOthers ? 1.25 : 2,
        dasharray: deadish && !focused ? "5 3" : undefined,
      };
    })
    .filter((o) => o.vertices.length > 0);
}

/** Map vertex key `"x,y"` → groupId for hover hit-testing. */
export function buildGroupVertexIndex(
  groups: GroupSnapshot[],
  size: number,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of groups) {
    for (const v of groupMemberVertices(g, size)) {
      const key = `${v[0]},${v[1]}`;
      // First group wins if overlapping (rare for teaching fixtures).
      if (!map.has(key)) map.set(key, g.groupId);
    }
  }
  return map;
}

/** Dim every board intersection except members of `focus`. */
export function dimVerticesOutsideGroup(
  focus: GroupSnapshot | null | undefined,
  size: number,
): Vertex[] {
  if (focus == null) return [];
  const keep = new Set(
    groupMemberVertices(focus, size).map(([x, y]) => `${x},${y}`),
  );
  const dimmed: Vertex[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!keep.has(`${x},${y}`)) dimmed.push([x, y]);
    }
  }
  return dimmed;
}
