//! Initial thresholds from `docs/appendix/parameters.md` / module docs.

/// Clustering + tempo thresholds (all **initial**; expect retuning).
#[derive(Clone, Debug, PartialEq)]
pub struct GroupParams {
    /// Stable-point magnitude cutoff \(\varepsilon\).
    pub epsilon: f64,
    /// Keep points with ownershipStdev ≥ this even if magnitude is small.
    pub keep_stdev: f64,
    /// Affinity exponent \(\gamma\) (documented; clustering cuts on raw \(r\)).
    pub gamma: f64,
    /// Hierarchical cut: merge while average-linkage \(r \ge r^\ast\).
    pub r_star: f64,
    /// Minimum teaching-group size \(n_{\min}\).
    pub n_min: usize,
    /// Contested when each color’s stone share ≥ this fraction.
    pub contested_color_share: f64,
    /// Settled / dead strength thresholds (\(|g|\)).
    pub settled_threshold: f64,
    /// Tempo-critical: \(g^+ \ge\) this and \(g^- \le -\) this.
    pub tempo_threshold: f64,
    /// Likely-seki band on \(|g^{\pm}|\).
    pub seki_band: f64,
    /// Minimum certainty for likely-seki (no Path-B seki head yet).
    pub seki_certainty: f64,
    /// Minimum stones before `likely_seki` is allowed (flat 1–2 stone clashes → `weak`).
    pub min_stones_for_seki: usize,
    /// Same-direction \(|d|\) gate for remote-binding scenario check.
    pub binding_delta: f64,
}

impl Default for GroupParams {
    fn default() -> Self {
        Self {
            epsilon: 0.1,
            keep_stdev: 0.3,
            gamma: 2.0,
            // Kept at 0.7 after real b18 fixture review — clustering shapes looked
            // coherent; seki false-positives were fixed via `min_stones_for_seki`.
            r_star: 0.7,
            n_min: 3,
            contested_color_share: 0.20,
            settled_threshold: 0.8,
            tempo_threshold: 0.4,
            seki_band: 0.3,
            seki_certainty: 0.7,
            // Real fixture: H16/J17 (2 stones, flat g±) was labelled likely_seki —
            // nonsense for open-board contact. Seki needs a mutual-life shaped mass.
            min_stones_for_seki: 3,
            binding_delta: 0.3,
        }
    }
}
