# Snapshot schema

Versioned, typed JSON consumed by teaching modules (groups, tempo, zoning, ledger). Modules must **not** call KataGo directly — they read snapshots only.

## Conventions

| Field | Convention |
| --- | --- |
| `schemaVersion` | Currently **1** (`yagoo_snapshot::SCHEMA_VERSION`) |
| Ownership / winrate / scoreLead | **Black-positive** (`ownershipConvention: "black_positive"`). Queries set `reportAnalysisWinratesAs = BLACK`. |
| Ownership arrays | Row-major from **A19**, length `size²` |
| Coordinates in board/chains/moves | GTP strings (`D4`, `pass`) |
| `chains` | Rules **chains** (串), not teaching **groups** (块) |

## Documents

- **`PositionSnapshot`** — one ply: board, chains, root analysis, optional pass probe, top-K candidates (`movesOwnership` when present), optional PV ends.
- **`GameSnapshot`** — `{ size, komi, rules, positions[] }` aggregate written by the CLI `--final-json` flag after the stream completes.
- **`deepPliesSelected`** (stream event) — after scan, lists which plies will deepen (`mode`: `swing` | `all` | `range`) plus swing `reasons` for the UI.

## Pass probe

Stored under `passProbe` (engine analysis after appending `"pass"` for the side to move). If skipped:

| `passProbeSkipped` | Meaning |
| --- | --- |
| `previous_was_pass` | Prior action was already a pass (see [conventions](../appendix/conventions.md)) |
| `disabled_in_phase` | Scan phase does not run the probe |

## Crate

Rust types live in `yagoo-snapshot`. Conversion from Analysis Engine responses and `GameState` is in the same crate (`engine_from_response`, `board_from_game`, …).
