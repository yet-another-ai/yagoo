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
    /// Same-direction \(|d|\) gate for remote-binding scenario check.
    pub binding_delta: f64,
}

impl Default for GroupParams {
    fn default() -> Self {
        Self {
            epsilon: 0.1,
            keep_stdev: 0.3,
            gamma: 2.0,
            r_star: 0.7,
            n_min: 3,
            contested_color_share: 0.20,
            settled_threshold: 0.8,
            tempo_threshold: 0.4,
            seki_band: 0.3,
            seki_certainty: 0.7,
            binding_delta: 0.3,
        }
    }
}
