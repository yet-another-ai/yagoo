//! Minimal SGF collection / game-tree parser (main line only).
//!
//! Grammar (FF[4] subset):
//! `GameTree = "(" Sequence { GameTree } ")"`
//! `Sequence = Node { Node }`
//! `Node = ";" { Property }`

use crate::error::{SgfError, SgfResult};
use crate::record::{GameRecord, GameTreeNode, MoveRecord, SetupStones};
use yagoo_core::{Color, Point, Ruleset};

/// Parse an SGF string into a [`GameRecord`] using the first game's main line.
pub fn parse_sgf(input: &str) -> SgfResult<GameRecord> {
    record_from_tree(&parse_sgf_tree(input)?)
}

/// Parse the first game tree, preserving node properties and variation ancestry.
pub fn parse_sgf_tree(input: &str) -> SgfResult<GameTreeNode> {
    let mut lexer = Lexer::new(input);
    lexer.skip_ws();
    if lexer.eof() {
        return Err(SgfError::Empty);
    }
    parse_game_tree(&mut lexer)
}

fn parse_game_tree(lexer: &mut Lexer<'_>) -> SgfResult<GameTreeNode> {
    lexer.expect(b'(')?;
    let mut nodes = Vec::new();
    while {
        lexer.skip_ws();
        lexer.peek() == Some(b';')
    } {
        lexer.bump();
        nodes.push(parse_node_props(lexer)?);
    }
    if nodes.is_empty() {
        return Err(SgfError::Expected(";"));
    }

    let mut variations = Vec::new();
    while {
        lexer.skip_ws();
        lexer.peek() == Some(b'(')
    } {
        variations.push(parse_game_tree(lexer)?);
    }
    lexer.expect(b')')?;

    // Linearize the sequence; attach variations as children of the last node.
    let mut root = nodes.remove(0);
    let mut tip = &mut root;
    for node in nodes {
        tip.children.push(node);
        tip = tip.children.last_mut().expect("just pushed");
    }
    tip.children.append(&mut variations);
    Ok(root)
}

fn parse_node_props(lexer: &mut Lexer<'_>) -> SgfResult<GameTreeNode> {
    let mut props = Vec::new();
    loop {
        lexer.skip_ws();
        match lexer.peek() {
            Some(b) if b.is_ascii_uppercase() => {
                let ident = lexer.read_ident();
                let mut values = Vec::new();
                lexer.skip_ws();
                while lexer.peek() == Some(b'[') {
                    values.push(lexer.read_prop_value()?);
                    lexer.skip_ws();
                }
                if values.is_empty() {
                    return Err(SgfError::Expected("["));
                }
                props.push((ident, values));
            }
            _ => break,
        }
    }
    Ok(GameTreeNode {
        props,
        children: Vec::new(),
    })
}

fn record_from_tree(root: &GameTreeNode) -> SgfResult<GameRecord> {
    let size = root
        .get_one("SZ")
        .map(|s| {
            s.parse::<u8>()
                .map_err(|_| SgfError::InvalidValue(s.to_owned()))
        })
        .transpose()?
        .unwrap_or(19);
    if !(2..=25).contains(&size) {
        return Err(SgfError::UnsupportedSize(size));
    }

    let komi = root
        .get_one("KM")
        .map(|s| {
            s.parse::<f64>()
                .map_err(|_| SgfError::InvalidValue(s.to_owned()))
        })
        .transpose()?
        .unwrap_or(0.0);

    let rules = root.get_one("RU").map(str::to_owned);
    let ruleset = match rules.as_deref() {
        Some(r) if r.eq_ignore_ascii_case("chinese") || r.eq_ignore_ascii_case("cn") => {
            Ruleset::Chinese
        }
        Some(r) if r.eq_ignore_ascii_case("japanese") || r.eq_ignore_ascii_case("jp") => {
            Ruleset::Japanese
        }
        _ => Ruleset::Chinese,
    };

    let handicap = root
        .get_one("HA")
        .map(|s| {
            s.parse::<u8>()
                .map_err(|_| SgfError::InvalidValue(s.to_owned()))
        })
        .transpose()?;

    let mut setup = SetupStones::default();
    if let Some(vals) = root.get("AB") {
        for v in vals {
            if let Some(p) = Point::parse_sgf(v, size)? {
                setup.black.push(p);
            }
        }
    }
    if let Some(vals) = root.get("AW") {
        for v in vals {
            if let Some(p) = Point::parse_sgf(v, size)? {
                setup.white.push(p);
            }
        }
    }

    let initial_player = match root.get_one("PL") {
        Some("B") => Color::Black,
        Some("W") => Color::White,
        Some(value) => return Err(SgfError::InvalidValue(format!("invalid PL[{value}]"))),
        None if handicap.unwrap_or(0) >= 2 && setup.white.is_empty() => Color::White,
        None => Color::Black,
    };

    let mut moves = Vec::new();
    let mut node = root;
    collect_move(node, size, &mut moves)?;
    while let Some(child) = node.children.first() {
        node = child;
        collect_move(node, size, &mut moves)?;
    }

    Ok(GameRecord {
        size,
        komi,
        rules,
        ruleset,
        handicap,
        setup,
        initial_player,
        moves,
        application: root.get_one("AP").map(str::to_owned),
        player_black: root.get_one("PB").map(str::to_owned),
        player_white: root.get_one("PW").map(str::to_owned),
    })
}

