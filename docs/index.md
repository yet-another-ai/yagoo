# Yagoo documentation

Design documentation for Yagoo: a Go review / teaching tool built on **interpretable use of KataGo internals**, focused on real-game positions and teaching value.

> **Authority.** Translated and restructured from the concept design (`katago-teaching-design`). Where that design and the feasibility notes disagree, **the design wins**. Post-design decisions are called out inline (network choice, group clustering order, WebGPU frontend).

## Reading order

1. [Goals & non-goals](./goals.md)
2. [Glossary](./glossary.md)
3. [Data sources](./data-sources.md)
4. Modules (one page each):
   - [Groups](./modules/groups.md)
   - [Tempo sensitivity](./modules/tempo-sensitivity.md)
   - [Score distribution](./modules/score-distribution.md)
   - [Positional zoning](./modules/positional-zoning.md)
   - [Gain / loss ledger](./modules/gain-loss-ledger.md)
   - [Concept heads](./modules/concept-heads.md) *(post-MVP)*
   - [Explanation generation](./modules/explanation-generation.md)
5. [Architecture & data flow](./architecture.md)
6. Pipeline: [snapshots](./pipeline/snapshots.md), [streaming](./pipeline/streaming.md)
7. [MVP & validation plan](./mvp.md)
8. [Open questions](./open-questions.md)
9. Appendix: [parameters](./appendix/parameters.md), [symbol conventions](./appendix/conventions.md)

## Status labels in these docs

| Label | Meaning |
| --- | --- |
| **Decided** | Locked for current planning (may still be revisited deliberately) |
| **Initial value** | Starting threshold / default; expects retuning on real games |
| **Unverified** | Claim not yet measured or cross-checked; do not treat as fact |
| **Estimate** | Effort / cost guess; not a measurement |

## Post-design decisions

Already decided after the Chinese design draft:

1. **Network:** start with `kata1-b18c384nbt-s9996604416-d4316597426` (SWA). b28 / tf3 possible later; concept heads are tied to the chosen net.
2. **Groups:** cluster by **correlation of ownership change across candidate futures first**, then run connectivity analysis **inside** each group. **No geometric-rule fallback.**
3. **Frontend:** intended direction is a **WebGPU-based web** app, not Electron.
4. **Languages:** Rust + Node primary; Python utilities under **uv** inside **mise**.
