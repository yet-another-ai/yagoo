import { describe, expect, it } from "vitest";
import recorded from "../__fixtures__/comparison-positions.json";
import type { PositionSnapshot } from "../types";
import { isAlignedComparison } from "../comparison";
import { parseGtpVertex } from "../coords";
import type { GainLossLine } from "../modules";

const snapshots = recorded as PositionSnapshot[];
const source = snapshots.find((snapshot) => snapshot.ply === 44)!.comparison!;

// Synthetic mutation of recorded data to exercise pass identity. This is not a
// genuine engine recording of a pass, and is not calibration evidence.
function constructedPassComparison(ply: number) {
  const copy = structuredClone(snapshots.find((snapshot) => snapshot.ply === ply)!.comparison!);
  copy.actualMove = "pass";
  copy.context.actual.move = "pass";
  if (copy.ledgerDiff) copy.ledgerDiff.move = "pass";
  copy.playedTempo = [];
  copy.context.actualBranch = null;
  const size = copy.context.board.size;
  const actual = copy.context.actual.ownership!;
  const sign = copy.mover === "B" ? 1 : -1;
  const occupied = new Set([...copy.context.board.black, ...copy.context.board.white]);
  const all = copy.playedLedger!.ledger.flatMap((line) => line.intersections);
  const ledger: GainLossLine[] = [];
  for (const kind of ["own_territory", "reduce_opponent", "other"] as const) {
    const intersections = all.filter((stone) => {
      const [x, y] = parseGtpVertex(stone, size)!;
      return kind === (occupied.has(stone) ? "other"
        : sign * actual[y * size + x]! >= 0 ? "own_territory" : "reduce_opponent");
    });
    if (intersections.length) ledger.push({ kind, intersections, bookValue: 0, proportion: 0, points: null });
  }
  copy.playedLedger = {
    ...copy.playedLedger!, move: "pass", value: 0, bookTotal: 0,
    consistent: false, inconsistency: "zero_book", scaling: "proportions", ledger,
  };
  return copy;
}

describe("recorded played-move ledger evidence", () => {
  it.each([43, 44])("aliases a constructed pass despite differing recorded estimates at ply %i", (ply) => {
    const copy = constructedPassComparison(ply);
    const original = snapshots.find((snapshot) => snapshot.ply === ply)!.comparison!;
    expect(copy.context.actual.scoreLead).not.toBe(copy.context.passProbe!.scoreLead);
    expect(copy.context.actual.ownership).not.toEqual(copy.context.passProbe!.ownership);
    expect(isAlignedComparison(copy, ply, 19)).toBe(true);
    expect(copy.scoreLoss).toBe(original.scoreLoss);
    expect(copy.winrateLoss).toBe(original.winrateLoss);
    const malformed = structuredClone(copy);
    malformed.context.passProbe!.ownership = [0];
    expect(isAlignedComparison(malformed, ply, 19)).toBe(false);
    const fabricatedPoints = structuredClone(copy);
    fabricatedPoints.playedLedger!.ledger[0]!.points = 1;
    expect(isAlignedComparison(fabricatedPoints, ply, 19)).toBe(false);
    const fabricated = structuredClone(copy);
    fabricated.playedLedger = { ...structuredClone(original.playedLedger!), move: "pass" };
    for (const line of fabricated.playedLedger.ledger) {
      delete line.playedTempoChanges;
      if (line.kind === "group") line.tempo = "unassessed";
    }
    expect(isAlignedComparison(fabricated, ply, 19)).toBe(false);
    copy.context.passProbe = null;
    expect(isAlignedComparison(copy, ply, 19)).toBe(false);
    copy.playedLedger = null;
    expect(isAlignedComparison(copy, ply, 19)).toBe(true);
  });

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
