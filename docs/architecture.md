# Architecture & data flow

## Intended stack

```mermaid
flowchart TB
  subgraph clients [Clients]
    UI[Web UI — WebGPU]
  end

  subgraph host [Host process]
    Core[Rust workspace<br/>SGF · rules · scenario orchestration · modules]
    AEClient[Async Analysis Engine client]
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

  UI --> Core
  Core --> AEClient --> KG
  Core --> UV --> PT --> Net
  AEClient --> Core
  PT --> Core
  Core --> Facts --> UI
```

| Concern | Choice |
| --- | --- |
| Core language | **Rust** (Cargo workspace) |
| Tooling / tasks | **mise** (mirrors [heron](https://github.com/minori-live/heron)) |
| Frontend | **Web + WebGPU** — not Electron |
| Node | Workspace scripts, docs site (VitePress), future web app |
| Python | **uv** under mise — model utilities, activation extract, concept-head training |
| CI | GitHub Actions, **latest major** action tags; Renovate updates them. **No** performance / timing tests in CI |

## Module data flow

```mermaid
flowchart TD
  SGF[SGF] --> P[Rust: parse / rebuild / chains]
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

  SC --> FC[Fate communities<br/>correlation → cluster → intra connectivity]
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

## Repository layout (scaffold)

```text
.
├── README.md                 # Landing overview
├── docs/                     # Design docs + VitePress site
├── crates/                   # Rust workspace members
│   └── yagoo-core/           # Stub crate (algorithms later)
├── python/                   # uv-managed utilities (later)
├── mise.toml                 # Tool versions + tasks
├── Cargo.toml                # Workspace root
├── package.json              # Node workspace root
└── .github/workflows/ci.yml  # Docs + lint + cargo check
```

Algorithms are **not** implemented in the first documentation PR; crates and Python dirs exist so tooling and CI have a real shape.
