# Streaming analysis pipeline

The pipeline is an **async stream** of [`PipelineEvent`](./snapshots.md) values. Consumers (CLI today, WebGPU UI later) render progressively — they do not wait for the whole game.

## Event order (`scan_then_deep`)

1. `gameStarted`
2. `phaseStarted` (`scan`, low visits)
3. For each ply in `--from`/`--to` (optional range filter):
   - `positionStarted`
   - zero or more `stagePartial` (`stage: root`) — only when `--partials` is set
   - `stageCompleted` (`root`)
   - `stageCompleted` (`passProbe`, skipped as `disabled_in_phase`)
   - `positionCompleted` (partial snapshot: root (+ ownership); no pass probe / candidates)
4. `phaseCompleted` (`scan`)
5. `deepPliesSelected` — plies chosen for deepening (`mode`: `swing` | `all`)
6. `phaseStarted` (`deep`, full visits)
7. For each **selected** ply:
   - `positionStarted`
   - `stagePartial`* → `stageCompleted` (`root`, with top-K candidates / movesOwnership)
   - `stagePartial`* → `stageCompleted` (`passProbe`) or skipped
   - optional `stageCompleted` (`pvEnd`) × N
   - `positionCompleted` (full snapshot)
8. `phaseCompleted` (`deep`)
9. `gameCompleted` (optional embedded `GameSnapshot`)

`deep_only` skips steps 2–4; it emits `deepPliesSelected` with `mode: "range"` then deepens every ply in the filter.

## Deep ply selection (swings)

After the low-visit scan, the pipeline ranks consecutive-ply swings and deepens the top hits:

| Signal | Default threshold | Notes |
| --- | --- | --- |
| \|\Δ winrate\| | `0.05` | Fraction, not percent |
| \|\Δ scoreLead\| | `3.0` | Points |
| Mean \|\Δ ownership\| | `0.08` | Board-average absolute change |
| Max deep plies | `24` | After ranking by combined magnitude |

A ply qualifies if **any** threshold clears. Priority score is `wr/τ_wr + sl/τ_sl + own/τ_own`. See [parameters](../appendix/parameters.md).

- `--deepen-all` — skip auto-pick; deepen every scanned ply (`mode: "all"`).
- `--from` / `--to` — optional range filter applied to **scan** (and thus to selection candidates).
- `deepPliesSelected` carries `plies` plus per-ply `reasons` (deltas + score) so a UI can highlight them.

## During-search partials

Partials are **off by default**. Pass `--partials` (and optionally `--report-every SEC`, default 0.5) to set KataGo `reportDuringSearchEvery` and forward `isDuringSearch: true` lines as `stagePartial`. Partials are **best-effort**. Final `stageCompleted` / `positionCompleted` are authoritative.

## Prioritization strategy

**Scan then deep** (default):

| Phase | Visits (default) | Stages |
| --- | --- | --- |
| Scan | `scanVisits` = 100 | Root only (ownership + policy; no pass probe, no movesOwnership) |
| Deep | `rootVisits` = 800 | Root + pass probe + optional PV ends; top-K = 6; plies from swings (or `--deepen-all`) |

## CLI wire format

NDJSON: one `PipelineEvent` JSON object per line (camelCase / tagged `type`). Suitable for a browser client consuming a fetch/stream.

```sh
yagoo analyze game.sgf -o events.ndjson --final-json game.json \
  --katago "$YAGOO_KATAGO" --model "$YAGOO_MODEL" --config "$YAGOO_ANALYSIS_CONFIG"
```

Useful flags: `--from` / `--to`, `--deepen-all`, `--partials`, `--swing-wr` / `--swing-sl` / `--swing-own`, `--max-deep-plies`.

## Concurrency

One KataGo `analysis` process per `AnalysisClient`. In-flight queries are **demuxed by response `id`** — do not spawn multiple processes for parallelism. Concurrent `analyze_streaming` calls on the same client are supported.
