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

describe("parseNdjson / fixture format", () => {
  it("parses real pipeline NDJSON from yagoo analyze --scripted-fixture", () => {
    expect(fixtureEvents.length).toBeGreaterThan(10);
    expect(fixtureEvents[0]?.type).toBe("gameStarted");
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
        expect(state.plies[2]?.root?.winrate).toBeCloseTo(0.7, 5);
        expect(state.deepPlies).toEqual([]);
      }
      if (ev.type === "deepPliesSelected") {
        expect(state.deepPlies).toEqual([2]);
        expect(state.deepMode).toBe("swing");
        expect(state.deepReasons[0]?.ply).toBe(2);
      }
      if (ev.type === "stagePartial") {
        expect(state.plies[2]?.rootPartial).toBe(true);
        expect(state.plies[2]?.complete).toBe(false);
        expect(state.plies[2]?.root?.visits).toBe(20);
      }
      if (
        ev.type === "positionCompleted" &&
        ev.phase === "deep" &&
        ev.snapshot.ply === 2
      ) {
        expect(state.plies[2]?.rootPartial).toBe(false);
        expect(state.plies[2]?.complete).toBe(true);
        expect(state.plies[2]?.root?.visits).toBe(200);
        expect(state.plies[2]?.root?.winrate).toBeCloseTo(0.71, 5);
        expect(state.plies[2]?.candidates.length).toBe(2);
      }
    }
    expect(state.status).toBe("completed");
    expect(state.rules).toBe("chinese"); // missing RU on gameStarted
  });

  it("lets deepen overwrite scan root while keeping earlier plies", () => {
    const state = reducePipelineEvents(fixtureEvents);
    expect(state.plies[0]?.root?.winrate).toBeCloseTo(0.5, 5);
    expect(state.plies[1]?.root?.winrate).toBeCloseTo(0.51, 5);
    expect(state.plies[2]?.root?.winrate).toBeCloseTo(0.71, 5);
    expect(state.plies[2]?.phase).toBe("deep");
    expect(state.plies[0]?.phase).toBe("scan");
  });

  it("builds winrate series with deepSelected highlights", () => {
    const state = reducePipelineEvents(fixtureEvents);
    const series = buildReviewSeries(state);
    expect(series.length).toBeGreaterThanOrEqual(3);
    expect(series[2]?.deepSelected).toBe(true);
    expect(series[0]?.deepSelected).toBe(false);
    expect(series[2]?.winrate).toBeCloseTo(71, 5);
    expect(series[2]?.scoreLead).toBeCloseTo(4.8, 5);
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
