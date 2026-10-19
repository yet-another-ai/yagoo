//! Fate vectors, weighted correlation, and average-linkage hierarchical clustering.

/// Weighted L2 magnitude of a fate vector.
#[must_use]
pub fn fate_magnitude(deltas: &[f64], weights: &[f64]) -> f64 {
    debug_assert_eq!(deltas.len(), weights.len());
    let mut num = 0.0;
    let mut den = 0.0;
    for (&d, &w) in deltas.iter().zip(weights.iter()) {
        num += w * d * d;
        den += w;
    }
    if den <= 0.0 {
        0.0
    } else {
        (num / den).sqrt()
    }
}

/// \(r_{ij}\) — weighted correlation without mean subtraction (weighted cosine).
#[must_use]
pub fn correlation(a: &[f64], b: &[f64], weights: &[f64]) -> f64 {
    debug_assert_eq!(a.len(), b.len());
    debug_assert_eq!(a.len(), weights.len());
    let mut dot = 0.0;
    let mut na = 0.0;
    let mut nb = 0.0;
    for i in 0..a.len() {
        let w = weights[i];
        dot += w * a[i] * b[i];
        na += w * a[i] * a[i];
        nb += w * b[i] * b[i];
    }
    if na <= 1e-18 || nb <= 1e-18 {
        return 0.0;
    }
    (dot / (na.sqrt() * nb.sqrt())).clamp(-1.0, 1.0)
}

/// Affinity \(A_{ij}=\max(0,r_{ij})^{\gamma}\) (documented; clustering cuts on \(r\)).
#[must_use]
#[allow(dead_code)]
pub fn affinity(r: f64, gamma: f64) -> f64 {
    r.max(0.0).powf(gamma)
}

/// Average-linkage agglomerative clustering on correlation.
///
/// Starts with each row of `fate` as its own cluster. Merges the pair with
/// highest average pairwise \(r\) while that average is \(\ge r^\ast\).
/// Returns clusters as lists of row indices (each sorted; clusters sorted by
/// min member index for determinism).
///
/// `gamma` is retained for API parity with [`GroupParams`] / the module docs;
/// the MVP cut uses raw \(r\) (see `docs/modules/groups.md`).
#[must_use]
pub fn cluster_indices(
    fate: &[Vec<f64>],
    weights: &[f64],
    r_star: f64,
    gamma: f64,
) -> Vec<Vec<usize>> {
    let _ = gamma; // reserved: spectral / affinity-matrix variants
    let n = fate.len();
    if n == 0 {
        return Vec::new();
    }

    // Pairwise correlation matrix (upper triangle stored fully for simplicity).
    let mut r = vec![vec![0.0; n]; n];
    for i in 0..n {
        r[i][i] = 1.0;
        for j in (i + 1)..n {
            let v = correlation(&fate[i], &fate[j], weights);
            r[i][j] = v;
            r[j][i] = v;
        }
    }

    // Active clusters: list of member indices.
    let mut clusters: Vec<Vec<usize>> = (0..n).map(|i| vec![i]).collect();

    loop {
        let mut best: Option<(f64, usize, usize)> = None;
        for a in 0..clusters.len() {
            for b in (a + 1)..clusters.len() {
                let avg = average_linkage_r(&clusters[a], &clusters[b], &r);
                let better = match best {
                    None => true,
                    Some((br, ba, bb)) => {
                        avg > br + 1e-15 || ((avg - br).abs() <= 1e-15 && (a, b) < (ba, bb))
                    }
                };
                if better {
                    best = Some((avg, a, b));
                }
            }
        }

        let Some((best_r, a, b)) = best else {
            break;
        };
        if best_r < r_star {
            break;
        }

        // Merge b into a (b > a), then remove b.
        let mut merged = std::mem::take(&mut clusters[a]);
        let other = std::mem::take(&mut clusters[b]);
        merged.extend(other);
        merged.sort_unstable();
        clusters[a] = merged;
        clusters.remove(b);
    }

    clusters.sort_by(|x, y| x[0].cmp(&y[0]));
    clusters
}

fn average_linkage_r(a: &[usize], b: &[usize], r: &[Vec<f64>]) -> f64 {
    let mut sum = 0.0;
    let mut count = 0_usize;
    for &i in a {
        for &j in b {
            sum += r[i][j];
            count += 1;
        }
    }
    if count == 0 {
        0.0
    } else {
        sum / count as f64
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn cosine_identical_is_one() {
        let w = [1.0, 1.0, 1.0];
        let a = [0.5, -0.2, 0.1];
        assert!((correlation(&a, &a, &w) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn cosine_opposite_is_minus_one() {
        let w = [1.0, 1.0];
        let a = [1.0, 0.5];
        let b = [-1.0, -0.5];
        assert!((correlation(&a, &b, &w) + 1.0).abs() < 1e-9);
    }

    #[test]
    fn clusters_two_correlated_pairs() {
        // Points 0,1 move together; 2,3 move together in the opposite pattern.
        let fate = vec![
            vec![0.5, 0.0],
            vec![0.4, 0.0],
            vec![0.0, 0.5],
            vec![0.0, 0.4],
        ];
        let w = [1.0, 1.0];
        let clusters = cluster_indices(&fate, &w, 0.7, 2.0);
        assert_eq!(clusters.len(), 2);
        assert!(clusters.iter().any(|c| c == &vec![0, 1]));
        assert!(clusters.iter().any(|c| c == &vec![2, 3]));
    }
}
