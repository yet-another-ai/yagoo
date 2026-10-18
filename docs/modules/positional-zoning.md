# Positional zoning

**Role.** Name the board in human strategic language: territory, moyo, neutral, dead stones, community-attached eye space; plus community-level **thickness** and **weak groups**.

## Inputs

\(o^{\mathrm{root}}, s\), candidates’ `movesOwnership`, fate communities, tempo statuses.

## Point labels (first match wins)

Let \(p=\mathrm{sign}(o_i)\) be the favored side and \(u_i=\sigma_p o_i\).

| Order | Label | Condition (**initial**; retune) |
| --- | --- | --- |
| 1 | **Dead stone** | Occupied by \(q\), and \(\sigma_q o_i\le -0.5\) |
| 2 | **Territory** | Empty; \(u_i>0.85\); \(s_i<0.1\); and \(\min_{m\in\mathrm{top}\,K}\sigma_p o_i^{(m)}>0.8\) |
| 3 | **Community-attached** | Empty; member of a weak or tempo-critical community. Eye / base space — follows that group’s life; **not** moyo |
| 4 | **Moyo** | Empty; \(0.3<u_i\le 0.85\) **or** high candidate variance (\(\mathrm{Var}_m o_i^{(m)}\ge 0.1\)); and either (i) \(p\)’s stone portion of the containing community is settled, or (ii) distance to some settled \(p\) community ≤ 4 |
| 5 | **Neutral** | Everything else (incl. \(|o_i|\le 0.3\) empties and dame) |

Geometric distance appears **only** in this moyo / thickness **heuristic** layer — never in fate-community definition. Whether that violates the “no geometry” spirit is an [open question](../open-questions.md).

## Community labels

- **Weak:** status weak or tempo-critical
- **Thickness:** status settled, \(g^{p,-}\ge 0.9\), \(\Delta\le 0.15\), and influence

\[
T_C=\sum_{i:\ \mathrm{not\ territory},\ \mathrm{dist}(i,C)\le R}
\max(0,\sigma_p o_i),\qquad R=4\text{–}5
\]

exceeds a threshold. Heuristic with **no ground truth** — calibrate with player labels. Optional check: opponent invasion / reduction candidates’ `movesOwnership` near the thick area — if those stones tend to die, thickness is “effective”.

## Outputs

- Per-point zone + favored side
- Aggregates: black/white territory points, moyo area (\(\sum u_i\) weighted), weak list, thickness list

## Teaching uses

- “Black territory 45, White 38, but White has ~20 points of moyo on the right; Black’s center is weak.”
- Territory vs moyo frames invade-vs-reduce discussions.

## Known limits

- Territory / moyo / thickness lack precise definitions or labels in Go theory
- No dedicated literature deriving thickness/moyo from ownership was found in the feasibility survey
- KataGo issue #538: local ownership sums are unreliable — territory aggregates are approximate only
