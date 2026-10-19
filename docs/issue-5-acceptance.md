# Issue #5 acceptance checklist

The usable **EXPERIMENTAL** browser path has been demonstrated locally with real
b18 SWA inference, scan/deep analysis, NDJSON export and bounded Wasm threading.
PR #7 merges that staged path as an experimental feature; it does **not** close
issue #5 (use “Related to #5”). Search equivalence and unverified optimizations
must not be inferred from a successful model load or build. Open limits are
split into focused follow-up issues linked from PR #7.

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
      successful final output. Actual scoring remains open ([#10](https://github.com/yet-another-ai/yagoo/issues/10),
      [#16](https://github.com/yet-another-ai/yagoo/issues/16)).
- [x] Japanese encore legality, features and scoring remain unimplemented; the
      explicit unsupported boundary is accepted for this **experimental** stage
      ([#10](https://github.com/yet-another-ai/yagoo/issues/10)). Zero-filled encore
      features are forbidden.
- [x] Search behavior comparison against native KataGo on a small functional corpus,
      with stated tolerances and limits. Seven one-visit root/pass-probe queries
      match official native SWA outputs. Four eight-visit queries completed, with
      differences recorded (up to 1.766 points and 0.4380 ownership); full search
      equivalence is not established ([#11](https://github.com/yet-another-ai/yagoo/issues/11),
      [#12](https://github.com/yet-another-ai/yagoo/issues/12)).
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

## Subsequent enhancements (follow-up issues)

| Limit | Issue |
| --- | --- |
| fp16 WebGPU policy warmup (fp32 GPU works; falls back today) | [#8](https://github.com/yet-another-ai/yagoo/issues/8) |
| Unverified GPUs / browsers | [#9](https://github.com/yet-another-ai/yagoo/issues/9) |
| Japanese encore legality, features and territory scoring | [#10](https://github.com/yet-another-ai/yagoo/issues/10) |
| Search parity with native (uncertainty weights, LCB, passing, strength) | [#11](https://github.com/yet-another-ai/yagoo/issues/11) |
| Native comparison release aligned with pinned exporter | [#12](https://github.com/yet-another-ai/yagoo/issues/12) |
| Concept-head consumers, activation visualization, persistent storage | [#13](https://github.com/yet-another-ai/yagoo/issues/13) |
| Model download resume | [#14](https://github.com/yet-another-ai/yagoo/issues/14) |
| Small-net / mobile support | [#15](https://github.com/yet-another-ai/yagoo/issues/15) |
| Simple-ko long-cycle / no-result and repeated-pass scoring | [#16](https://github.com/yet-another-ai/yagoo/issues/16) |
| Deployed public-host verification | [#17](https://github.com/yet-another-ai/yagoo/issues/17) |

This experimental stage ships with explicit rule/search limits. Encore and
long-cycle/repeated-pass scoring are still absent; they are rejected, not
approximated. Native eight-visit differences are recorded without relaxed
tolerances or a strength claim. A simplified PUCT implementation must retain
that label until [#11](https://github.com/yet-another-ai/yagoo/issues/11) lands.

Rust search currently runs on one dedicated worker and waits for ORT. Batch
formation and virtual reservations can execute on that worker without another
CPU thread pool. Add a Rust pool only if an identified independent workload
requires it; ORT thread count and Rust concurrency must share one explicit budget.
