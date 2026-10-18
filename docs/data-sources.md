# Data sources

Two pipelines feed every teaching module. Do not mix their semantics without converting coordinates (see [conventions](./appendix/conventions.md)).

## Path A — Analysis Engine

- **What:** `katago analysis` JSON protocol, consumed by an async **Rust** client.
- **Role:** Primary path for all **post-search** quantities.
- **Suggested visits:** 500–2000 at root; PV-end queries may use 100–300.
- **Query knobs used:** `includeOwnership` / `includeOwnershipStdev`, `includeMovesOwnership` / `includeMovesOwnershipStdev`, `includePolicy`, `includePVVisits`, `analysisPVLen`, `avoidMoves` / `allowMoves`, `focusMoves`, `initialPlayer`, `overrideSettings` (e.g. `humanSLProfile`).

## Path B — PyTorch sidecar

- **What:** KataGo’s own Python tooling + SWA weights from a `.ckpt`.
- **Role:** Heads and trunk activations the Analysis Engine does **not** expose.
- **Search:** None — single forward pass.
- **Managed via:** `uv` inside `mise` (conversion, activation extract, later concept-head training).

**Decided network (v1):** `kata1-b18c384nbt-s9996604416-d4316597426` with **SWA** weights. Feasibility work measured CPU forward ~0.07 s/position for b18 (**measured** on that setup). Loading tf3 transformer checkpoints: **unverified**.

## Field map

| Signal | Symbol | Source | Notes |
| --- | --- | --- | --- |
| Root ownership / stdev | \(o^{\mathrm{root}}, s\) | A: `rootInfo.ownership` / `ownershipStdev` | Post-search |
| Candidate ownership / stdev | \(o^{(m)}\) | A: `moveInfos[k].ownership` / `ownershipStdev` | Only moves that enter `moveInfos` |
| Candidate scalars | — | A: `move`, `visits`, `winrate`, `scoreLead`, `scoreStdev`, `prior`, `utility`, `lcb`, `order`, `pv`, `pvVisits` | `scoreStdev` is systematically high — relative use only |
| Root score lead | — | A: `rootInfo.scoreLead` | |
| PV-end ownership | \(o^{(\mathrm{pv}_k)}\) | A: extra query after playing out PV | One query per PV; lower visits OK |
| Pass probe | \(o^{\mathrm{pass}}\) | A: append `"pass"` to `moves` | Whether midgame pass is OOD vs training: **unverified** |
| humanSL priors | — | A: `humanPrior` / `humanPolicy` | Needs human model + profile; not in MVP |
| **scorebelief** | \(P_{\mathrm{sb}}\) | **B only:** `get_model_outputs()["scorebelief"]` | Raw net, no search. 19×19 → 842 bins; bin centers half-integers (`EXTRA_SCORE_DISTR_RADIUS=60`). Sign / komi convention: **must verify** against `scoreMean` |
| **seki** heads | — | **B only:** `seki`, `seki2` | Distinguish ownership≈0 seki vs unresolved |
| **futurepos** | — | **B only:** 2 channels | Training comments: predict stone locations after a fixed horizon; exact steps / semantics: **unverified** |
| Raw ownership | \(o^{\mathrm{raw}}\) | B (side-to-move view → convert) | Cross-check vs search |
| Trunk activations | \(h^{(\ell)}\) | **B only:** `ExtraOutputs` e.g. `trunk_after_block{i}`, `trunkfinal`; b18 layer shape `(1,384,19,19)` | Concept-head input |

Ownership arrays from the engine are row-major starting at **A19**. PyTorch tensors use `features.loc_to_tensor_pos` — must be cross-checked.

## Scenario set \(\mathcal{S}\)

Shared by groups and score distribution. Built once per analyzed position:

| Scenario type | Count | Initial weight \(w_s\) |
| --- | --- | --- |
| Top-K candidates’ `movesOwnership` | K = 5–8 | Proportional to visits |
| Root ownership at those PVs’ end positions | ≤ K | Same visits weight × decay 0.5 |
| Pass-probe root ownership | 1 | Same weight as the top candidate |
| (Optional) top-K′ `movesOwnership` under pass probe | K′ = 3 | Same rule |

Roughly **12–20** scenarios. Small \(N\) is the main statistical limit for groups.

## Per-position cost (**estimate**, not measured end-to-end)

- Analysis queries: 1 root + 1 pass probe + ≤K PV-end ≈ **2+K** engine queries (PV-end at reduced visits).
- PyTorch: 1–2 forwards (root; optionally pass-probe for scorebelief).
- Full-game review: coarse scan (low visits, root only) → pick critical positions by `scoreLead` / winrate swings → full scenario set only there.
