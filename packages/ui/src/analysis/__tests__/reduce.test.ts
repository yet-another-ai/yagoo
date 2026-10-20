import { describe, expect, it } from "vitest";
import fixtureText from "../__fixtures__/sample-scan-deep.ndjson?raw";
import {
  parseNdjson,
  reducePipelineEvent,
  reducePipelineEvents,
} from "../reduce";
import { createInitialAnalysisState, type PipelineEvent } from "../types";
import { buildReviewSeries } from "../display";

const fixtureEvents = parseNdjson(fixtureText);
/** Representative deepened ply from the real KataGo sample fixture. */
const DEEP_PLY = 50;
const DEEP_PLIES = [43, 44, 47, 49, 50, 60, 79, 95];
/** Deep visits from `mise run fixtures:regen` (maxVisits may round slightly above). */
const DEEP_VISITS = 503;

describe("parseNdjson / fixture format", () => {
  it("parses real 19×19 pipeline NDJSON from recorded KataGo fixture", () => {
    expect(fixtureEvents.length).toBeGreaterThan(10);
    expect(fixtureEvents[0]?.type).toBe("gameStarted");
    if (fixtureEvents[0]?.type === "gameStarted") {
      expect(fixtureEvents[0].size).toBe(19);
      expect(fixtureEvents[0].moveCount).toBeGreaterThanOrEqual(60);
    }
    expect(fixtureEvents.at(-1)?.type).toBe("gameCompleted");
    expect(fixtureEvents.some((e) => e.type === "deepPliesSelected")).toBe(
      true,
    );
    // Partials are off in the committed real fixture (final responses only).
    expect(fixtureEvents.some((e) => e.type === "stagePartial")).toBe(false);
    // Teaching groups (块) from pipeline compute_groups on a deep ply.
    const deep = fixtureEvents.find(
      (e) =>
        e.type === "positionCompleted" &&
        e.phase === "deep" &&
        e.snapshot.ply === DEEP_PLY,
    );
    expect(deep?.type).toBe("positionCompleted");
    if (deep?.type === "positionCompleted") {
      expect(deep.snapshot.groups?.length).toBeGreaterThan(0);
      expect(deep.snapshot.groups?.[0]?.source).toBe("pipeline");
      // Chains (串) remain present and distinct from groups.
      expect(deep.snapshot.chains.length).toBeGreaterThan(0);
    }
  });
});

describe("unimplemented review modules", () => {
  it("leaves ledger, comparison, sacrifice, commentary, opening, and report empty", () => {
    const state = reducePipelineEvents(fixtureEvents);
    expect(state.opening).toBeNull();
    expect(state.report).toBeNull();
    const ply = state.plies[DEEP_PLY];
    expect(ply?.ledger).toBeNull();
    expect(ply?.comparison).toBeNull();
    expect(ply?.sacrifices).toBeNull();
    expect(ply?.commentary).toBeNull();
  });
});

describe("reducePipelineEvent ordering", () => {
  it("applies scan results before deepPliesSelected and deepen updates", () => {
    const types = fixtureEvents.map((e) => e.type);
    const deepSel = types.indexOf("deepPliesSelected");
    const firstScanDone = types.indexOf("phaseCompleted");
    const deepPhase = types.indexOf("phaseStarted", firstScanDone + 1);
    expect(firstScanDone).toBeGreaterThan(-1);
    expect(deepSel).toBeGreaterThan(firstScanDone);
    expect(deepPhase).toBeGreaterThan(deepSel);

    let state = createInitialAnalysisState();
    let scanWrAtDeep: number | null = null;
    for (const ev of fixtureEvents) {
      state = reducePipelineEvent(state, ev);
      if (ev.type === "phaseCompleted" && ev.phase === "scan") {
        expect(state.plies[0]?.complete).toBe(true);
        expect(state.plies[DEEP_PLY]?.complete).toBe(true);
        scanWrAtDeep = state.plies[DEEP_PLY]?.root?.winrate ?? null;
        expect(state.deepPlies).toEqual([]);
      }
      if (ev.type === "deepPliesSelected") {
        expect(state.deepPlies).toEqual(DEEP_PLIES);
        expect(state.deepMode).toBe("swing");
        expect(state.deepReasons.map((r) => r.ply).sort((a, b) => a - b)).toEqual(
          DEEP_PLIES,
        );
      }
      if (
        ev.type === "positionCompleted" &&
        ev.phase === "deep" &&
        ev.snapshot.ply === DEEP_PLY
      ) {
        expect(state.plies[DEEP_PLY]?.rootPartial).toBe(false);
        expect(state.plies[DEEP_PLY]?.complete).toBe(true);
        expect(state.plies[DEEP_PLY]?.root?.visits).toBe(DEEP_VISITS);
        expect(state.plies[DEEP_PLY]?.root?.ownership?.length).toBe(361);
        expect(state.plies[DEEP_PLY]?.candidates.length).toBeGreaterThanOrEqual(
          4,
        );
        // Deepen replaces in place — tiny refinement at this ply, not a cliff.
        expect(scanWrAtDeep).not.toBeNull();
        expect(
          Math.abs((state.plies[DEEP_PLY]?.root?.winrate ?? 0) - scanWrAtDeep!),
        ).toBeLessThan(0.02);
      }
    }
    expect(state.status).toBe("completed");
    expect(state.size).toBe(19);
    expect(state.rules?.toLowerCase()).toBe("chinese");
  });

  it("lets deepen overwrite scan root while keeping earlier plies", () => {
    const state = reducePipelineEvents(fixtureEvents);
    expect(state.plies[0]?.root?.winrate).toBeGreaterThan(0);
    expect(state.plies[0]?.root?.winrate).toBeLessThan(1);
    expect(state.plies[DEEP_PLY]?.phase).toBe("deep");
    expect(state.plies[0]?.phase).toBe("scan");
    expect(state.plies[DEEP_PLY]?.root?.visits).toBe(DEEP_VISITS);
  });

  it("builds winrate series with deepSelected highlights on 19×19 game", () => {
    const state = reducePipelineEvents(fixtureEvents);
    const series = buildReviewSeries(state);
    expect(series.length).toBeGreaterThanOrEqual(DEEP_PLY + 1);
    for (const ply of DEEP_PLIES) {
      expect(series[ply]?.deepSelected).toBe(true);
    }
    expect(series[0]?.deepSelected).toBe(false);
    expect(series[DEEP_PLY]?.winrate).not.toBeNull();
  });
});

describe("partial vs complete", () => {
  it("marks partial root until stageCompleted / positionCompleted", () => {
    const partial: PipelineEvent = {
      type: "stagePartial",
      v: 1,
      ply: 1,
      phase: "deep",
      stage: "root",
      visits: 5,
      root: { visits: 5, winrate: 0.4, scoreLead: 1 },
    };
    const completed: PipelineEvent = {
      type: "stageCompleted",
      v: 1,
      ply: 1,
      phase: "deep",
      stage: "root",
      analysis: { visits: 100, winrate: 0.55, scoreLead: 2 },
    };
    let state = reducePipelineEvent(createInitialAnalysisState(), {
      type: "positionStarted",
      v: 1,
      ply: 1,
      toPlay: "B",
      phase: "deep",
    });
    state = reducePipelineEvent(state, partial);
    expect(state.plies[1]?.rootPartial).toBe(true);
    expect(state.plies[1]?.root?.visits).toBe(5);
    state = reducePipelineEvent(state, completed);
    expect(state.plies[1]?.rootPartial).toBe(false);
    expect(state.plies[1]?.root?.visits).toBe(100);
  });
});
