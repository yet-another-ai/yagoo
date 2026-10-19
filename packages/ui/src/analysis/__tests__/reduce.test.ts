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
const DEEP_PLY = 36;

describe("parseNdjson / fixture format", () => {
  it("parses real 19×19 pipeline NDJSON from yagoo analyze --scripted-fixture", () => {
    expect(fixtureEvents.length).toBeGreaterThan(10);
    expect(fixtureEvents[0]?.type).toBe("gameStarted");
    if (fixtureEvents[0]?.type === "gameStarted") {
      expect(fixtureEvents[0].size).toBe(19);
      expect(fixtureEvents[0].moveCount).toBeGreaterThanOrEqual(40);
    }
    expect(fixtureEvents.at(-1)?.type).toBe("gameCompleted");
    expect(fixtureEvents.some((e) => e.type === "deepPliesSelected")).toBe(
      true,
    );
    expect(fixtureEvents.some((e) => e.type === "stagePartial")).toBe(true);
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
    for (const ev of fixtureEvents) {
      state = reducePipelineEvent(state, ev);
      if (ev.type === "phaseCompleted" && ev.phase === "scan") {
        expect(state.plies[0]?.complete).toBe(true);
        expect(state.plies[DEEP_PLY]?.root?.winrate).toBeGreaterThan(0.6);
        expect(state.deepPlies).toEqual([]);
      }
      if (ev.type === "deepPliesSelected") {
        expect(state.deepPlies).toEqual([DEEP_PLY]);
        expect(state.deepMode).toBe("swing");
        expect(state.deepReasons[0]?.ply).toBe(DEEP_PLY);
      }
      if (ev.type === "stagePartial") {
        expect(state.plies[DEEP_PLY]?.rootPartial).toBe(true);
        expect(state.plies[DEEP_PLY]?.complete).toBe(false);
        expect(state.plies[DEEP_PLY]?.root?.visits).toBe(40);
      }
      if (
        ev.type === "positionCompleted" &&
        ev.phase === "deep" &&
        ev.snapshot.ply === DEEP_PLY
      ) {
        expect(state.plies[DEEP_PLY]?.rootPartial).toBe(false);
        expect(state.plies[DEEP_PLY]?.complete).toBe(true);
        expect(state.plies[DEEP_PLY]?.root?.visits).toBe(400);
        expect(state.plies[DEEP_PLY]?.root?.ownership?.length).toBe(361);
        expect(state.plies[DEEP_PLY]?.candidates.length).toBe(6);
      }
    }
    expect(state.status).toBe("completed");
    expect(state.size).toBe(19);
    expect(state.rules).toBe("chinese"); // missing RU on gameStarted
  });

  it("lets deepen overwrite scan root while keeping earlier plies", () => {
    const state = reducePipelineEvents(fixtureEvents);
    expect(state.plies[0]?.root?.winrate).toBeCloseTo(0.48, 5);
    expect(state.plies[DEEP_PLY]?.phase).toBe("deep");
    expect(state.plies[0]?.phase).toBe("scan");
    expect(state.plies[DEEP_PLY]?.root?.visits).toBe(400);
  });

  it("builds winrate series with deepSelected highlights on 19×19 game", () => {
    const state = reducePipelineEvents(fixtureEvents);
    const series = buildReviewSeries(state);
    expect(series.length).toBeGreaterThanOrEqual(DEEP_PLY + 1);
    expect(series[DEEP_PLY]?.deepSelected).toBe(true);
    expect(series[0]?.deepSelected).toBe(false);
    expect(series[DEEP_PLY]?.winrate).toBeGreaterThan(60);
    expect(series[DEEP_PLY]?.scoreLead).not.toBeNull();
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
