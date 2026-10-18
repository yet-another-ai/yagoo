# Architecture & data flow

## Intended stack

```mermaid
flowchart TB
  subgraph clients [Clients]
    UI[Web UI — WebGPU]
  end

  subgraph host [Host process]
    Core[yagoo-core<br/>board · chains · rules]
    Sgf[yagoo-sgf]
    AEClient[yagoo-katago<br/>Analysis Engine client]
    Teach[Teaching modules<br/>groups · tempo · …]
    Facts[Fact JSON + templates]
  end

  subgraph side [Sidecar]
    UV[Python via uv / mise]
    PT[PyTorch SWA forward<br/>scorebelief · seki · futurepos · trunk]
  end

  subgraph external [External]
    KG[KataGo Analysis Engine]
    Net[b18c384nbt SWA ckpt]
  end

  UI --> Teach
  Sgf --> Core
  Teach --> Core
  Teach --> AEClient --> KG
  Teach --> UV --> PT --> Net
  AEClient --> Teach
  PT --> Teach
  Teach --> Facts --> UI
```

| Concern | Choice |
| --- | --- |
| Core language | **Rust** (Cargo workspace) |
| Tooling / tasks | **mise** (mirrors [heron](https://github.com/minori-live/heron)) |
| Frontend | **Web + WebGPU** — not Electron |
| Node | Workspace scripts, docs site (VitePress), future web app |
| Python | **uv** under mise — model utilities, activation extract, concept-head training |
| CI | GitHub Actions, **latest major** action tags; Renovate updates them. **No** performance / timing tests in CI |

## Rust crate split

| Crate | Responsibility |
| --- | --- |
| `yagoo-core` | Coordinates (GTP / SGF), board, **chains** (串), liberties, captures, ko / positional superko, move legality, pass |
| `yagoo-sgf` | SGF → game record + **main-line replay** into `GameState` |
| `yagoo-katago` | Async JSON-lines client; **single-process id demux**; optional partials via `reportDuringSearchEvery`; fixture tests (no binary in CI) |
| `yagoo-snapshot` | Versioned `PositionSnapshot` / `GameSnapshot` + `PipelineEvent` NDJSON types (black-positive) |
| `yagoo-pipeline` | Async **stream** of analysis events (scan → swing-select → deep); drives KataGo; fills snapshots |
| `yagoo-cli` | `yagoo analyze` binary — NDJSON stream + optional aggregate JSON |

Teaching algorithms (groups, tempo, …) consume **snapshots only** — not implemented yet.

## Module data flow

```mermaid
flowchart TD
  SGF[SGF] --> P[yagoo-sgf + yagoo-core]
  P --> SCAN[Coarse scan: low-visit root<br/>pick critical positions]
  SCAN --> Q

  subgraph A[Path A — Analysis Engine]
    Q[Root query<br/>ownership + stdev, top-K movesOwnership]
    QP[Pass-probe query]
    QV[PV-end queries ≤K]
    QM[allowMoves query<br/>when played move ∉ top-K]
  end

  P --> Q
  P --> QP
  Q --> QV
  Q --> QM

  subgraph B[Path B — PyTorch sidecar]
    T[SWA ckpt forward]
    T --> SB[scorebelief]
    T --> SK[seki / futurepos]
    T --> ACT[trunk activations]
  end
  P --> T

  Q --> SC[Scenario set]
  QP --> SC
  QV --> SC

  SC --> FC[Groups<br/>correlation → cluster → intra connectivity]
  FC --> TS[Tempo sensitivity<br/>g+ / g− / Δ / status]
  QP --> TS
  SK --> TS

  FC --> SD[Score distribution]
  SB --> SD
  Q --> SD
  QV --> SD

  TS --> ZN[Positional zoning]
  Q --> ZN

  TS --> LG[Gain / loss ledger]
  QM --> LG
  QP --> LG

  ACT -.later.-> CH[Concept heads]
  FC -.block pool.-> CH
  CH -.-> TS

  TS --> J[Fact JSON]
  SD --> J
  ZN --> J
  LG --> J
  CH -.-> J
  J --> TPL[Template render]
  TPL --> LLM[Optional LLM rewrite + verify]
  LLM --> UI[WebGPU UI: highlights + text]
  TPL --> UI
```

## Repository layout

```text
.
├── README.md
├── docs/                     # Design docs + VitePress site
├── crates/
│   ├── yagoo-core/           # Board / rules
│   ├── yagoo-sgf/            # SGF parse + replay
│   ├── yagoo-katago/         # Analysis Engine client
│   ├── yagoo-snapshot/       # Snapshot schema + events
│   ├── yagoo-pipeline/       # Streaming analyze pipeline
│   └── yagoo-cli/            # `yagoo` binary
├── python/                   # uv-managed utilities (later)
├── scripts/                  # Local-dev helpers (model download, …)
├── mise.toml
├── Cargo.toml
└── .github/workflows/ci.yml
```
