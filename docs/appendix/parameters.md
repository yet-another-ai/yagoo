# Parameter initial values

All values are **initial** and expect retuning on real games.

| Parameter | Initial | Module |
| --- | --- | --- |
| K (candidates) | 5–8 | Scenarios |
| Visits (root / PV-end) | 500–2000 / 100–300 | Scenarios |
| Scan visits | 100 | Pipeline |
| Deep root visits (CLI default) | 800 | Pipeline |
| `reportDuringSearchEvery` | off (`None`); opt-in `--partials` @ 0.5 s | Pipeline |
| Swing \|\Δ winrate\| threshold | **0.05** | Pipeline deep select |
| Swing \|\Δ scoreLead\| threshold | **3.0** points | Pipeline deep select |
| Swing mean \|\Δ ownership\| threshold | **0.08** | Pipeline deep select |
| Max deep plies (after ranking) | **24** | Pipeline deep select |
| Stable threshold \(\varepsilon\) | 0.1 | Groups |
| Keep-if-stdev \(s_i\) | 0.3 | Groups |
| Affinity exponent \(\gamma\) | 2 | Groups (documented; MVP cut uses raw \(r\)) |
| Hierarchical cut \(r^\ast\) | 0.7 | Groups |
| Scenario weights | equal | Groups (MVP — pass probe not drowned by visits) |
| Min group size \(n_{\min}\) | 3 | Groups |
| Contested color share | 20% | Groups |
| Status thresholds | 0.8 / 0.4 / 0.3 | Tempo |
| Unsettled \(\Delta\) | 0.6 | Tempo |
| scorebelief vs scoreLead flag | 3 points | Score |
| Distribution disagreement \(\Delta P\) | 0.15 | Score |
| Territory / moyo / stdev | 0.85 / 0.3 / 0.1 | Zoning |
| Thickness \(g^-\) / \(\Delta\) / radius R | 0.9 / 0.15 / 4–5 | Zoning |
| Ledger consistency | 3 points | Ledger |

## Deep ply selection

After the coarse scan, consecutive plies with a swing clearing **any** of the winrate / scoreLead / ownership thresholds become candidates. Candidates are ranked by

\[
\frac{|\Delta\mathrm{wr}|}{\tau_{\mathrm{wr}}} + \frac{|\Delta\mathrm{sl}|}{\tau_{\mathrm{sl}}} + \frac{\overline{|\Delta\mathrm{own}|}}{\tau_{\mathrm{own}}}
\]

and truncated to `maxDeepPlies` (default 24). `--deepen-all` skips selection. `--from` / `--to` only filter the scanned range. The pipeline emits `deepPliesSelected` before the deep phase.
