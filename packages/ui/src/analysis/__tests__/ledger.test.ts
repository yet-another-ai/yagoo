import { describe, expect, it } from "vitest";
import recorded from "../__fixtures__/ledger-position.json";
import { reducePipelineEvent } from "../reduce";
import { createInitialAnalysisState, type PipelineEvent, type PositionSnapshot } from "../types";

const snapshot = recorded as PositionSnapshot;
const event: PipelineEvent = {
  type: "positionCompleted",
  v: 1,
  phase: "deep",
  snapshot,
};

describe("recorded ledger reduction", () => {
  it("uses server attribution without computing points in the browser", () => {
    const before = createInitialAnalysisState();
    const after = reducePipelineEvent(before, event);
    expect(after.plies[snapshot.ply]?.ledger).toEqual(snapshot.ledger);
    expect(before.plies[snapshot.ply]).toBeUndefined();
    expect(after.plies[snapshot.ply]?.ledger?.ledger.length).toBeGreaterThan(0);
    expect(after.plies[snapshot.ply]?.ledger?.referenceMove).toBe("pass");
  });

  it("clears stale data on authoritative null or absent legacy snapshots", () => {
    const state = reducePipelineEvent(createInitialAnalysisState(), event);
    for (const ledger of [null, undefined]) {
      const updated = reducePipelineEvent(state, {
        ...event,
        snapshot: { ...snapshot, ledger },
      });
      expect(updated.plies[snapshot.ply]?.ledger).toBeNull();
      expect(state.plies[snapshot.ply]?.ledger).toEqual(snapshot.ledger);
    }
  });
});
