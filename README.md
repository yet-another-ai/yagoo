# Yagoo

**Interpret KataGo. Teach real games.**

Yagoo is a practical Go (weiqi / baduk) review and teaching tool. Its differentiator is **interpretability of KataGo network internals** — not treating KataGo as another black-box winrate judge.

```mermaid
flowchart LR
  SGF[SGF game] --> Core[Rust core]
  Core --> AE[KataGo Analysis Engine]
  Core --> PT[PyTorch sidecar]
  AE --> Mods[Teaching modules]
  PT --> Mods
  Mods --> Facts[Fact JSON]
  Facts --> Explain[Explanations]
  Explain --> UI[WebGPU UI]
```

## What you get

| Module | Question it answers |
| --- | --- |
| **Groups** | Which stones move together across futures? |
| **Tempo sensitivity** | Is this group “whoever plays first wins”? |
| **Score distribution** | Fine endgame or unresolved fight? |
| **Positional zoning** | Territory, moyo, thickness, weak groups |
| **Gain / loss ledger** | Why was this move big — or a mistake? |
| **Concept heads** *(later)* | Eyes, liberty race, cut points |
| **Explanation generation** | Structured facts → teaching text |

## Non-goals (short)

- Black-box winrate / “R4” style judging alone
- Academic interpretability research as the product
- Designing for rare adversarial KataGo failure modes (e.g. cyclic groups)
- Tsumego solvers

Details: [Goals & non-goals](docs/goals.md).

## Stack direction

| Layer | Choice |
| --- | --- |
| Core / analysis clients | **Rust** (Cargo workspace) |
| Frontend | **Web** with **WebGPU** (not Electron) |
| Model utilities | **Python** via **uv**, managed under **mise** |
| Toolchain | **mise** (Rust, Node, uv) — same convention as [heron](https://github.com/minori-live/heron) |

Pinned teaching net for v1 work: **`kata1-b18c384nbt-s9996604416-d4316597426`** (SWA weights). Larger nets later; concept heads bind to the chosen net.

## Docs

Start at **[docs/](docs/index.md)** — glossary, data sources, one page per module, architecture, MVP plan, open questions.

## Development

```sh
mise install
mise run check
mise run docs          # VitePress docs site
```

Foundation crates (`yagoo-core`, `yagoo-sgf`, `yagoo-katago`) are in place. Teaching algorithms (groups, tempo, …) are not implemented yet.

Optional local KataGo assets (not CI):

```sh
mise run katago:fetch-dev
```

## License

[Apache License 2.0](LICENSE)
