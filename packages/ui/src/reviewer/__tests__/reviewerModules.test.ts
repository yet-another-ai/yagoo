import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createInitialAnalysisState } from "../../analysis/types";
import MoveInspector from "../MoveInspector.vue";
import ReviewReport from "../ReviewReport.vue";
import { keyMovesFromState } from "../keyMoves";
import type { Sign } from "../../types";
import { applyTryMoves } from "../tryBranch";

describe("keyMovesFromState", () => {
  it("lists swing plies without inventing comparison text", () => {
    const state = createInitialAnalysisState();
    state.deepPlies = [10, 4];
    state.deepReasons = [
      {
        ply: 4,
        score: 1,
        winrateDelta: 0.1,
        scoreLeadDelta: 2,
        ownershipDelta: 0.05,
      },
    ];
    state.plies[4] = {
      ply: 4,
      rootPartial: false,
      candidates: [
        { move: "Q16", order: 1 },
        { move: "D4", order: 0 },
      ],
      groups: [],
      complete: true,
      ledger: null,
      comparison: null,
      sacrifices: null,
      commentary: null,
    };
    const rows = keyMovesFromState(state);
    expect(rows.map((row) => row.ply)).toEqual([4, 10]);
    expect(rows[0]?.topMove).toBe("D4");
    expect(rows[0]?.winrateDelta).toBe(0.1);
    expect(rows[1]?.topMove).toBeNull();
    expect(state.report).toBeNull();
  });
});

describe("applyTryMoves", () => {
  it("plays on an empty point and rejects an occupied one", () => {
    const anchor = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ] as const;
    const played = applyTryMoves(3, anchor.map((row) => [...row]), 1, [[0, 0]]);
    expect(played?.signMap[0]?.[0]).toBe(1);
    expect(played?.toPlay).toBe(-1);
    expect(played?.captures).toEqual({ black: 0, white: 0 });
    expect(
      applyTryMoves(3, anchor.map((row) => [...row]), 1, [[1, 1]]),
    ).toBeNull();
  });

  it("counts captures made by the try sequence", () => {
    const empty = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => 0 as Sign),
    );
    const played = applyTryMoves(5, empty, 1, [
      [0, 1],
      [0, 0],
      [1, 0],
    ]);
    expect(played?.signMap[0]?.[0]).toBe(0);
    expect(played?.signMap[1]?.[0]).toBe(1);
    expect(played?.signMap[0]?.[1]).toBe(1);
    expect(played?.toPlay).toBe(-1);
    expect(played?.captures).toEqual({ black: 1, white: 0 });
  });
});

describe("MoveInspector contracts", () => {
  it("renders a provided ledger and an empty sacrifice slot", () => {
    const wrapper = mount(MoveInspector, {
      props: {
        candidates: [],
        initialPerspective: "ledger",
        ledger: {
          rootPly: 0,
          mover: "B",
          move: "Q16",
          vs: "pass",
          referenceMove: "pass",
          value: 4.5,
          consistent: true,
          bookTotal: 4.5,
          scaling: "score",
          ledger: [
            {
              kind: "group",
              id: "D4",
              change: "weak->settled",
              points: 3.2,
              bookValue: 3.2,
              proportion: 1,
              intersections: ["D4"],
              tempo: "unassessed",
            },
          ],
        },
        sacrifices: null,
      },
    });
    expect(wrapper.get('[data-testid="ledger-body"]').text()).toMatch(/D4/);
    expect(wrapper.get('[data-testid="ledger-body"]').text()).toMatch(/Tempo transitions are unassessed/);
    expect(wrapper.text()).not.toMatch(/Coming in #23/);

    return wrapper
      .get('[data-testid="perspective-sacrifice"]')
      .trigger("click")
      .then(() => {
        expect(wrapper.get("#yagoo-panel-sacrifice").text()).toMatch(
          /Sacrifice assessment is unavailable/,
        );
      });
  });
});

describe("ReviewReport", () => {
  it("shows real key-move deltas and a #29 placeholder when no document is attached", () => {
    const wrapper = mount(ReviewReport, {
      props: {
        report: null,
        rows: [
          {
            ply: 50,
            winrateDelta: 0.5,
            scoreLeadDelta: -1.5,
            ownershipDelta: 0.2,
            topMove: "R14",
          },
        ],
      },
    });
    const text = wrapper.text();
    expect(text).toMatch(/Coming in #29/);
    expect(text).toMatch(/Move 50/);
    expect(text).toMatch(/R14/);
    expect(text).toMatch(/\+50\.0 pp/);
    expect(text).not.toMatch(/this move is a mistake because/i);
  });
});
