# Concept heads (post-MVP)

**Role.** Small supervised heads on a **frozen** KataGo trunk that emit human concepts ownership alone struggles to name: eyes, liberty races, cut points, refined group status.

Priority is **after** the judgment layer (fate / tempo / score / zoning / ledger). Whether to invest depends on MVP validation outcomes.

**Decided:** heads are trained against the chosen net — initially **b18c384nbt** SWA. Changing the net means retraining (cheap relative to labeling).

## Inputs

- Frozen trunk activations \(h^{(\ell)}\) from path **B** (SWA)
- Groups for block-level pooling

## Proposed heads

| Head | Output | Label sources (anti-circularity) |
| --- | --- | --- |
| Group status | settled / weak / tempo-critical / dead / seki | Pass-probe flips (counterfactual), finished self-play finals, human eval set — **not** thresholds on same-position ownership alone |
| Eye count | 0 / 1 / 2+ / false eye | Rules eye detection; keep samples consistent with final results |
| Liberty race / one-move | race liberty gap; needs patch? | Rules liberty count + race candidates; PV captures as positives |
| Cut points | per-point probability | Opponent plays there → large drop in some group’s \(g\) (counterfactual) |
| seki / futurepos | direct use | Network’s own heads; Analysis Engine does not expose them |

Architecture: \(1\times1\) conv or small MLP, per-point, then mean / attention pool over groups.

## Anti label-loop

- Labels from counterfactuals, rules structure, or finals — never “threshold ownership on this position” recycled
- Train / test split by **game**, not by position
- **Ship gate:** on a human-labeled set (200–500 positions), beat both baselines: (1) raw ownership thresholds; (2) tempo \(g/\Delta\) rules. Metrics: macro-F1 and ECE. Fail → do not ship

## Layer selection

Train linear probes per trunk layer; plot linear decodability vs depth; pick attachment layer. Engineering choice only — not a research claim. Caution: KataGo inputs already encode liberties, ladders, pass-alive features — shallow decoding of those concepts is unsurprising.

## Scale (**estimate**, not measured)

~100k positions → ~1M block samples. Labeling ~\(2\times10^8\) NN evals ≈ 1–3 GPU-days. Spike: 20k positions @ 300 visits. Activations ~28 GB per layer per 100k positions — prefer online computation.

## Teaching uses

- “Only one eye”, “one liberty short”, “F5 is the cut”
- Cross-check at PV ends; on disagreement, degrade display confidence

## Known limits

- Readable ≠ used by the net. Product treats heads as **better labelers**, not claims about internal reasoning
- tf3 ckpt loadability: **unverified**
