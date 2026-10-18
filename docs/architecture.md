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
| `yagoo-sgf` | SGF → game record (main line, `AB`/`AW`, komi, rules, size, handicap) |
| `yagoo-katago` | Async JSON-lines client for `katago analysis`; typed queries/responses; fixture tests (no binary in CI) |

Teaching algorithms (groups, tempo, …) will land in dedicated crates or grow out of `yagoo-core` later — not implemented yet.

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
├── docs/                     # Design docs + VitePress site (+ /demo)
├── packages/
│   └── ui/                   # @yagoo/ui — Vue goban + reviewer chrome
├── crates/
│   ├── yagoo-core/           # Board / rules
│   ├── yagoo-sgf/            # SGF parsing
│   └── yagoo-katago/         # Analysis Engine client
├── python/                   # uv-managed utilities (later)
├── scripts/                  # Local-dev helpers (model download, …)
├── mise.toml
├── Cargo.toml
├── pnpm-workspace.yaml
└── .github/workflows/ci.yml
```

## Frontend (`packages/ui` / `@yagoo/ui`)

Vue 3 component library, embeddable in the VitePress docs and intended to grow into the WebGPU web app (not Electron). UI chrome imitates [Sabaki](https://github.com/SabakiHQ/Sabaki); the goban reimplements [Shudan](https://github.com/SabakiHQ/Shudan)’s DOM / `shudan-*` classes / `--shudan-*` variables / map-style props (MIT; see `packages/ui/THIRD_PARTY_NOTICES.md`).

| Area | Notes |
| --- | --- |
| `Goban` | `signMap`, `markerMap`, `ghostStoneMap`, `heatMap`, `paintMap`, `lines`, coordinates, fuzzy placement + collision (`readjustShifts`), click events; optional `fuzzySeed` for deterministic shifts |
| `useGame` | `@sabaki/sgf` (parse only; `fs` / `iconv-lite` aliased empty) + `@sabaki/immutable-gametree` + `@sabaki/go-board` |
| `ReviewerLayout` | Tatami main + right sidebar (`WinrateGraph`, game-tree placeholder, `CommentBox`) + 40px `BottomBar` |
| Overlays | `BoardGeometry` + `OverlayRenderer` interface; `SvgOverlayRenderer` / `OverlayLayer` (group-outline demo). WebGPU renderer can swap in later without changing callers |
| Custom element | `<yagoo-board>` via `defineCustomElement` / `registerYagooBoard()` |

Docs consume the package through a ClientOnly / async demo page (`docs/demo/`). mise tasks: `ui:test`, `ui:check`, `ui:dev`, `ui:build`; wired into `mise run check` and CI (no performance/timing tests).
