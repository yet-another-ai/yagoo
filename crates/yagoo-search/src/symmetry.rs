//! D4 transforms inside the actual board, retaining the 19x19 model padding.
use crate::RawHeads;
use yagoo_core::nn_features::{V7Features, NN_AREA, NN_LEN};

fn point(x: usize, y: usize, size: usize, symmetry: usize) -> (usize, usize) {
    let x = if symmetry & 1 == 0 { x } else { size - 1 - x };
    let y = if symmetry & 2 == 0 { y } else { size - 1 - y };
    if symmetry & 4 == 0 {
        (x, y)
    } else {
        (y, x)
    }
}

pub(crate) fn input(input: &V7Features, size: u8, symmetry: usize) -> V7Features {
    let n = usize::from(size);
    let stride = usize::from(NN_LEN);
    let mut result = input.clone();
    for y in 0..n {
        for x in 0..n {
            let (tx, ty) = point(x, y, n, symmetry);
            for channel in 0..22 {
                result.spatial[channel * NN_AREA + ty * stride + tx] =
                    input.spatial[channel * NN_AREA + y * stride + x];
            }
            result.legal[ty * n + tx] = input.legal[y * n + x];
        }
    }
    result
}

fn inverse_planes(
    values: &mut [f32],
    size: u8,
    symmetry: usize,
    plane: usize,
) -> Result<(), String> {
    if values.len() % plane != 0 {
        return Err("Malformed spatial neural head".into());
    }
    let n = usize::from(size);
    let stride = usize::from(NN_LEN);
    for channel in values.chunks_exact_mut(plane) {
        let source = channel.to_vec();
        for y in 0..n {
            for x in 0..n {
                let (tx, ty) = point(x, y, n, symmetry);
                channel[y * stride + x] = source[ty * stride + tx];
            }
        }
    }
    Ok(())
}

pub(crate) fn output(mut raw: RawHeads, size: u8, symmetry: usize) -> Result<RawHeads, String> {
    inverse_planes(&mut raw.policy, size, symmetry, NN_AREA + 1)?;
    for head in [&mut raw.ownership, &mut raw.seki, &mut raw.futurepos] {
        inverse_planes(head, size, symmetry, NN_AREA)?;
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn all_eight_are_distinct_bijections_and_invert_model_planes() {
        for size in [9, 13, 19] {
            let n = usize::from(size);
            let mut maps = HashSet::new();
            for symmetry in 0..8 {
                let map: Vec<_> = (0..n * n)
                    .map(|i| point(i % n, i / n, n, symmetry))
                    .collect();
                assert_eq!(map.iter().collect::<HashSet<_>>().len(), n * n);
                maps.insert(map);
                let mut original = V7Features {
                    spatial: vec![0.0; 22 * NN_AREA],
                    global: vec![3.0; 19],
                    legal: vec![true; n * n + 1],
                };
                for y in 0..n {
                    for x in 0..n {
                        original.spatial[y * 19 + x] = (y * n + x) as f32;
                    }
                }
                let transformed = input(&original, size, symmetry);
                assert_eq!(transformed.global, original.global);
                assert_eq!(transformed.legal.last(), Some(&true));
                let mut plane = transformed.spatial[..NN_AREA].to_vec();
                plane.push(123.0); // Pass is invariant, including on small boards.
                inverse_planes(&mut plane, size, symmetry, NN_AREA + 1).unwrap();
                assert_eq!(&plane[..NN_AREA], &original.spatial[..NN_AREA]);
                assert!((plane[NN_AREA] - 123.0).abs() < f32::EPSILON);
            }
            assert_eq!(maps.len(), 8);
        }
    }
}
