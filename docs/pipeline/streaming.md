# Streaming analysis pipeline

The pipeline is an **async stream** of [`PipelineEvent`](./snapshots.md) values. Consumers (CLI today, WebGPU UI later) render progressively — they do not wait for the whole game.

## Event order (`scan_then_deep`)

1. `gameStarted`
2. `phaseStarted` (`scan`, low visits)
3. For each ply in range:
   - `positionStarted`
   - zero or more `stagePartial` (`stage: root`, `isDuringSearch`)
   - `stageCompleted` (`root`)
   - `stageCompleted` (`passProbe`, skipped as `disabled_in_phase`)
   - `positionCompleted` (partial snapshot: root (+ ownership); no pass probe / candidates)
4. `phaseCompleted` (`scan`)
5. `phaseStarted` (`deep`, full visits)
6. For each ply:
   - `positionStarted`
   - `stagePartial`* → `stageCompleted` (`root`, with top-K candidates / movesOwnership)
   - `stagePartial`* → `stageCompleted` (`passProbe`) or skipped
   - optional `stageCompleted` (`pvEnd`) × N
   - `positionCompleted` (full snapshot)
7. `phaseCompleted` (`deep`)
8. `gameCompleted` (optional embedded `GameSnapshot`)

`deep_only` skips steps 2–4.

## During-search partials

When `reportDuringSearchEvery` is set (default **0.5 s**), KataGo emits `isDuringSearch: true` lines. The pipeline forwards them as `stagePartial` so a UI can show refining winrate/ownership. Partials are **best-effort** and may be omitted (`--no-partials`). Final `stageCompleted` / `positionCompleted` are authoritative.

## Prioritization strategy

**Scan then deep** (default):

| Phase | Visits (default) | Stages |
| --- | --- | --- |
| Scan | `scanVisits` = 100 | Root only (ownership + policy; no pass probe, no movesOwnership) |
| Deep | `rootVisits` = 800 | Root + pass probe + optional PV ends; top-K = 6 |

This matches the design doc’s “coarse scan then key positions” idea for whole games; MVP deepens the **same** ply range (use `--from` / `--to` to focus).

## CLI wire format

NDJSON: one `PipelineEvent` JSON object per line (camelCase / tagged `type`). Suitable for a browser client consuming a fetch/stream.

```sh
yagoo analyze game.sgf -o events.ndjson --final-json game.json \
  --katago "$YAGOO_KATAGO" --model "$YAGOO_MODEL" --config "$YAGOO_ANALYSIS_CONFIG"
```

## Concurrency

Each `AnalysisClient` is **single-flight** (one query at a time, but streaming partials for that query). Parallelism across positions requires multiple engine processes (future). Throughput today comes from not buffering the whole game before emit.
