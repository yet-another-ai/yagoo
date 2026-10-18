# Score distribution

**Role.** Show the shape of final black net score (incl. komi), not a single `scoreLead`. Distinguish fine endgames from unresolved fights; surface “the game hangs on this”.

## Why not independent per-point Monte Carlo

Points inside one group almost flip together. Treating points as independent Bernoulli trials underestimates variance by roughly an order of magnitude for a ~30-point group and produces a falsely sharp distribution. Yagoo uses only methods (a)(b)(c) below.

## Method (a) — scorebelief head (primary display)

- Path **B**, single forward, **no search**
- 842 bins on 19×19; convert to black net score (conventions: [appendix](../appendix/conventions.md); sign/komi alignment with `scoreMean`: **unverified**, must verify)
- Derived: mean, std, \(P(S>0)\), multimodality (mode count or gap between top two modes)
- May disagree with post-search `scoreLead`. If \(|\mathrm{mean}-scoreLead|\) exceeds **initial** 3 points, UI flags “network intuition vs search”

## Method (b) — group Monte Carlo (comparison)

- Each group \(C\) (incl. scattered blocks) is one Bernoulli \(X_C\in\{\mathrm{Black},\mathrm{White}\}\)
- \(p_C=\tfrac12(1+\bar o_C)\) with \(\bar o_C\) mean of member \(o^{\mathrm{root}}\)
- Outcome values: prefer scenario estimates — mean ownership of members over scenarios with group mean \(>0\) vs \(<0\) → \(o^{B}_C, o^{W}_C\); if too few scenarios, fall back to \(\pm 1\)
- One sample:

\[
S=\sum_{i\ \mathrm{stable}} o_i^{\mathrm{root}}
+\sum_{C}\sum_{i\in C} o^{X_C}_{C,i}
-\mathrm{komi}
\]

Sample \(10^4\) times for a histogram.

This approximates **area scoring**. Under territory scoring a constant correction is needed. **MVP compromise:** shift the distribution mean onto `scoreLead` and compare **shape** only (variance, modes). Whether to shift is an [open question](../open-questions.md).

Assumes independence across groups; residual cross-group correlation (e.g. a race split into two clusters) biases variance low.

## Method (c) — search-scenario histogram (coarse)

Weight candidate / PV-end `scoreLead` by visits. Only ~dozen samples — use for “bimodal?” checks, not as a standalone display.

## Disagreement → pivotal regions

Flag (a) vs (b) when Wasserstein-1 ≥ threshold, or \(|P_a(S>0)-P_b(S>0)|\ge 0.15\) (**initial**).

Rank groups by contribution to (b)’s variance:

\[
V_C\approx 4\,p_C(1-p_C)\,
\Big(\sum_{i\in C}\tfrac{o^{B}_{C,i}-o^{W}_{C,i}}{2}\Big)^2
\]

Top 1–3 \(V_C\) → “game hangs on these”. Prefer talking about them when methods disagree.

## Fact JSON fragment

```json
{
  "score_dist": {
    "scorebelief": {
      "mean": 2.1,
      "std": 6.4,
      "p_black_win": 0.61,
      "modes": [-9.5, 4.5]
    },
    "group_mc": {
      "mean": 2.1,
      "std": 11.8,
      "p_black_win": 0.57,
      "shifted_to_scoreLead": true
    },
    "search_scenarios": { "bimodal": true },
    "disagreement": { "w1": 3.7, "flag": true },
    "pivotal_groups": [{ "id": "C3", "variance_share": 0.58 }]
  }
}
```

## Teaching uses

- “Black leads by 2, but the distribution is bimodal: if the center lives Black is winning big; if it dies White is slightly ahead.”
- Narrow unimodal → fine; wide / multimodal → chaos — advise stabilize vs complicate.

## Known limits

- scorebelief is raw-net; can diverge from search in complex fights
- (b) inherits group quality and independence assumptions
- Engine `scoreStdev` is biased high — do not use as distribution width
- Mean shift is an engineering compromise that can hide systematic bias in (b)
