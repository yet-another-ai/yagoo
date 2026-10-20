# Browser engine (EXPERIMENTAL)

> **EXPERIMENTAL feature.** This is a staged, mergeable browser analysis path —
> not a complete delivery of research issue #5 and not a search-equivalent
> replacement for native KataGo. The native CLI / `AnalysisClient` path is
> unchanged. Treat outputs as experimental; see follow-up issues linked from
> PR #7 for remaining acceptance work.

This implementation uses the actual official
`kata1-b18c384nbt-s9996604416-d4316597426` SWA checkpoint. The checkpoint
reports model version **14**, despite the version 15 description in the
original research report.

## Current implementation

- An MIT-source exporter produces nine raw heads and optionally 19 trunk
  activations, fp32/fp16 ONNX files, provenance, SHA-256 hashes, a license notice,
  and a numerical warmup reference. Export uses upstream SWA weights explicitly.
- Rust V7 feature encoding has 72 golden positions from upstream KataGo's Python
  implementation (9/13/19 boards; Chinese, Chinese-OGS, Japanese), plus 40 targeted
  C++ references for ladders, ko/superko, retained history, pass probes, large komi
  and terminal boundaries. This is targeted coverage, not exhaustive rule proof.
- `AnalysisEngine` keeps the existing analysis protocol and NDJSON pipeline,
  usable by native `AnalysisClient` and browser Rust/Wasm search. Game history
  is retained when building queries, including setup and pass moves.
