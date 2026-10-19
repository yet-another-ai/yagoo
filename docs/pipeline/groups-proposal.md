# Additive schema proposal: groups (块) on `PositionSnapshot`

> **Status (PR #18).** Teaching **groups** (块) are **not** emitted by `yagoo-pipeline` today.
> Snapshots only carry rules **chains** (串). The groups / tempo algorithms are documented
> in [`docs/modules/groups.md`](../modules/groups.md) and
> [`docs/modules/tempo-sensitivity.md`](../modules/tempo-sensitivity.md) but are **not
> implemented** in Rust yet (`README`: “Teaching algorithms (groups, tempo, …) come next”).
>
> This page proposes a **minimal additive** wire field so the reviewer UI can render
> Sabaki-style group judgments as soon as the pipeline fills it. Until then, the bundled
> `/app/` sample may include hand-authored `groups` with `"source": "fixture_proposal"`
> — **not** a silent frontend heuristic.

## Distinction

| | **Chain** (串) | **Group** (块) |
| --- | --- | --- |
| Already in snapshot? | Yes — `chains[]` | **No** (this proposal) |
| Defined by | Orthogonal same-color connectivity | Correlated ownership fate across scenarios |
| May mix colors / empties? | No | Yes |

Do **not** treat `chains` as teaching groups in the UI.

## Proposed field

On `PositionSnapshot` (schema v1, camelCase, additive / optional):

```json
{
  "groups": [
    {
      "groupId": "C3",
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

### Field notes

| Field | Source doc | Notes |
| --- | --- | --- |
| `groupId`, `members`, `chains`, `parts`, `kind`, `strength`, `certainty`, `cohesion`, `boundConfidence` | [Groups fact JSON](../modules/groups.md) | `kind`: `simple` \| `contested` \| `bound` |
| `status`, `gPlus`, `gMinus`, `delta` | [Tempo sensitivity](../modules/tempo-sensitivity.md) | `status`: `settled` \| `weak` \| `tempo_critical` \| `dead` \| `likely_seki` |
| `source` | This proposal | Omit or `"pipeline"` when real; `"fixture_proposal"` only in UI demo fixtures |

Omit `groups` (or use `[]`) when the module has not run. Serde: `default`, `skip_serializing_if = "Vec::is_empty"`.

## Pipeline gap (for maintainers)

To populate this for real:

1. Implement correlation clustering + connectivity (`docs/modules/groups.md`) over scenario ownerships already present on deep snapshots (`root`, `passProbe`, candidate `ownership`).
2. Run tempo status from root vs pass probe (`docs/modules/tempo-sensitivity.md`).
3. Attach `groups` on `positionCompleted` snapshots (at least for deep plies; scan may stay empty).
4. Prefer regenerating fixtures via `yagoo analyze --scripted-fixture` once the module exists — remove `source: "fixture_proposal"`.

Until then the UI must **not** invent groups from `chains` alone.
