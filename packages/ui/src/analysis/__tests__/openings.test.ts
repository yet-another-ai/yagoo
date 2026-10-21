import { describe, expect, it } from "vitest";
import cases from "../../../../../data/openings-cases.json";
import sgfCases from "../../../../../data/openings-sgf-cases.json";
import { matchOpening, matchSgfOpening, type OpeningMove } from "../openings";
import type { Vertex } from "../../types";

function oriented([a, b]: Vertex, symmetry: number): Vertex {
  let [x, y] = [a, b];
  if (symmetry >= 4) x = 18 - x;
  for (let i = 0; i < symmetry % 4; i++) [x, y] = [18 - y, x];
  return [x, y];
}

describe("opening matcher (shared Rust/browser cases)", () => {
  for (const test of cases) {
    it(test.description, () => {
      for (let symmetry = 0; symmetry < 8; symmetry++) {
        for (const swap of [false, true]) {
          const moves: OpeningMove[] = test.moves.map(([color, point]) => ({
            color: (color === "B") !== swap ? "B" : "W",
            point: point == null ? null : oriented(point as Vertex, symmetry),
          }));
          const actual = matchOpening(19, false, moves);
          if (test.name == null) {
            expect(actual).toBeNull();
          } else {
            expect(actual).toEqual({
              name: test.name,
              joseki: test.joseki ?? null,
              deviationPly: test.deviation ?? null,
              source: "yagoo-starter-1 (Apache-2.0)",
            });
          }
        }
      }
    });
  }

  it("rejects setup, unsupported boards, invalid points, and late patterns", () => {
    const moves: OpeningMove[] = [
      { color: "B", point: [3, 2] },
      { color: "W", point: [5, 2] },
      { color: "B", point: [4, 3] },
    ];
    expect(matchOpening(19, true, moves)).toBeNull();
    expect(matchOpening(9, false, moves)).toBeNull();
    expect(matchOpening(19, false, [{ color: "B", point: [NaN, 2] }])).toBeNull();
    expect(matchOpening(19, false, [
      ...Array.from({ length: 30 }, (): OpeningMove => ({ color: "B", point: [9, 9] })),
      ...moves,
    ])).toBeNull();
  });
});

describe("SGF opening recognition without an engine", () => {
  it.each(sgfCases)("agrees with native setup support: $description", ({ sgf, name }) => {
    expect(matchSgfOpening(sgf)?.name ?? null).toBe(name);
  });

  it("uses only the first game's main line and ignores comments", () => {
    const actual = matchSgfOpening("(;SZ[19]C[B[dd\\] is commentary];B[dd];W[cc];B[dc](;W[cd])(;W[ce]))(;SZ[19];B[pd])");
    expect(actual?.joseki).toBe("3-3 invasion: block and extend");
    expect(actual?.deviationPly).toBeNull();
  });

  it("recognizes White first with explicit color swap", () => {
    expect(matchSgfOpening("(;SZ[19]PL[W];W[dd];B[cc];W[dc];B[cd])")?.name).toBe("4-4 point");
  });

  it("counts moves rather than comment-only SGF nodes", () => {
    const actual = matchSgfOpening("(;SZ[19];B[dd];C[note];W[cc];B[dc];W[ce])");
    expect(actual?.deviationPly).toBe(4);
  });

  it.each([
    "",
    "(;SZ[9];B[dc];W[fc];B[ed])",
    "(;SZ[19]AB[ss];B[dd];W[cc];B[dc];W[cd])",
    "(;SZ[19];B[dd];AE[ss];W[cc];B[dc];W[cd])",
    "(;SZ[19]HA[2];B[dd];W[cc];B[dc];W[cd])",
    "(;SZ[19];B[dd]W[cc];B[dc])",
    "(;SZ[19];B[zz];W[cc];B[dc])",
  ])("does not label an unsupported/invalid game: %s", (sgf) => {
    expect(matchSgfOpening(sgf)).toBeNull();
  });
});
