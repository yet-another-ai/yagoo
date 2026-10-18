# Browser engine (issue #5, work in progress)

This is an experimental implementation using the actual official
`kata1-b18c384nbt-s9996604416-d4316597426` SWA checkpoint. It is not yet a
complete implementation of issue #5 or a search-equivalent replacement for
native KataGo. The checkpoint reports model version **14**, despite the version
15 description in the original research report.

## Current implementation

- An MIT-source exporter produces nine raw heads and optionally 19 trunk
  activations, fp32/fp16 ONNX files, provenance, SHA-256 hashes, a license notice,
  and a numerical warmup reference. Export uses upstream SWA weights explicitly.
- Rust V7 feature encoding has 72 golden positions from upstream KataGo's Python
  implementation (9/13/19 boards; Chinese, Chinese-OGS, Japanese). This does not
  establish coverage for every ladder, ko, superko, or pass-alive edge case.
- `AnalysisEngine` keeps the existing analysis protocol and NDJSON pipeline,
  usable by native `AnalysisClient` and browser Rust/Wasm search. Game history
  is retained when building queries, including setup and pass moves.
- The browser package has a standalone load/scan/deepen/stop/download page.
  Model bytes are verified before use and cached in OPFS when available.
- The current search is serial PUCT with FPU, an evaluation cache, partial
  events, candidate/PV output and tree ownership aggregation. It rejects
  unsupported rules and query settings. Reaching two passes fails explicitly;
  terminal scoring and Japanese encore are not implemented. It does not mask
  the second pass or silently substitute a neural estimate for a terminal score.

## Threading and hosting

ORT CPU inference supports an actual shared-memory pthread pool. Its requested
thread count defaults to four and is capped at eight and `hardwareConcurrency - 1`
(minimum one). The calling engine worker counts as one ORT thread. Rust search
currently runs on that same worker, awaiting inference; there is no second Rust
thread pool. This is **not** parallel Rust MCTS or virtual-loss batching.

Multiple ORT threads require cross-origin isolation, SharedArrayBuffer, and
shared WebAssembly memory. Without them, the UI explains its single-thread
fallback. A failed backend initialization creates a fresh worker for fallback;
stop terminates the engine and its child workers, including during initialization.

GPU startup first tries fp16 when supported, then retries fp32 in a fresh worker
if validation fails, before falling back to Wasm. Nonfinite outputs are rejected
on every inference. Warmup probability/ownership/lead checks keep the same
tolerances on retries; a failed fp16 warmup is never labeled as validated fp16.

Vite copies the installed ORT `.wasm` and `.mjs` worker assets into `ort/`, and
bundles the Rust Wasm URL. Base paths default to `/yagoo-engine/` and can be
overridden using `YAGOO_BASE`. Dev and preview serve COOP `same-origin` and COEP
`require-corp`. Deployments should supply those response headers (`public/_headers`
is supplied for compatible hosts). On static hosts that cannot set headers,
the page offers an explicit, scoped service-worker opt-in with a one-reload guard.
Serve over HTTPS or localhost. Model hosting must be same-origin or permit CORS.

## Build and run locally

Install the repository's mise-managed Rust, Node and pnpm tools, then:

```sh
pnpm install --frozen-lockfile
rustup target add wasm32-unknown-unknown
pnpm --filter @yagoo/browser-engine build:wasm
pnpm --filter @yagoo/browser-engine check
pnpm --filter @yagoo/browser-engine build
pnpm --filter @yagoo/browser-engine preview
```

`build:wasm` installs a matching wasm-bindgen CLI into the repository's ignored
`.yagoo-data/wasm-tools` directory when needed. `WASM_BINDGEN` can select an
already installed matching executable. `mise run browser:check` combines the
Wasm build, TypeScript checks, functional unit tests and production bundle.

