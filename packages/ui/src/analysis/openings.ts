import sgf from "@sabaki/sgf";
import catalogue from "../../../../data/openings.json";
import type { OpeningMatch } from "./modules";
import type { ColorToken } from "./types";
import type { Vertex } from "../types";

/** Actual move order, including passes; never inferred from board occupancy. */
export interface OpeningMove {
  color: ColorToken;
  point: Vertex | null;
}

function transform([a, b]: Vertex, size: number, symmetry: number): Vertex {
  let [x, y] = [a, b];
  if (symmetry >= 4) x = size - 1 - x;
  for (let i = 0; i < symmetry % 4; i++) [x, y] = [size - 1 - y, x];
  return [x, y];
}

/**
 * Same conservative algorithm/catalogue as yagoo-snapshot::match_opening.
 * See data/OPENINGS_PROVENANCE.md for bounds and interpretation.
 */
export function matchOpening(
  size: number,
  hasSetup: boolean,
  moves: readonly OpeningMove[],
): OpeningMatch | null {
  if (size !== catalogue.boardSize || hasSetup) return null;
  const observed = moves.slice(0, catalogue.maxPly);
  if (
    observed.some(({ point }) =>
      point?.some((n) => !Number.isInteger(n) || n < 0 || n >= size),
    )
  ) return null;
  for (const kind of ["fuseki", "joseki"]) {
    const candidates: Array<{
      line: (typeof catalogue.lines)[number];
      matched: number;
      deviation: number | null;
    }> = [];
    for (const line of catalogue.lines.filter((line) => line.kind === kind)) {
      for (let symmetry = 0; symmetry < 8; symmetry++) {
        for (const swap of [false, true]) {
          let matched = 0;
          let deviation: number | null = null;
          for (let i = 0; i < observed.length; i++) {
            if (matched === line.moves.length) break;
            const { color, point } = observed[i]!;
            if (point == null) {
              if (kind === "fuseki") deviation = i + 1;
              break;
            }
            const [x, y] = transform(point, size, symmetry);
            if (
              kind === "joseki" &&
              (x >= catalogue.cornerSize || y >= catalogue.cornerSize)
            ) continue;
            const expected = line.moves[matched]!;
            const black = (color === "B") !== swap;
            if (
              black === (expected[0] === "B") &&
              x === expected[1] && y === expected[2]
            ) {
              matched++;
            } else {
              deviation = i + 1;
              break;
            }
          }
          if (matched >= line.minimum) {
            candidates.push({ line, matched, deviation });
          }
        }
      }
    }
    const length = Math.max(0, ...candidates.map((c) => c.matched));
    const best = candidates.filter((c) => c.matched === length);
    const first = best[0];
    if (!first || best.some((c) => c.line.id !== first.line.id)) continue;
    return {
      name: first.line.name,
      joseki: first.line.joseki ?? null,
      deviationPly: best.every((c) => c.deviation === first.deviation)
        ? first.deviation
        : null,
      source: catalogue.source,
    };
  }
  return null;
}

/** Parse the first game's main line. Setup/edit nodes are outside this book. */
export function matchSgfOpening(contents: string): OpeningMatch | null {
  try {
    interface SgfNode {
      data: Record<string, string[]>;
      children: SgfNode[];
    }
    const roots = sgf.parse(contents) as unknown as SgfNode[];
    let node: SgfNode | undefined = roots[0];
    if (!node) return null;
    const size = Number(node.data.SZ?.[0] ?? 19);
    let hasSetup = Number(node.data.HA?.[0] ?? 0) > 0;
    const moves: OpeningMove[] = [];
    while (node && moves.length < catalogue.maxPly) {
      const data = node.data;
      hasSetup ||= ["AB", "AW", "AE"].some((key) => data[key]?.length);
      if (data.B && data.W) return null;
      const color = data.B ? "B" : data.W ? "W" : null;
      if (color) {
        const values = data[color]!;
        if (values.length !== 1) return null;
        const raw = values[0]!;
        // FF[4] pass and the legacy 19x19 pass notation.
        if (raw === "" || (size <= 19 && raw === "tt")) {
          moves.push({ color, point: null });
        } else if (/^[a-s]{2}$/.test(raw)) {
          moves.push({
            color,
            point: [raw.charCodeAt(0) - 97, raw.charCodeAt(1) - 97],
          });
        } else {
          return null;
        }
      }
      node = node.children[0];
    }
    return matchOpening(size, hasSetup, moves);
  } catch {
    return null;
  }
}
