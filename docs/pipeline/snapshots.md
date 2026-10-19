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
| `groups` | Teaching **groups** (块) — fate-correlated units. Filled on **deep** `positionCompleted` by `yagoo_snapshot::compute_groups`. Scan snapshots omit / empty. |

## Documents

- **`PositionSnapshot`** — one ply: board, chains, optional `groups`, root analysis, optional pass probe, top-K candidates (`movesOwnership` when present), optional PV ends.
- **`GameSnapshot`** — `{ size, komi, rules, positions[] }` aggregate written by the CLI `--final-json` flag after the stream completes.
- **`deepPliesSelected`** (stream event) — after scan, lists which plies will deepen (`mode`: `swing` | `all` | `range`) plus swing `reasons` for the UI.

## Groups (块) on `PositionSnapshot`

Additive wire field (camelCase). Emitted after the deep phase has root + scenario ownership (pass probe, candidate `movesOwnership`, optional PV ends):

```json
{
  "groups": [
    {
      "groupId": "D4",
      "members": {
        "blackStones": ["D4", "D5", "E5"],
        "whiteStones": [],
        "empty": ["C3", "C4", "D3"]
      },
      "chains": ["B:D4-D5-E5"],
      "parts": [{ "points": ["D4", "D5", "E5", "C3", "C4", "D3"], "chains": ["B:D4-D5-E5"] }],
      "kind": "simple",
      "strength": { "black": 0.42 },
      "certainty": 0.61,
      "cohesion": 0.83,
      "boundConfidence": null,
      "status": "weak",
      "gPlus": 0.55,
      "gMinus": 0.12,
      "delta": 0.43,
      "source": "pipeline"
    }
  ]
}
```

| Field | Source | Notes |
| --- | --- | --- |
| `groupId`, `members`, `chains`, `parts`, `kind`, `strength`, `certainty`, `cohesion`, `boundConfidence` | [Groups](../modules/groups.md) | `kind`: `simple` \| `contested` \| `bound` |
| `status`, `gPlus`, `gMinus`, `delta` | [Tempo sensitivity](../modules/tempo-sensitivity.md) | `status`: `settled` \| `weak` \| `tempo_critical` \| `dead` \| `likely_seki` |
| `source` | Pipeline | `"pipeline"` when real; omit when empty |

Serde: `default`, `skip_serializing_if = "Vec::is_empty"`. Do **not** invent groups from `chains` alone in the UI.

Algorithm summary: equal-weight fate vectors from deep scenarios → drop stable points → average-linkage correlation clustering (cut \(r^\ast=0.7\)) → 4-connectivity / kind → tempo status from root vs pass probe. Details and thresholds: [groups module](../modules/groups.md), [parameters](../appendix/parameters.md).

## Pass probe

Stored under `passProbe` (engine analysis after appending `"pass"` for the side to move). If skipped:

| `passProbeSkipped` | Meaning |
| --- | --- |
| `previous_was_pass` | Prior action was already a pass (see [conventions](../appendix/conventions.md)) |
| `disabled_in_phase` | Scan phase does not run the probe |

## Crate

Rust types live in `yagoo-snapshot`. Conversion from Analysis Engine responses and `GameState` is in the same crate (`engine_from_response`, `board_from_game`, …). Group computation: `compute_groups`.
