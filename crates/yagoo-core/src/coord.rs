//! Board points and GTP / SGF coordinate conversions.
//!
//! Internal coordinates: `x` increases right, `y` increases **down** from the
//! upper-left corner (SGF-like). GTP `A1` is the lower-left corner.

use crate::error::{CoreError, CoreResult};

/// Default teaching board size.
pub const BOARD_SIZE_19: u8 = 19;

/// A board intersection. Coordinates are zero-based.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Point {
    /// Column from the left (0 .. size).
    pub x: u8,
    /// Row from the top (0 .. size).
    pub y: u8,
}

impl Point {
    /// Create a point without bounds checking.
    #[must_use]
    pub const fn new(x: u8, y: u8) -> Self {
        Self { x, y }
    }

    /// Flat index in row-major order (top row first), matching KataGo ownership layout starting at A19.
    #[must_use]
    pub fn index(self, size: u8) -> usize {
        usize::from(self.y) * usize::from(size) + usize::from(self.x)
    }

    /// Inverse of [`Self::index`].
    #[must_use]
    pub fn from_index(index: usize, size: u8) -> Option<Self> {
        let size_usize = usize::from(size);
        if size_usize == 0 || index >= size_usize * size_usize {
            return None;
        }
        let x = u8::try_from(index % size_usize).ok()?;
        let y = u8::try_from(index / size_usize).ok()?;
        Some(Self { x, y })
    }

