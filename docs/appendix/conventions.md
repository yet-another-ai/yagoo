# Symbol & coordinate conventions

## Black-positive frame

The whole system uses **black-positive** ownership and score.

- Analysis Engine: set `reportAnalysisWinratesAs` to `BLACK` (recommended).
- PyTorch outputs are **side-to-move** relative; the sidecar converts to black-positive before emitting.

## Ownership layout

- Analysis Engine: row-major, starting at **A19** (engine docs).
- PyTorch tensors: map via `features.loc_to_tensor_pos`. Cross-check against the engine before trusting overlays.

## scorebelief

- 19-road boards: \(2\times(361+60)=842\) bins (`EXTRA_SCORE_DISTR_RADIUS=60`).
- Bin \(k\) center: \(k - 421 + 0.5\).
- Training target is believed to be side-to-move final net score including komi. **Unverified** — align against `scoremean`, then convert to black net score.

## Pass probe

- Append `"pass"` to the end of `moves`.
- If the previous move was already `pass`, **skip** the probe (consecutive passes may end the game).

## Network (v1)

| Item | Value |
| --- | --- |
| Name | `kata1-b18c384nbt-s9996604416-d4316597426` |
| Weights | SWA (`use_swa`) |
| License (networks) | MIT-style per katagotraining.org network license (**verify** KataGo code LICENSE separately when vendoring) |
| `.bin.gz` → `.ckpt` | No official reverse tool; download `.ckpt` directly |
