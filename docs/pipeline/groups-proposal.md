# Groups on `PositionSnapshot` (folded)

> **Status.** Implemented. This page was the additive-schema proposal from PR #18.
> The wire field and algorithms now live in:
>
> - [`docs/pipeline/snapshots.md`](./snapshots.md) — `groups[]` schema
> - [`docs/modules/groups.md`](../modules/groups.md) — correlation clustering
> - [`docs/modules/tempo-sensitivity.md`](../modules/tempo-sensitivity.md) — status / \(g^\pm\)
>
> Rust: `yagoo_snapshot::compute_groups`, attached by `yagoo-pipeline` on deep
> `positionCompleted`. Sample fixtures use `source: "pipeline"` (no
> `fixture_proposal`).
