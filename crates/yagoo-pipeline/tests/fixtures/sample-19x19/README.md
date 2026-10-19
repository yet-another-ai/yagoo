# Sample 19×19 KataGo fixture

Recorded locally for deterministic CI replay. **Do not** regenerate in CI.

| Field | Value |
| --- | --- |
| Recorded | 2026-10-19T10:48Z |
| KataGo | KataGo v1.18.1 |
| Binary | Eigen AVX2 Linux (see `mise run katago:fetch-dev`) |
| Network | `kata1-b18c384nbt-s9996604416-d4316597426.bin.gz` |
| SGF | `docs/public/app/sample.sgf` |
| Strategy | `scan_then_deep` |
| Scan visits | 100 |
| Deep visits | 500 |
| maxDeepPlies | 8 |
| topK | 5 |
| Partials | off (final responses only) |

## Files

- `responses.json.gz` — JSON array of trimmed KataGo stdout lines (query order).
- `groups-snapshot.json` — compact deep-ply group summaries for the replay test.
- Replay via `yagoo analyze --scripted-fixture …` or `cargo test -p yagoo-pipeline --test fixture_replay`.

## Regenerate

```sh
mise run katago:fetch-dev
mise run fixtures:regen
```

## Notes from real-data review

- `r* = 0.7` kept — cluster shapes on this sample looked coherent.
- `likely_seki` requires ≥3 stones (`min_stones_for_seki`): a 2-stone H16/J17 flat clash was wrongly labelled seki; it is now `weak`.