    /// Four orthogonal neighbors that lie on the board.
    pub fn neighbors(self, size: u8) -> impl Iterator<Item = Self> {
        let deltas: [(i16, i16); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
        deltas.into_iter().filter_map(move |(dx, dy)| {
            let x = i16::from(self.x).checked_add(dx)?;
            let y = i16::from(self.y).checked_add(dy)?;
            if x < 0 || y < 0 || x >= i16::from(size) || y >= i16::from(size) {
                return None;
            }
            Some(Self {
                x: u8::try_from(x).ok()?,
                y: u8::try_from(y).ok()?,
            })
        })
    }

    /// Parse a GTP coordinate such as `D4`, `Q16`, or `pass` (case-insensitive).
    ///
    /// Returns `Ok(None)` for pass.
    pub fn parse_gtp(text: &str, size: u8) -> CoreResult<Option<Self>> {
        let t = text.trim();
        if t.eq_ignore_ascii_case("pass") {
            return Ok(None);
        }
        if t.len() < 2 {
            return Err(CoreError::InvalidCoordinate(t.to_owned()));
        }
        let mut chars = t.chars();
        let col = chars
            .next()
            .ok_or_else(|| CoreError::InvalidCoordinate(t.to_owned()))?
            .to_ascii_uppercase();
        if !col.is_ascii_uppercase() || col == 'I' {
            return Err(CoreError::InvalidCoordinate(t.to_owned()));
        }
        let col_index = if col < 'I' {
            u8::try_from(u32::from(col) - u32::from('A'))
                .map_err(|_| CoreError::InvalidCoordinate(t.to_owned()))?
        } else {
            u8::try_from(u32::from(col) - u32::from('A') - 1)
                .map_err(|_| CoreError::InvalidCoordinate(t.to_owned()))?
        };
        let row_str: String = chars.collect();
        let row_from_bottom: u8 = row_str
            .parse()
            .map_err(|_| CoreError::InvalidCoordinate(t.to_owned()))?;
        if col_index >= size || row_from_bottom == 0 || row_from_bottom > size {
            return Err(CoreError::OutOfBounds {
                point: Self::new(col_index, 0),
                size,
            });
        }
        let y = size - row_from_bottom;
        Ok(Some(Self { x: col_index, y }))
    }

    /// Format as a GTP coordinate (never `pass`).
    #[must_use]
    pub fn to_gtp(self, size: u8) -> String {
        let letter = gtp_column_letter(self.x);
        let row_from_bottom = size - self.y;
        format!("{letter}{row_from_bottom}")
    }

    /// Parse a two-letter SGF point (`aa` …). Returns `Ok(None)` for `tt`-style pass on ≤19.
    pub fn parse_sgf(text: &str, size: u8) -> CoreResult<Option<Self>> {
        let t = text.trim();
        if t.is_empty() {
            return Ok(None);
        }
        // FF[4] pass is often empty or `tt` on 19×19.
        if t.eq_ignore_ascii_case("tt") && size <= 19 {
            return Ok(None);
        }
        let bytes = t.as_bytes();
        if bytes.len() != 2 {
            return Err(CoreError::InvalidCoordinate(t.to_owned()));
        }
        let x = sgf_axis(bytes[0])?;
        let y = sgf_axis(bytes[1])?;
        if x >= size || y >= size {
            return Err(CoreError::OutOfBounds {
                point: Self::new(x, y),
                size,
            });
        }
        Ok(Some(Self { x, y }))
    }

    /// Format as a two-letter SGF coordinate.
    #[must_use]
    pub fn to_sgf(self) -> String {
        let mut out = String::with_capacity(2);
        out.push(sgf_letter(self.x));
        out.push(sgf_letter(self.y));
        out
    }
}

fn gtp_column_letter(x: u8) -> char {
    let mut code = u32::from('A') + u32::from(x);
    if code >= u32::from('I') {
        code += 1;
    }
    char::from_u32(code).unwrap_or('?')
}

fn sgf_axis(b: u8) -> CoreResult<u8> {
    match b {
        b'a'..=b'z' => Ok(b - b'a'),
        b'A'..=b'Z' => Ok(b - b'A'),
        _ => Err(CoreError::InvalidCoordinate(
            String::from_utf8_lossy(&[b]).into_owned(),
        )),
    }
}

fn sgf_letter(v: u8) -> char {
    char::from(b'a' + v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gtp_roundtrip_corners_19() {
        let a19 = Point::new(0, 0);
        assert_eq!(a19.to_gtp(19), "A19");
        assert_eq!(Point::parse_gtp("A19", 19).unwrap(), Some(a19));

        let t1 = Point::new(18, 18);
        assert_eq!(t1.to_gtp(19), "T1");
        assert_eq!(Point::parse_gtp("T1", 19).unwrap(), Some(t1));

        let d4 = Point::parse_gtp("D4", 19).unwrap().unwrap();
        assert_eq!(d4, Point::new(3, 15));
        assert_eq!(d4.to_gtp(19), "D4");
    }

    #[test]
    fn gtp_skips_i() {
        let j1 = Point::parse_gtp("J1", 19).unwrap().unwrap();
        assert_eq!(j1.x, 8);
        assert_eq!(j1.to_gtp(19), "J1");
    }

    #[test]
    fn sgf_roundtrip() {
        let p = Point::parse_sgf("pd", 19).unwrap().unwrap();
        assert_eq!(p, Point::new(15, 3));
        assert_eq!(p.to_sgf(), "pd");
        assert!(Point::parse_sgf("tt", 19).unwrap().is_none());
        assert!(Point::parse_sgf("", 19).unwrap().is_none());
    }

    #[test]
    fn index_matches_row_major_from_a19() {
        assert_eq!(Point::new(0, 0).index(19), 0);
        assert_eq!(Point::new(18, 0).index(19), 18);
        assert_eq!(Point::new(0, 1).index(19), 19);
        assert_eq!(Point::from_index(19, 19), Some(Point::new(0, 1)));
    }

    #[test]
    fn pass_gtp() {
        assert!(Point::parse_gtp("pass", 19).unwrap().is_none());
        assert!(Point::parse_gtp("PASS", 9).unwrap().is_none());
    }
    #[test]
    fn rejects_nonletter_gtp_columns_without_panicking() {
        for coordinate in ["11", "!1", "@1", "[1", "é1", "中1", "I1"] {
            assert!(Point::parse_gtp(coordinate, 19).is_err(), "{coordinate}");
        }
    }
}
