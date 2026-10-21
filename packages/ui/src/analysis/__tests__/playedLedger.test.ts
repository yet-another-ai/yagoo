import { describe, expect, it } from "vitest";
import recorded from "../__fixtures__/comparison-positions.json";
import type { PositionSnapshot } from "../types";
import { isAlignedComparison } from "../comparison";

const snapshots = recorded as PositionSnapshot[];
const source = snapshots.find((snapshot) => snapshot.ply === 44)!.comparison!;

describe("recorded played-move ledger evidence", () => {
  it("retains played/pass value independently of actual/AI loss and supports both mover colors", () => {
    for (const snapshot of snapshots) expect(isAlignedComparison(snapshot.comparison, snapshot.ply, 19)).toBe(true);
    const equal = snapshots.find((snapshot) => snapshot.ply === 43)!.comparison!;
    expect(equal.scoreLoss).toBe(0);
    expect(equal.playedLedger!.value).toBeCloseTo(25.72956312, 8);
    expect(source.playedLedger!.value).toBeCloseTo(17.52223888, 8);
    expect(source.playedTempo).toContainEqual(expect.objectContaining({
      groupId: "Q4", color: "W", beforeStatus: "weak", afterStatus: "settled",
    }));
    expect(source.playedLedger!.rootPly).toBe(43);
    expect(source.playedLedger!.referenceMove).toBe("pass");
  });

  it("rejects copied values, later-root baselines, malformed collections, and fabricated transitions", () => {
    const corruptions = [
      (copy: typeof source) => { copy.playedLedger!.rootPly = 44; },
      (copy: typeof source) => { copy.playedLedger!.value += 1; },
      (copy: typeof source) => { copy.playedLedger!.ledger[0]!.bookValue += 1; },
      (copy: typeof source) => { copy.playedLedger!.ledger[0]!.intersections = ["A19", "A19"]; },
      (copy: typeof source) => { copy.context.passQueryId = null; },
      (copy: typeof source) => { copy.context.actualBranch!.passQueryId = null; },
      (copy: typeof source) => { copy.playedTempo![0]!.beforeGPlus += 0.1; },
      (copy: typeof source) => { copy.playedTempo![0]!.afterStatus = "likely_seki"; },
      (copy: typeof source) => { copy.playedTempo = [null as never]; },
      (copy: typeof source) => { copy.playedLedger!.ledger = [null as never]; },
      (copy: typeof source) => { copy.playedLedger!.ledger[0]!.strengthChanges = [null as never]; },
      (copy: typeof source) => { copy.playedLedger!.ledger[0]!.strengthChanges![0]!.reference = "wrong" as never; },
      (copy: typeof source) => { copy.playedLedger!.ledger.find((line) => line.kind === "other")!.kind = "own_territory"; },
      (copy: typeof source) => { delete copy.playedTempo; },
      (copy: typeof source) => { copy.playedLedger!.ledger[0]!.kind = "other"; },
    ];
    for (const corrupt of corruptions) {
      const copy = structuredClone(source);
      corrupt(copy);
      expect(isAlignedComparison(copy, 44, 19)).toBe(false);
    }
  });

  it("accepts older recordings without optional played claims and unavailable pass evidence without inventing value", () => {
    const old = structuredClone(source);
    delete old.playedLedger;
    delete old.playedTempo;
    expect(isAlignedComparison(old, 44, 19)).toBe(true);
    old.context.passProbe = null;
    old.context.passQueryId = null;
    old.playedLedger = null;
    old.playedTempo = [];
    expect(isAlignedComparison(old, 44, 19)).toBe(true);
  });
});
