# Sample 19×19 KataGo fixture

Recorded locally for deterministic CI replay. **Do not** regenerate in CI.

| Field | Value |
| --- | --- |
| Recorded | 2026-10-19T12:17Z |
| KataGo | KataGo v1.18.1 |
| Binary | Eigen AVX2 Linux (see `mise run katago:fetch-dev`) |
| Network | `kata1-b18c384nbt-s9996604416-d4316597426.bin.gz` |
| SGF | `docs/public/app/sample.sgf` (Shusaku vs Gennan Inseki 1846, first 100 moves) |
| Strategy | `scan_then_deep` |
| Scan visits | 200 |
| Deep visits | 500 |
| maxDeepPlies | 8 |
| topK | 5 |
| Partials | off (final responses only) |

## Game credit

Public-domain historical game: Yasuda Shusaku (B, 4d) vs Inoue Gennan Inseki (W, 8d), 1846
(the "ear-reddening" game). Source: Andries Brouwer Shusaku archive
(https://homepages.cwi.nl/~aeb/go/games/), game 126. Truncated to 100 moves for the sample.

## Files

- `responses.json.gz` — JSON array of trimmed KataGo stdout lines (query order).
- `groups-snapshot.json` — compact deep-ply group summaries for the replay test.
- Replay via `yagoo analyze --scripted-fixture …` or `cargo test -p yagoo-pipeline --test fixture_replay`.

## Regenerate

```sh
mise run katago:fetch-dev
mise run fixtures:regen
```
