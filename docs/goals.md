# Goals & non-goals

## Goals

Yagoo targets **practical game review and teaching**. It uses KataGo internal signals — ownership families, pass probes, raw network heads, and later trunk activations — to answer questions players actually ask:

- Which stones form one unit? Who is strong or weak?
- Is this group “whoever plays first wins”?
- Is the position territory-vs-moyo, or does the game hang on one fight?
- Why was this move large, or why was it a mistake — where did the points go?

**Differentiation is semantic**, not another heatmap:

- Units of explanation are **fate communities** (not raw chains or independent points)
- Group status is **tempo-normalized** (pass probe)
- Territory / moyo / thickness / weak groups are named separately
- Score is shown as a **distribution**, not a single lead
- Move value is broken into a **gain / loss ledger**
- Text explanations are driven by **structured facts**, not free-form LLM guessing

Painting ownership heatmaps alone is not differentiation — tools such as LizGoban already go deep there.

**Engineering target:** Rust main program + KataGo Analysis Engine, plus a Python (PyTorch) sidecar for heads and activations the engine does not expose. UI direction: WebGPU web app.

## Non-goals

| Non-goal | Why |
| --- | --- |
| Treat KataGo as a black-box judge (“winrate −8%, recommend R4”) | Many products already do this; little teaching value |
| Academic interpretability (SAE discovery, causal patching, paper-grade probe claims) | Not the product. Sparse borrowing of probe techniques only as engineering acceptance for concept heads |
| Design around cyclic-group / ring-dragon adversarial life-and-death misjudgments | Extremely rare in real games. No Benson / RZS fallback; note limitations only |
| Tsumego solvers | Isolated life-and-death problems are often OOD for the network |
| Independent per-point Monte Carlo of ownership | Points in one group flip together; independence **underestimates** score variance (see [score distribution](./modules/score-distribution.md)) |

## Competitive framing (context)

Feasibility survey (summary): LizGoban is the closest competitor on ownership visualization; KaTrain / go-review-timelapse / Ogatak-style tools emphasize heatmaps or simple chain labels. Yagoo’s bet is **community-level, tempo-sensitive semantics + ledger + fact-driven explanation**.
