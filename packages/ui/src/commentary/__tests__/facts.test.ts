import { describe, expect, it } from "vitest";
import recorded from "../../analysis/__fixtures__/ledger-position.json";
import { reducePipelineEvent } from "../../analysis/reduce";
import { createInitialAnalysisState, type PositionSnapshot } from "../../analysis/types";
import { buildCommentaryFacts, renderCommentary, resolveCommentary, type CommentaryInput } from "../facts";

const snapshot = recorded as PositionSnapshot;
const event = { type: "positionCompleted", v: 1, phase: "deep", snapshot } as const;
const state = reducePipelineEvent(createInitialAnalysisState(), event);
const input = state.plies[snapshot.ply]!;

function pointer(root: unknown, path: string): unknown {
  return path.split("/").slice(1).reduce((value, key) =>
    (value as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")], root);
}

describe("commentary facts from the recorded ledger position", () => {
  it("cites exact source values and keeps unpriced shares separate from search points", () => {
    const facts = buildCommentaryFacts(input);
    expect(facts.length).toBeGreaterThan(5);
    for (const fact of facts) {
      expect(fact.evidence.length).toBeGreaterThan(1);
      for (const source of fact.evidence) {
        expect(pointer(state, source.path), `${fact.id}: ${source.path}`).toEqual(source.value);
      }
    }
    expect(facts.find((f) => f.id.endsWith("/ledger-search"))?.variants[0])
      .toContain("+24.2 points versus pass, from Black's perspective");
    expect(renderCommentary(facts).text).toContain("unpriced");
    const lines = facts.filter((f) => f.id.includes("/ledger-line-"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((f) => f.variants[0]!.includes("unpriced"))).toBe(true);
    expect(lines.some((f) => /\bpoints\b/.test(f.variants[0]!))).toBe(false);
    expect(JSON.stringify(facts)).not.toContain("31.8 points");
    expect(JSON.stringify(facts)).not.toMatch(/severe mistake|became dead|saved the group/);
  });

  it("refuses priced assertions when the consistency and scaling flags disagree", () => {
    for (const flags of [
      { consistent: false, scaling: "score" as const },
      { consistent: true, scaling: "proportions" as const },
    ]) {
      const ledger = structuredClone(input.ledger!);
      Object.assign(ledger, flags);
      ledger.ledger[0]!.points = 999;
      const facts = buildCommentaryFacts({ ...input, ledger });
      expect(facts.find((f) => f.id.endsWith("/ledger-line-0"))?.variants[0]).toContain("unpriced");
      expect(JSON.stringify(facts)).not.toContain("999");
    }
  });

  it("requires matching root ply and mover before explaining a ledger", () => {
    for (const changed of [
      { rootPly: input.ply + 1 },
      { mover: "W" as const },
      { value: Number.NaN },
    ]) {
      const facts = buildCommentaryFacts({ ...input, ledger: { ...input.ledger!, ...changed } });
      expect(facts.some((f) => f.id.includes("/ledger-"))).toBe(false);
    }
  });

  it("states signed mover-relative search values without changing Black-positive comparison scores", () => {
    const facts = buildCommentaryFacts({
      ...input,
      toPlay: "W",
      ledger: { ...input.ledger!, mover: "W", value: -2.25 },
      comparison: {
        ply: input.ply, rootPly: input.ply - 1, mover: "W", actualMove: "D4", aiMove: "Q16",
        actualWinrate: 0.4, aiWinrate: 0.6,
        actualScoreLead: 4, aiScoreLead: 1, ledgerDiff: null,
      } as NonNullable<CommentaryInput["comparison"]>,
    });
    expect(facts.find((f) => f.id.endsWith("/ledger-search"))?.variants[0]).toContain("-2.3 points versus pass, from White's perspective");
    expect(facts.find((f) => f.id.endsWith("/comparison-score"))?.variants[0]).toContain("Black-positive score leads are +4.0 points for D4 and +1.0 points for Q16");
    expect(facts.find((f) => f.id.endsWith("/comparison-winrate"))?.variants[0]).toContain("40.0% winrate for D4 and 60.0% for Q16");
  });

  it("explains the played move only from its historical comparison, never the next root", () => {
    // Labelled synthetic comparison; the ledger above is the recorded fixture.
    // Only fields consumed by commentary are mocked; no engine was queried.
    const comparison = {
      ply: 50, rootPly: 49, mover: "W", actualMove: "D4", aiMove: "Q16",
      actualWinrate: 0.4, aiWinrate: 0.6, winrateLoss: 0.2,
      actualScoreLead: 4, aiScoreLead: 1, scoreLoss: 3,
      ledgerDiff: {
        ...structuredClone(input.ledger!), rootPly: 49, mover: "W",
        move: "D4", referenceMove: "Q16", vs: "best", value: -3,
      },
      groupTempo: [{
        groupId: "D4", color: "W", stones: ["D4", "D5"],
        actualStatus: "weak", preferredStatus: "settled",
      }],
    } as NonNullable<CommentaryInput["comparison"]>;
    const current = { ...input, toPlay: "B", comparison };
    const facts = buildCommentaryFacts(current);
    const played = facts.filter((f) => f.id.includes("/comparison-"));
    const source = { plies: { 50: current } };
    for (const fact of played) {
      for (const ref of fact.evidence) expect(pointer(source, ref.path)).toEqual(ref.value);
      expect(fact.evidence.every((ref) => ref.path === "/plies/50/ply" ||
        ref.path.startsWith("/plies/50/comparison/"))).toBe(true);
    }
    expect(played.find((f) => f.id.endsWith("/comparison-score-loss"))?.variants[0])
      .toContain("+3.0 points from White's perspective at root ply 49");
    expect(played.find((f) => f.id.endsWith("/comparison-winrate-loss"))?.variants[0])
      .toContain("+20.0 percentage points at root ply 49");
    expect(played.find((f) => f.id.endsWith("/comparison-ledger-search"))?.variants[0])
      .toContain("-3.0 points versus Q16, from White's perspective");
    expect(played.find((f) => f.id.endsWith("/comparison-tempo-0"))?.variants[0])
      .toContain("D4 line as weak and the Q16 line as settled");
    expect(played.find((f) => f.id.endsWith("/comparison-tempo-0"))?.target?.intersections)
      .toEqual(["D4", "D5"]);

    for (const bad of [
      { rootPly: 50 }, { rootPly: undefined }, { mover: undefined },
    ]) {
      expect(buildCommentaryFacts({
        ...current,
        comparison: { ...comparison, ...bad } as unknown as CommentaryInput["comparison"],
      })
        .some((f) => f.id.includes("/comparison-"))).toBe(false);
    }
    const inconsistent = buildCommentaryFacts({
      ...current, comparison: { ...comparison, scoreLoss: -3, winrateLoss: 0.8 },
    });
    expect(inconsistent.some((f) => f.id.endsWith("-loss"))).toBe(false);
  });

  it("omits missing or invalid facts and does not infer judgments from strength or deltas", () => {
    expect(buildCommentaryFacts({ ply: -1, root: { scoreLead: 3 } })).toEqual([]);
    const malformed: CommentaryInput = {
      ply: 0, root: { scoreLead: Infinity },
      candidates: [{ move: "invented", visits: 5 }, { move: "D4", visits: -5 }],
      groups: [{ ...input.groups[0]!, groupId: "D4", status: undefined, delta: 0.99, strength: { black: 0.01 } }],
    };
    expect(buildCommentaryFacts(malformed)).toEqual([]);
  });

  it("omits malformed optional collections instead of crashing the notes panel", () => {
    for (const invalid of [{}, [null]]) {
      const facts = buildCommentaryFacts({
        ...input,
        groups: invalid,
        sacrifices: invalid,
        candidates: invalid,
        ledger: { ...input.ledger!, ledger: invalid },
        comparison: { ply: input.ply, actualMove: 42, aiMove: "D4" },
      } as unknown as CommentaryInput);
      expect(facts.some((fact) => fact.id.endsWith("/ledger-search"))).toBe(true);
      expect(facts.some((fact) => /\/(?:group-|sacrifice-|candidate-|ledger-line-|comparison-)/.test(fact.id))).toBe(false);
    }
  });

  it("clears persisted notes when new authoritative evidence is reduced", () => {
    const before = structuredClone(state);
    before.plies[snapshot.ply]!.commentary = renderCommentary(buildCommentaryFacts(input));
    const after = reducePipelineEvent(before, event);
    expect(after.plies[snapshot.ply]!.commentary).toBeNull();
    expect(before.plies[snapshot.ply]!.commentary).not.toBeNull();
    const nextGame = reducePipelineEvent(before, {
      type: "gameStarted", v: 1, size: 19, komi: 7.5, moveCount: 2,
      positionCount: 3, strategy: "full",
    });
    expect(nextGame.plies).toEqual({});
  });

  it("revalidates stored clauses and exact evidence before reports reuse them", () => {
    const facts = buildCommentaryFacts(input);
    const selected = facts.filter((f) => f.id.endsWith("/ledger-search"));
    const notes = renderCommentary(selected, undefined, "mock selector", true);
    expect(resolveCommentary(facts, notes)).toEqual(notes);
    expect(resolveCommentary(facts, { ...notes, text: "Black is dead." }).verified).toBe(false);
    const changed = buildCommentaryFacts({
      ...input, ledger: { ...input.ledger!, value: input.ledger!.value + 0.000001 },
    });
    expect(changed.find((f) => f.id === selected[0]!.id)?.variants[0]).toBe(selected[0]!.variants[0]);
    const stale = resolveCommentary(changed, notes);
    expect(stale.verified).toBe(false);
    expect(stale.fallbackReason).toContain("current approved facts");
    expect(resolveCommentary(facts, { ...notes, factEvidence: {} }).verified).toBe(false);
    expect(resolveCommentary(facts, { ...notes, citedFactIds: ["invented"] }).verified).toBe(false);
    expect(resolveCommentary(facts, null)).toEqual(renderCommentary(facts));
  });
});