- The browser package has a standalone load/scan/deepen/stop/download page with a
  **jet-style model island**: choose a catalog entry (b18 SWA default; others
  listed as unavailable when unsupported), see approximate/exact size, **Load
  model** only on explicit click (never on page load / never in CI), progress in
  MB with cancel, OPFS content-addressed cache with clear, and **Load local
  files** for an exported `manifest.json` + `.onnx` + `warmup.json`. Bytes are
  SHA-256 verified before use. HTTP Range resume remains open ([#14](https://github.com/yet-another-ai/yagoo/issues/14)).
- Experimental PUCT/FPU search has a bounded cache, partial events, candidates,
  PVs and tree ownership. Optional eight-way root symmetry averages probabilities
  and ownership after inverse transforms. Async batches of up to four reserve
  distinct unexpanded edges, apply temporary virtual losses, preserve row order
  and honor the remaining visit budget. Failure discards the query's tree.
- Chinese/Chinese-OGS two-pass endings use exact area scoring without a neural
  call or further continuations. Thirty cases match upstream C++ BoardHistory,
  including handicap compensation, draws and a Benson-alive enclosing chain.
  Japanese encore remains explicitly unsupported, including when search reaches
  it. No second pass is masked and no neural estimate substitutes for its score.
- Entire-history guards reject Japanese encore, simple-ko third repetitions
  (no-result), repeated-pass phase endings and resumed play after terminal states,
  both at query entry and before evaluating searched leaves. Errors cannot be
  hidden by appending further moves, and never emit a successful final response.
- Value and lead postprocessing handle no-result according to the selected rules.
  Ownership uses normalized visit-square tree weighting with a unit NN weight;
  native uncertainty-dependent weighting is not implemented. Candidate standard
  deviation can be requested independently. PV length accepts 1..1000, counts the
  candidate move and reports matching visit arrays. Unsupported winrate LCB is
  omitted rather than substituting a utility bound.
- Dropping a native analysis future removes its route immediately and queues a
  single-query termination. An independent writer completes JSON lines; unique
  wire IDs prevent late old responses from reaching an immediately restarted query.
- Completed browser snapshots carry score-belief, seki and future-position heads
  in the optional `neural` field. These are the root's identity sample, with an
  explicit player perspective; they are not symmetry- or search-averaged. Native,
  terminal and partial responses omit them. See the [snapshot schema](./pipeline/snapshots).
- Optional root trunk retention keeps GPU tensors inside the engine worker and
  sends only ephemeral-handle metadata to the page. See [Root activations](#root-activations).

## Threading and hosting

ORT CPU inference supports an actual shared-memory pthread pool. Its requested
thread count defaults to four and is capped at eight and `hardwareConcurrency - 1`
(minimum one). The calling engine worker counts as one ORT thread. Rust search
currently runs on that same worker, awaiting inference; there is no second Rust
thread pool. Rust forms asynchronous batches with virtual reservations on that
worker; it does not run parallel CPU tree traversals. This avoids oversubscribing
the ORT pool while allowing actual multi-row inference.

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
overridden using `YAGOO_BASE`, an absolute path with a trailing slash (for example
`/engine/`). Relative paths, query strings and URL hosts are rejected at build
time so ORT and service-worker URLs cannot silently resolve elsewhere.
Dev and preview serve COOP `same-origin` and COEP
`require-corp`. Deployments should supply those response headers (`public/_headers`
is supplied for compatible hosts). On static hosts that cannot set headers,
the page offers an explicit, scoped service-worker opt-in with a one-reload guard.
Serve over HTTPS or localhost. Model hosting must be same-origin or permit CORS.
Production bundles also contain the KataGo code notice and matching ORT license
and third-party notices. Export verifies the selected official checkpoint SHA
before loading PyTorch, binding the manifest identity to those exact weights.

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

Open the preview URL printed by Vite, normally
`http://localhost:4173/yagoo-engine/`. This is the runnable engine entry point;
the existing reviewer at docs `/app/` imports downloaded NDJSON (browser live
adapter is [#20](https://github.com/yet-another-ai/yagoo/issues/20)). Weights are
not shipped in git and are not fetched until you click **Load model** (or stage
local files first).

The page’s `#model-island` (`data-slot="model-island"`) is the catalog, size,
progress, cancel, OPFS clear, and local-file island. The reviewer engine menu
exposes the same slot so that island can mount there when #20 wires the adapter
([reviewer UI](./design/reviewer-ui.md)). Opening either surface does not fetch
weights.

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
uv run --project python --extra web python python/web/export_model.py --katago-source /path/to/KataGo --checkpoint /path/to/model.ckpt --out .yagoo-data/web-model --batch 0 --trunk
```

`--batch 0` exports a dynamic batch with an explicitly supported maximum of four;
the default `--batch 1` retains a fixed single-row model. The exporter checks
varied valid inputs at batches two, three and four against PyTorch and single-row
ORT. `--fp16` additionally exports an optional half-precision variant.

Copy `manifest.json`, `warmup.json`, the exported `.onnx` files and
`KATAGO_NETWORK_LICENSE.txt` into `packages/browser-engine/public/models` before
building, or supply a hosted manifest URL in the page. Generated model and runtime
binaries are ignored by Git. The existing `@yagoo/ui` reviewer remains independent.

Serve the built `packages/browser-engine/dist` directory at the configured base
path, including its `ort/`, Wasm, model and license assets. Check that `.wasm`
responses have the WebAssembly MIME type and that COOP/COEP headers apply to the
entry document. A remote model host must also allow the page's origin through
CORS. The page verifies file hashes and nine required heads against the selected
official model manifest before analysis; a missing model is an explicit load
error. Public-host deployment has not been performed or verified
([#17](https://github.com/yet-another-ai/yagoo/issues/17)). Small-net / mobile
profiles are not shipped ([#15](https://github.com/yet-another-ai/yagoo/issues/15)).

## Root activations

Retention is off by default. Enable the page's GPU retention checkbox before
loading a bundle exported with `--trunk`, or call
`BrowserEngine.initialize(url, { retainRootActivations: true })`. A validated
WebGPU session retains the first identity row of the first root-symmetry batch:
18 block outputs and `trunkfinal`, each `[1, 384, 19, 19]`. It copies those outputs
into owned GPU buffers, without reading them back to the CPU. With the tested
fp32 bundle the retained buffers total 10,535,424 bytes (about 10.05 MiB), in
addition to the model's normal working memory. Other symmetry rows are released.

The `onMessage` callback receives `rootActivations` messages separately from
NDJSON events. An available message contains a `lease` with the root query ID,
board size, actual player to move, model SHA, opaque handle and layer shapes.
This is the **latest evaluated query root**; deep analysis can replace it with
a pass-probe or PV-end root. It is not necessarily the position currently shown
by another UI. No tensor values or GPU buffers cross the worker boundary.

Only one root is retained. A new root, including a terminal root, invalidates
the previous handle. `releaseRootActivations()` releases buffers without
cancelling analysis and disables further retention until reload. Stop, errors
and GPU device loss also invalidate the handle. Wasm reports that GPU retention
is unavailable; an optional capture failure reports its reason while preserving
validated analysis heads.

`RootActivationStore.use(handle, consume)` is a worker-local extension point for
future GPU consumers on the ORT device. A consumer must submit its GPU work
synchronously inside that callback before the handle can expire. No trained
concept head, activation visualization, persistent activation archive, or
main-thread tensor-access API is implemented. Large activations never enter the
snapshot schema or NDJSON. The small extra neural heads have documented raw
semantics and should not be presented as calibrated teaching conclusions.

## Local evidence (DELTON-WS, 2026-10-18 to 2026-10-19)

- Workspace Clippy with `-D warnings`, all 63 Rust tests (including 72 Python V7,
  40 targeted C++ and 30 scoring references), Wasm release build, TypeScript check,
  seventeen browser unit tests and Vite production build passed after review fixes.
  The unchanged reviewer previously passed 28 UI tests and its typecheck.
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
  A two-position deep analysis with eight visits per root and pass probe also
  completed with candidates and PVs. A separate two-pass Japanese SGF produced
  a visible terminal-scoring error and no `gameCompleted` event.
  fp16 is **not validated** on this GPU ([#8](https://github.com/yet-another-ai/yagoo/issues/8)):
  its policy warmup differs beyond the existing tolerance (maximum probability
  error `0.00948977`, allowed `0.005`) and initialization accurately retries
  fp32 GPU. Other GPUs/browsers remain unverified
  ([#9](https://github.com/yet-another-ai/yagoo/issues/9)).
- The original fp16 scorebelief failure was traced to ORT WebGPU 1.30's unshifted
  exponential reductions. Both LogSoftmax and the scorebelief mixture's separate
  ReduceLogSumExp now use an explicit maximum shift. This removes the observed
  nonfinite scorebelief result, without suppressing finite checks or relaxing
  numerical tolerances. Further fp16 GPU alignment remains open.
- Dynamic fp32 export with varied inputs passed batches two, three and four;
  maximum absolute error across all exported outputs was `0.000123978`. Real WebGPU and four-thread Wasm both
  passed the three-position scan using eight root symmetries and actual batch
  four (24 neural evaluations). Browser warmup validates both one and four rows.
- A further real WebGPU/four-thread Wasm scan checked all three extra heads,
  their dimensions, finite values, normalized score-belief and player metadata
  in completed snapshots. The GPU run retained and released all 19 root layers
  at `[1,384,19,19]`, with GPU validation errors checked; the Wasm run accurately
  reported retention unavailable. Both still used 24 neural evaluations for
  three positions. This validates GPU residence and lifetime, not a new readback
  comparison of activation values. See [the recorded evidence](./evidence/browser-extra-outputs.json).
- Search contract tests cover inverse symmetry, normalized root averaging,
  distinct leaf reservations, exact visit budgets, inference failure cleanup,
  and a mixed batch containing scored terminal and neural leaves. Terminal
  roots bypass all inference. These deterministic test evaluators are not models
  and are not used by the browser runtime.
- The real GPU batch smoke also completes scan and deep analysis of a Chinese
  two-pass ending: exact black score `-7.5`, zero continuation policy, no candidates,
  and no pass probe after the game ends. Japanese encore still produces a visible
  error without a false game-completion event.
- A seven-query one-visit comparison against official KataGo v1.16.4 EigenAVX2
  used the same SWA weights exported by pinned upstream code, eight symmetries,
  retained pre-root history and black-positive results. Maximum absolute errors:
  winrate `2.804e-7`, lead `2.676e-5`, ownership `2.398e-6`, policy `4.582e-6`.
  Root and pass-probe results pass unchanged tolerances (0.002 for probability/
  ownership, 0.05 points for lead). Native analysis defaults to hiding pre-root
  history; the comparison explicitly disables that default to match browser inputs.
  The release binary is older than the pinned feature oracle/export source
  ([#12](https://github.com/yet-another-ai/yagoo/issues/12)).
- The same corpus completed two eight-visit roots and their pass probes on both
  engines. Root policies still agree within `4.656e-6`; searched values differ:
  up to `0.007128` winrate, `1.766` points, `0.4380` ownership and `0.2731`
  ownership standard deviation. These are recorded differences, not relaxed
  acceptance tolerances. Native search heuristics/defaults and this batched PUCT
  search are different; a single tiny-budget run does not establish strength or
  search equivalence ([#11](https://github.com/yet-another-ai/yagoo/issues/11)).
  See [the recorded comparison](./evidence/native-katago-comparison.json).
- Two independent code reviews covered algorithms/rules and runtime/cancellation/
  provenance. Confirmed defects were fixed, including friendly-pass history,
  komi clipping, no-result output, ownership/PV fields, repeated-click event loss,
  cancellation during a partial native JSON write, and missing deployed notices.
  Functional cancellation tests include immediate same-ID restart, late responses,
  termination acknowledgments and callback failure. No EOF/CLI changes were made.

Reproduce functional browser checks after building with local model assets:

```sh
cd packages/browser-engine
node test/browser-smoke.mjs wasm-threads
node test/browser-smoke.mjs wasm-single
node test/browser-smoke.mjs service-worker
node test/browser-smoke.mjs webgpu
node test/browser-smoke.mjs wasm-batch
node test/browser-smoke.mjs webgpu-batch
# Optional retention and extra-head checks, limited to the three-position scan:
SMOKE_OUTPUTS_ONLY=1 node test/browser-smoke.mjs webgpu-batch
SMOKE_OUTPUTS_ONLY=1 node test/browser-smoke.mjs wasm-batch
```

In PowerShell, set `$env:SMOKE_OUTPUTS_ONLY='1'` before the last two commands and
remove it afterward with `Remove-Item Env:SMOKE_OUTPUTS_ONLY`.

These use an installed Chrome in a temporary headless profile (or set
`BROWSER_CHANNEL=msedge`), a temporary localhost server, and save evidence under
`.yagoo-data/browser-smoke/`. They are manual functional checks, not CI performance
benchmarks. They contain no throughput or elapsed-time acceptance threshold.

Regenerate scoring fixtures from the pinned upstream source without a model:

```sh
python python/web/build_rules_reference.py --katago-source /path/to/KataGo --out .yagoo-data/rules-reference
python python/web/rules_goldens.py --oracle .yagoo-data/rules-reference/rules_reference --out crates/yagoo-search/tests/fixtures/area.json
python python/web/targeted_goldens.py --oracle .yagoo-data/rules-reference/rules_reference --out crates/yagoo-core/tests/fixtures/v7-targeted.json
```

On Windows, use an x64 Visual Studio developer shell, add `--compiler cl`, and
use `rules_reference.exe`. The checked fixture contains 30 exact area scores
and three Japanese phase-transition examples documenting the unsupported boundary.

For the small native comparison, set `SMOKE_DEEP_VISITS=1` when running
`webgpu-batch` to save the reference corpus, then run `python/web/compare_native.py`
with `--engine`, `--model`, `--browser-dir` and `--out`. The model must be exported
from the same official checkpoint using upstream `export_model_pytorch.py -use-swa`.
Without that environment override the smoke uses eight deep visits; the comparison
reports their differences without claiming native search parity. No model downloads,
native engine runs or browser GPU experiments are added to shared-runner CI.

## Remaining acceptance work (follow-ups)

See the [acceptance checklist](./issue-5-acceptance.md) and the **Follow-ups**
section on [PR #7](https://github.com/yet-another-ai/yagoo/pull/7). Each open
limit is its own issue (related to #7 / #5):

- [#8](https://github.com/yet-another-ai/yagoo/issues/8) fp16 WebGPU policy warmup (falls back to fp32)
- [#9](https://github.com/yet-another-ai/yagoo/issues/9) Unverified GPUs / browsers
- [#10](https://github.com/yet-another-ai/yagoo/issues/10) Japanese encore legality, features and territory scoring
- [#16](https://github.com/yet-another-ai/yagoo/issues/16) Simple-ko long-cycle / no-result and repeated-pass scoring
- [#11](https://github.com/yet-another-ai/yagoo/issues/11) Search parity with native (uncertainty weighting, LCB, passing heuristics, strength)
- [#12](https://github.com/yet-another-ai/yagoo/issues/12) Native comparison release aligned with the pinned exporter
- [#13](https://github.com/yet-another-ai/yagoo/issues/13) Concept-head consumers, activation visualization, persistent activation storage
- [#14](https://github.com/yet-another-ai/yagoo/issues/14) Model download resume (cancel exists; Range resume does not)
- [#15](https://github.com/yet-another-ai/yagoo/issues/15) Small-net / mobile support
- [#17](https://github.com/yet-another-ai/yagoo/issues/17) Deployed public-host verification

No full-game strength, throughput, or shared-runner performance claim is made.
Issue #5 remains the research tracking issue; merging this experimental path
must not close #5.
