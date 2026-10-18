# Gain / loss ledger

**Role.** Decompose why a move is valuable or a mistake: own territory, reducing the opponent, or changing a fate community’s life status — not a single opaque point count.

Whether this module is in the **2-week MVP** is still an [open question](../open-questions.md) (high teaching value vs time to validate fate communities).

## Inputs

- Move \(m\) by side \(P\)
- Reference: **pass probe** when explaining “value of playing”; **best move** \(b\) when explaining “mistake”
- Matching ownership maps and `scoreLead`

## Fetching data

- Prefer \(o^{(m)}\) from the **same** query via `includeMovesOwnership`
- If \(m\) is missing from `moveInfos`, issue a separate query with `allowMoves=[m]` — do **not** compare against a later root analysis (different search trees)
- Reference \(o^{\mathrm{ref}}\): pass-probe root ownership, or \(b\)’s `movesOwnership`

## Assignment

Let \(\delta_i=\sigma_P\,(o_i^{(m)}-o_i^{\mathrm{ref}})\). Assign points by priority:

1. **Community term:** \(i\in C\) and \(C\)’s status changes between \(m\) and ref (or \(|\Delta g_C|\ge 0.3\)). All members of \(C\) go under “save / kill / strengthen / weaken \(C\)”.
2. **Own territory:** empty and \(\sigma_P o_i^{\mathrm{ref}}\ge 0\) under the reference.
3. **Reduce opponent:** empty and \(\sigma_P o_i^{\mathrm{ref}}<0\) under the reference.
4. **Other:** remaining stone points (scattered dead stones, etc.).

Book value \(E_k=\sum_{i\in k}\delta_i\). Scale to `scoreLead` difference:

\[
\hat E_k=E_k\cdot\frac{\sigma_P\,[\mathrm{scoreLead}(m)-\mathrm{scoreLead}(\mathrm{ref})]}{\sum_k E_k}
\]

If \(\big|\sum_k E_k-\sigma_P\Delta\mathrm{scoreLead}\big|\) exceeds **initial** 3 points, or \(\sum_k E_k\approx 0\), **do not** scale — report proportions only and flag “book vs search inconsistent”. Negative line items are allowed (e.g. “+6 territory, but C3 settled→weak −9”).

## Fact JSON fragment

```json
{
  "move": "R14",
  "vs": "pass",
  "value": 11.2,
  "ledger": [
    {
      "kind": "community",
      "id": "C5",
      "change": "weak->settled",
      "points": 7.9
    },
    { "kind": "own_territory", "points": 4.1 },
    { "kind": "reduce_opponent", "points": -0.8 }
  ],
  "consistent": true
}
```

## Teaching uses

- “~11 points: ~8 from settling C5.”
- “−7 vs best: mostly failing to save C3 (−9); the territory grab (+2) does not compensate.”
- Link to pivotal communities in the score module when a mistake creates a “game hangs on this” region.

## Known limits

- Ownership book ≠ points (issue #538) — scaling + consistency checks required
- Choice of reference changes the story — UI must label the baseline
- Sente / gote / double-sente classification is not produced directly; \(\Delta\) from tempo can approximate; full treatment is post-MVP
