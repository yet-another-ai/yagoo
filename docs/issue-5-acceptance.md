# Issue #5 acceptance checklist

The draft remains open until a usable browser analysis path is demonstrated.
Search-equivalence and unverified optimizations must not be inferred from a
successful model load or build.

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
- [ ] Targeted ladder, Benson, ko, history and scoring fixtures against upstream.
      The 72 V7 and 30 scoring cases are present; targeted ladder/ko/superko and
      simple-ko long-cycle/no-result and repeated-pass endings remain open.
- [ ] Japanese encore legality, features and scoring, or an explicit unsupported
      boundary accepted as a staged delivery. Zero-filled encore features are forbidden.
- [ ] Search behavior comparison against native KataGo on a small functional corpus,
      with stated tolerances and limits. This is not a CI throughput benchmark.

## Subsequent enhancements, separately disclosed

- fp16 GPU numerical alignment (fp32 GPU already works); other GPUs and browsers.
- Download resume, smaller/mobile models, deployed public-host verification.
- GPU-resident activation/concept consumers and extra-head snapshot propagation.
- Additional KataGo search heuristics and strength alignment beyond the first
  supported search path. A simplified PUCT implementation must retain that label.

Rust search currently runs on one dedicated worker and waits for ORT. Batch
formation and virtual reservations can execute on that worker without another
CPU thread pool. Add a Rust pool only if an identified independent workload
requires it; ORT thread count and Rust concurrency must share one explicit budget.

GitHub Actions is disabled at repository level. Local implementation and tests
continue; changing that repository setting is pending the owner's decision.