fn collect_move(node: &GameTreeNode, size: u8, moves: &mut Vec<MoveRecord>) -> SgfResult<()> {
    if let Some(vals) = node.get("B") {
        let point = Point::parse_sgf(vals.first().map_or("", String::as_str), size)?;
        moves.push(MoveRecord {
            color: Color::Black,
            point,
        });
    } else if let Some(vals) = node.get("W") {
        let point = Point::parse_sgf(vals.first().map_or("", String::as_str), size)?;
        moves.push(MoveRecord {
            color: Color::White,
            point,
        });
    }
    Ok(())
}

struct Lexer<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Lexer<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn eof(&self) -> bool {
        self.pos >= self.bytes.len()
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn bump(&mut self) {
        self.pos += 1;
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.bump();
        }
    }

    fn expect(&mut self, c: u8) -> SgfResult<()> {
        self.skip_ws();
        match self.peek() {
            Some(b) if b == c => {
                self.bump();
                Ok(())
            }
            _ => Err(SgfError::Expected(match c {
                b'(' => "(",
                b')' => ")",
                b';' => ";",
                b'[' => "[",
                _ => "token",
            })),
        }
    }

    fn read_ident(&mut self) -> String {
        let start = self.pos;
        while matches!(self.peek(), Some(b'A'..=b'Z')) {
            self.bump();
        }
        String::from_utf8_lossy(&self.bytes[start..self.pos]).into_owned()
    }

    fn read_prop_value(&mut self) -> SgfResult<String> {
        self.expect(b'[')?;
        let mut out = String::new();
        while let Some(b) = self.peek() {
            self.bump();
            match b {
                b']' => return Ok(out),
                b'\\' => {
                    if let Some(n) = self.peek() {
                        self.bump();
                        out.push(char::from(n));
                    }
                }
                _ => out.push(char::from(b)),
            }
        }
        Err(SgfError::UnexpectedEof)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yagoo_core::Point;

    #[test]
    fn parse_simple_game() {
        let sgf = r"(;FF[4]GM[1]SZ[19]KM[7.5]RU[Chinese];B[pd];W[dd];B[pp];W[])";
        let g = parse_sgf(sgf).unwrap();
        assert_eq!(g.size, 19);
        assert!((g.komi - 7.5).abs() < f64::EPSILON);
        assert_eq!(g.rules.as_deref(), Some("Chinese"));
        assert_eq!(g.ruleset, Ruleset::Chinese);
        assert_eq!(g.moves.len(), 4);
        assert_eq!(g.moves[0].point, Some(Point::new(15, 3)));
        assert_eq!(g.moves[3].point, None);
        assert_eq!(g.moves[3].color, Color::White);
    }

    #[test]
    fn parse_handicap_setup() {
        let sgf = r"(;FF[4]SZ[19]HA[2]AB[dd][pd];W[qp];B[dp])";
        let g = parse_sgf(sgf).unwrap();
        assert_eq!(g.handicap, Some(2));
        assert_eq!(g.setup.black.len(), 2);
        assert_eq!(g.initial_player, Color::White);
        assert_eq!(g.moves[0].color, Color::White);
    }

    #[test]
    fn main_line_ignores_side_variations() {
        let sgf = r"(;SZ[9];B[cc](;W[ee];B[gg])(;W[aa]))";
        let g = parse_sgf(sgf).unwrap();
        assert_eq!(g.moves.len(), 3);
        assert_eq!(g.moves[1].point, Some(Point::new(4, 4)));
        assert_eq!(g.moves[2].point, Some(Point::new(6, 6)));
    }
}
