# Groups

**Role.** Partition the board into units that “rise and fall together” across candidate futures. This is Yagoo’s primary object for talking about “a group”.

**Decided order:** (1) cluster by **correlation of ownership change** across scenarios; (2) **then** analyze connectivity **inside** each group. Affinity has **no spatial term**. There is **no geometric-rule fallback** if clustering looks odd.

## Inputs

- \(o^{\mathrm{root}}, s\), and scenario set \(\{(o^{(s)}, w_s)\}\)
- Position (chains / stone colors for bookkeeping only)

## Algorithm

### 1. Fate vectors and stable points

\[
d_i(s)=o_i^{(s)}-o_i^{\mathrm{root}},\qquad
\|\mathbf{d}_i\|_w=\sqrt{\sum_s w_s\,d_i(s)^2\Big/\sum_s w_s}
\]

Points with \(\|\mathbf{d}_i\|_w < \varepsilon\) (**initial** \(\varepsilon=0.1\)) are **stable** and skip clustering.

**Exception:** keep points with \(s_i \ge 0.3\) even if magnitude is small, so high search disagreement not covered by scenarios is not dropped.

### 2. Correlation (black-positive frame)

Weighted correlation **without mean subtraction** (weighted cosine vs root deltas) — we care about moving together *relative to the current position*:

\[
r_{ij}=\frac{\sum_s w_s\,d_i(s)\,d_j(s)}
{\sqrt{\sum_s w_s d_i(s)^2}\,\sqrt{\sum_s w_s d_j(s)^2}}
\]

Affinity: \(A_{ij}=\max(0,r_{ij})^{\gamma}\) (**initial** \(\gamma=2\)).

In capturing races, black-win scenarios raise both black stones’ ownership *and* white stones’ ownership (dead white becomes black territory). Race participants are therefore **positively** correlated and land in one **contested** group — intentional.

### 3. Clustering

- **MVP:** hierarchical clustering, average linkage, distance \(1-r_{ij}\), cut at \(r^\ast\) (**initial** \(0.7\)).
- Also implement **spectral clustering** (normalized Laplacian, eigengap for \(k\)) as a comparison during validation.
- Clusters with fewer than \(n_{\min}\) members (**initial** 3) become “scattered change points”: not teaching units, but still sampled in score MC as tiny independent blocks.
- **No geometry in affinity or clustering.**

### 4. Connectivity inside each group

For each group \(C\):

1. Split member points (including empties) into 4-connected parts \(C^{(1)},\ldots,C^{(k)}\).
2. List chains and empties per part; summarize by color.
3. Classify:
   - **Simple:** \(k=1\), mostly one color (`kind: "simple"`)
   - **Contested** (semeai group): both colors exceed **initial** 20% of stones in \(C\) (`kind: "contested"`)
   - **Bound** (remote binding): \(k\ge 2\) and passes the confidence check below (`kind: "bound"`)

If two chains are truly connected, intervening empties usually share fate and join the same group — 4-connectivity then links them naturally. If empties are *not* in the group, report honest **remote binding**, not a geometric “already connected” override.

### 5. Strength and certainty

\[
g_C^{p}=\frac{1}{|C_p|}\sum_{i\in C_p}\sigma_p\,o_i^{\mathrm{root}},\qquad
c_C=\frac{1}{|C|}\sum_{i\in C}(1-s_i)
\]

Empty-only groups (open framework to surround) have no strength; zoning handles them as regions.

## Remote-binding confidence (statistical, not geometric)

For each pair of parts \((C^{(a)},C^{(b)})\), require all of:

1. Mean pairwise \(r \ge r^\ast\)
2. At least **two different scenario types** (e.g. one candidate + pass probe) show same-direction \(|d|\ge 0.3\) on both parts
3. Each part has ≥ \(n_{\min}\) members

Failures: mark **weak binding (low confidence)** in output; do **not** teach as shared fate; **do not split** the group; **do not** fall back to geometry.

## Fact JSON fragment

```json
{
  "group_id": "C3",
  "members": {
    "black_stones": ["D4", "D5", "E5"],
    "white_stones": [],
    "empty": ["C3", "C4", "D3"]
  },
  "chains": ["B:D4-D5-E5"],
  "parts": [{ "points": ["..."], "chains": ["..."] }],
  "kind": "simple | contested | bound",
  "strength": { "black": 0.42 },
  "certainty": 0.61,
  "cohesion": 0.83,
  "bound_confidence": null
}
```

`cohesion` = mean \(r_{ij}\) inside the group.

## Teaching uses

- “These three chains are one group” / “This stone is already sacrificed.”
- Contested + tempo: “Left side is a capturing race; whoever plays first wins.”
- Remote binding: “Not connected, but they share the F5 cut.” Point at the candidate scenario with largest contribution to \(r\).

## Known limits

- Only 12–20 scenarios → noisy correlations; unrelated areas can correlate by chance (especially “tenuki elsewhere” scenarios). Confidence checks only mitigate.
- Scenario set follows search candidates; lines KataGo never explores stay invisible — “looks dangerous but engine won’t touch it” → stable.
- Thresholds \(\varepsilon, r^\ast, \gamma\) need real-game tuning.
- Ko fights can merge unrelated stones; watch in validation.
- Cyclic / ring-dragon adversarial engine failure cases are **out of scope** (non-goal).
