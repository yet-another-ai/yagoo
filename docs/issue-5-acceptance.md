# Issue #5 acceptance checklist

The usable supported browser path has been demonstrated locally with real b18
SWA inference, scan/deep analysis, NDJSON export and bounded Wasm threading.
This draft remains open for review of the staged delivery below; it does not
close issue #5. Search equivalence and unverified optimizations must not be
inferred from a successful model load or build.

## Required for a usable supported path

- [x] Official b18 SWA export, provenance, license, hashes and numerical reference.
- [x] Real fp32 WebGPU inference with strict validation and actual threaded Wasm fallback.
- [x] V7 inputs, retained setup/history, legality and a portable analysis pipeline.
- [x] User-visible load/scan/deepen/cancel/error/download flow with actual NDJSON.
- [x] Explicit COOP/COEP/SAB detection, deployed worker assets, bounded ORT threads,
      single-thread fallback, static-host isolation tested locally.
- [x] Root D4 symmetry averaging with policy/ownership inverse transforms and tests.
- [x] Bounded async neural batches, reserved search paths, visit-budget accounting,
      numerical batch validation and a real-model multi-row browser smoke.
- [x] Verified two-pass scoring for Chinese/Chinese-OGS (30 upstream cases); terminal
      leaves must bypass the NN and must not create additional legal continuations.
- [x] Targeted ladder, Benson, ko, history and scoring fixtures against upstream:
      72 Python V7, 40 targeted C++ and 30 area-scoring cases. This is not exhaustive.
- [x] Unsupported encore, long-cycle/no-result and repeated-pass boundaries are
      detected from complete history, at entry and searched leaves, before NN or
      successful final output. Implementing their actual scoring remains open.
- [ ] Japanese encore legality, features and scoring, or an explicit unsupported
      boundary accepted as a staged delivery. Zero-filled encore features are forbidden.
- [x] Search behavior comparison against native KataGo on a small functional corpus,
      with stated tolerances and limits. Seven one-visit root/pass-probe queries
      match official native SWA outputs. Four eight-visit queries completed, with
      differences recorded (up to 1.766 points and 0.4380 ownership); full search
      equivalence is not established and remains outside the completed scope.
- [x] Independent algorithm and runtime reviews, with regression checks for the
      confirmed output, cancellation, initialization and provenance defects.
- [x] Root score-belief, seki and future-position heads propagated through final
      analysis responses and snapshots, with shapes, normalization, raw semantics
      and actual player perspective documented; no large activations in NDJSON.
- [x] Optional GPU-resident root activations, identity sample only, explicit query
      identity and bounded lifetime; replacement/release/failure cleanup and an
      accurate Wasm-unavailable status. Real GPU capture/release smoke passed.
- [x] Runnable browser entry point, reproducible model export/copy instructions,
      hashed assets, packaged runtime licenses and validated deployment base path.

The current local checks pass: 63 Rust tests, workspace Clippy, Wasm release build,
TypeScript, 17 browser unit tests and the production bundle. Extra-head and root
activation checks passed real fp32 WebGPU and four-thread Wasm with eight root
symmetries and batch four. See [browser setup and evidence](./browser-engine).

## Subsequent enhancements, separately disclosed

- fp16 GPU numerical alignment (fp32 GPU already works); other GPUs and browsers.
- Download resume, smaller/mobile models, deployed public-host verification.
- Trained concept-head consumers, activation visualization and persistent storage.
- Additional KataGo search heuristics and strength alignment beyond the first
  supported search path. A simplified PUCT implementation must retain that label.

The remaining decision is whether to review this supported browser stage with
explicit rule/search limits, or extend it with the missing native rule/search
behavior first. Encore and long-cycle/repeated-pass scoring are still absent;
they are rejected, not approximated. Native eight-visit differences are recorded
without relaxed tolerances or a strength claim. No individual heuristic has been
shown to account for a specific measured difference.

Rust search currently runs on one dedicated worker and waits for ORT. Batch
formation and virtual reservations can execute on that worker without another
CPU thread pool. Add a Rust pool only if an identified independent workload
requires it; ORT thread count and Rust concurrency must share one explicit budget.

GitHub Actions is disabled at repository level. Local implementation and tests
continue; changing that repository setting is pending the owner's decision.