Use a separately checked-out MIT KataGo source tree at
`d91ea855110dae533f0aada947b2b7d78cc8a4e1` and the official checkpoint from
[KataGo training](https://media.katagotraining.org/uploaded/networks/zips/kata1/kata1-b18c384nbt-s9996604416-d4316597426.zip).
Do not use third-party AGPL exporter code. With `model.ckpt` extracted:

```sh
uv sync --project python --extra web
uv run --project python --extra web python python/web/export_model.py --katago-source /path/to/KataGo --checkpoint /path/to/model.ckpt --out .yagoo-data/web-model --trunk --fp16
```

Copy `manifest.json`, `warmup.json`, both `.onnx` files and
`KATAGO_NETWORK_LICENSE.txt` into `packages/browser-engine/public/models` before
building, or supply a hosted manifest URL in the page. Generated model and runtime
binaries are ignored by Git. The existing `@yagoo/ui` reviewer remains independent.

## Local evidence (DELTON-WS, 2026-10-18)

- Workspace Clippy with `-D warnings`, all 43 Rust tests (including the 72-position
  golden comparison), Wasm release build, TypeScript check and Vite production
  build passed. The five browser unit tests, 28 existing UI tests, UI typecheck
  and documentation build also passed.
- fp32 export matched PyTorch: maximum raw-head error `2.2888e-5`; maximum trunk
  activation error `9.1553e-5`. fp16 semantic head checks passed on native ORT CPU.
  These are numerical checks on the supplied warmup input, not strength claims.
- Real Chrome, real b18 fp32, COOP/COEP enabled: observed **three ORT pthread
  workers plus the calling engine worker**, warmup passed, and a three-position
  9x9 scan emitted 18 NDJSON events. Ownership length 81, policy length 82,
  finite outputs, normalized policy and completion were checked.
- The same real-model scan passed without isolation, with one ORT thread,
  no pthread workers, and an explicit explanation in the UI.
- The scoped service worker also passed on a static server without headers:
  after its opt-in reload the page was isolated, three ORT pthread workers were
  observed, and the same real-model scan completed successfully.
- **Real fp32 WebGPU passed** on Chrome with an NVIDIA Lovelace adapter, with
  CPU execution-provider fallback disabled. The same real-model scan completed.
  A two-position deep analysis with four visits per root and pass probe also
  completed with candidates and PVs. A separate two-pass Japanese SGF produced
  a visible terminal-scoring error and no `gameCompleted` event.
  fp16 is **not validated** on this GPU: its policy warmup differs beyond the
  existing tolerance (maximum probability error `0.00948977`, allowed `0.005`)
  and initialization accurately retries fp32 GPU.
- The original fp16 scorebelief failure was traced to ORT WebGPU 1.30's unshifted
  exponential reductions. Both LogSoftmax and the scorebelief mixture's separate
  ReduceLogSumExp now use an explicit maximum shift. This removes the observed
  nonfinite scorebelief result, without suppressing finite checks or relaxing
  numerical tolerances. Further fp16 GPU alignment remains open.

Reproduce functional browser checks after building with local model assets:

```sh
cd packages/browser-engine
node test/browser-smoke.mjs wasm-threads
node test/browser-smoke.mjs wasm-single
node test/browser-smoke.mjs service-worker
node test/browser-smoke.mjs webgpu
```

These use an installed Chrome in a temporary headless profile (or set
`BROWSER_CHANNEL=msedge`), a temporary localhost server, and save evidence under
`.yagoo-data/browser-smoke/`. They are manual functional checks, not CI performance
benchmarks. They contain no throughput or elapsed-time acceptance threshold.

## Remaining acceptance work

Align fp16 GPU numerics, add targeted rules/feature fixtures and
search correctness tests, terminal/encore handling, root symmetry averaging,
batched inference with virtual loss, native KataGo statistical comparison,
and explicit Rust search concurrency scheduling. The implementation still needs
model download resume, small-net/mobile support, propagation of extra raw heads
through snapshots, GPU-resident activation/concept-head consumers, broader browser
coverage and a deployed-host check. No full-game strength,
throughput, or shared-runner performance claim is made. These gaps must stay open
when the first draft PR is published; it must not close issue #5.
