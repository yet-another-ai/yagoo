# MVP & validation plan

Effort figures below are **estimates** from the design draft (single contributor), not measurements. Prefer them as sequencing hints, not calendars.

## MVP scope

| In | Out |
| --- | --- |
| SGF parse; Rust async Analysis Engine client | Concept heads |
| Scenario set + groups (hierarchical + spectral comparison) | humanSL skill-targeted topic selection |
| Pass probe + group status | LLM rewrite (templates only) |
| Positional zoning (points + weak / thickness) | Full WebGPU UI (static HTML report instead) |
| Score distribution: scorebelief (minimal PyTorch sidecar) + group MC | |
| Gain / loss ledger: **optional** — see [open questions](./open-questions.md) | |
| Fact JSON + template text | |

## Suggested sequence (**estimate**)

| Slice | Work |
| --- | --- |
| A | SGF → position; Analysis client (root / pass / PV-end / allowMoves); black-positive coordinates |
| B | Minimal PyTorch sidecar: scorebelief + seki; verify scorebelief sign/komi vs `scoreMean` |
| C | Groups: vectors, affinity, both clusterers, connectivity, confidence; debug viz |
| D | Pass-probe status; sample “pass probe vs opponent’s best local move” |
| E | Score methods (a)(b)(c), disagreement, pivotal ranking |
| F | Zoning; optional ledger |
| G | Fact schema, templates, HTML report; batch ~20 games |
| H | Buffer / evaluation materials |

## Validation method

- **Material:** ~20 real games — mid/high amateur, professional, plus a few with big-dragon fights and territory-vs-moyo themes. Auto-pick 5–8 critical positions per game.
- **Raters:** ranked players, ≥2 people (for agreement).
- **Per critical position (1–5 + short notes):**
  1. Groups match “this is one group”; remote / contested cues sensible
  2. Status (settled / weak / tempo-critical / dead) correct
  3. Zoning (territory / moyo / thickness) reasonable
  4. Score distribution + “game hangs on” captures the point
  5. Text has teaching value and no factual errors
- **Control:** same position with LizGoban-style heatmap (or KaTrain expected territory) — which helps teaching more?
- **Engineering metrics:** per-position latency (**local only**, never CI); clustering stability across seeds / visits (adjusted Rand); pass-probe vs best-local status agreement rate; share of (a)/(b) disagreement flags players call “worth teaching”

## Decision gates (**proposal**, needs maintainer sign-off)

- Groups + status average ≥ 3.5 **and** rated more useful than heatmaps → productize judgment layer; start concept-head spike (20k @ 300 visits)
- Partition OK but status often wrong → prioritize status / eye concept heads
- Partition itself rejected → retune scenarios / similarity first; defer concept heads
