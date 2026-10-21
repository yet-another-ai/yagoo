# Opening and joseki recognition

The header recognizes a small, original catalogue of opening examples without
an engine or a model download. The native and browser pipeline also emit the
result immediately after `gameStarted`, before engine queries. This is a
sequence label, not an assessment of move quality.

The shared source is [`data/openings.json`](https://github.com/yet-another-ai/yagoo/blob/main/data/openings.json).
Its [provenance and coverage](https://github.com/yet-another-ai/yagoo/blob/main/data/OPENINGS_PROVENANCE.md)
are recorded alongside it. These seven original entries are licensed under
the repository's Apache-2.0 license. No external joseki database or AGPL content
is incorporated.

## Matching

- Empty-start 19x19 games only; setup stones and handicap are outside the catalogue.
- Native and UI recognition reject `AB`, `AW`, or `AE` properties, including
  empty values, on the first game's main line through the 30th move node.
  Comments, sibling variations, later games, and edits after that node do not
  affect the opening label. This guard does not add mid-game setup-edit replay.
- At most the first 30 plies. Fuseki matches every colored move in the whole-board
  prefix. Joseki starts match moves in an 8x8 corner, ignoring plays elsewhere.
- All eight board symmetries and both color assignments are considered.
- Move order matters. Matching board occupancy alone would erase captures,
  interleaved moves, and transposition differences.
- Each line requires a minimum prefix. Different equally long lines are
  ambiguous and produce no label in that category. A unique whole-board match
  takes priority over local corner matches.
- The first mismatching move within an unfinished stored continuation is
  `deviationPly`, in global move numbering. Playing elsewhere is not a local
  deviation. A pass stops local observation without inventing a corner move.
  Reaching a short catalogue leaf does not label later moves deviations.

The short corner entries are joseki **starts**, not complete balanced lines.
The catalogue is intentionally limited: “No unique match in starter catalogue”
does not imply that the game used an unusual or incorrect opening.

## Wire contract and reviewer

The additive schema-v1 event is:

```json
{
  "type": "openingMatched",
  "v": 1,
  "match": {
    "name": "4-4 point",
    "joseki": "3-3 invasion: block and extend",
    "deviationPly": 6,
    "source": "yagoo-starter-1 (Apache-2.0)"
  }
}
```

`match: null` means no unique match. `GameSnapshot.opening` stores the same
result when an aggregate is requested; old files may omit it. Analysis range
filters do not hide the opening: matching uses the input game's prefix even
when engine analysis starts at a later ply. `gameStarted` clears the previous
game's reducer state, including its opening.

When an SGF is loaded, the reviewer computes its label locally with Sabaki's
parser and the same catalogue/algorithm. An unrelated NDJSON import cannot
replace that SGF's opening. The header renders a pipeline label only when no
SGF is loaded. No engine or network request is needed to recognize the SGF.

Rust and TypeScript run the same committed cases under all sixteen
symmetry/color combinations. Tests cover ambiguity, strict order, tenuki,
global deviation numbering, stored leaves, passes, horizon, unsupported
inputs, pipeline range filtering, and loading another game. Every catalogue
entry is replayed through the Go rules in a model-free Rust test.
