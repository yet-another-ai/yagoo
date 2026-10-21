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

## Local live server

Start the same CLI with `--serve`; it starts one KataGo process and accepts
requests on `127.0.0.1:8710`. The usual engine paths/environment variables,
strategy, visits, ply range, and `--partials` options still apply.

```sh
cargo run -p yagoo-cli -- analyze --serve
# Or provide an SGF for GET clients:
cargo run -p yagoo-cli -- analyze game.sgf --serve --port 8710
```

In the reviewer, open **Engine → Live native**, leave the local URL as
`http://127.0.0.1:8710/analyze`, and click **Connect to local engine**.
The current SGF is sent with the request. **Stop analysis**, changing the SGF,
selecting another source, and leaving the reviewer cancel the current stream.
Connecting again starts a fresh analysis. There is no automatic reconnect.

| Request | Result |
| --- | --- |
| `POST /analyze` with JSON `{"sgf":"(;SZ[19];B[pd])"}` | Scan/deepen SSE stream using CLI pipeline options |
| `GET /analyze` | Analyze the optional startup SGF; HTTP 400 if none was provided |
| `POST /analyze-position` | One root-only interactive result (contract below) |
| `GET /health` | `yagoo-native/1`; does not submit an engine query |

Responses use `Content-Type: text/event-stream`. Each SSE message has one `data:`
line containing **the exact JSON object emitted by the NDJSON CLI**, followed by
a blank line. SSE comments are keepalives. There is no event envelope or
transport-specific change to `PipelineEvent`. Batch success ends with
`gameCompleted`; analysis failure emits `error`. The connection then ends.
Malformed HTTP/JSON or interactive input is rejected with an HTTP error before
streaming. No `stagePartial` is forwarded unless `--partials` was requested.

Each request gets a private query-ID namespace while sharing the one process.
At most four analyses run concurrently; excess requests receive HTTP 429.
Event delivery is bounded, and dropping the response body drops the pipeline
future, which removes the query route and queues its single-query termination.
Late engine replies cannot enter a later request. Engine exit fails active and
subsequent queries; restart the CLI to start another engine.

### Browser origins

Only `http://localhost:5173` and `http://127.0.0.1:5173` are allowed by default.
For another reviewer origin, supply it explicitly; repeated options form the
allowlist and replace those defaults:

```sh
cargo run -p yagoo-cli -- analyze --serve \
  --allow-origin https://yet-another-ai.github.io
```

Origins must be exact `http://host:port` or `https://host` values, without a path
or trailing slash. The listener remains loopback-only. The server rejects
unapproved browser origins and non-local Host headers, supports JSON preflight,
and never uses wildcard CORS or credentials. The request body limit is 2 MiB.
Live batch and interactive requests also accept at most 512 SGF nodes and 64
nested variations. These limits are checked before recursive parsing or replay,
and an analysis slot is reserved before interactive position preparation. Larger
games can still use the file/stdout batch CLI.
Browsers may require permission to access a local network service. If hosted
browser policy blocks the connection, run the reviewer with `mise run docs`.

### Interactive position contract

`POST /analyze-position` accepts:

```json
{"sgf":"(;SZ[19]KM[7.5];B[pd];W[dd])","ply":1,"moves":["D4","pass"],"visits":200}
```

`ply` is the anchor position after that many SGF main-line moves (0 means setup).
`moves` is an optional sequence of GTP branch moves, including `pass`, alternating
from the anchor's actual side to play. `visits` defaults to 200 and accepts
1–100000; a branch may contain up to 1000 moves. An illegal move or out-of-range
anchor is HTTP 400.

This mode issues **one root query**, preserving root setup, `PL`, komi, rules,
every prefix move, passes, and the branch history. Missing `RU` means Chinese.
It emits one `positionCompleted` event whose `snapshot.ply` is `ply + moves.length`,
with black-positive root results, candidates/PVs, and ownership. Its phase is
`deep`; pass probe is marked `disabled_in_phase`. It does not run a batch scan,
pass probe, PV-end queries, or group computation. Errors emit `error` instead.
Interactive results belong in a separate variation store, never in the main-line
batch reducer.

The shared `yagoo-pipeline` helpers `prepare_position`, `complete_position`, and
`analyze_position` provide the same history/query/snapshot semantics to browser
and native engines. Non-root `AB`/`AW`/`AE`/`PL`/`RU`/`KM`/`SZ` edits and root `AE`
are rejected because the replay engine cannot represent them faithfully. Root
compressed setup ranges must be expanded before submission.

CI uses committed KataGo response recordings, a pending fake engine, and local
HTTP transport tests. It downloads no models and runs no KataGo process.
