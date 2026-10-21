# Starter opening catalogue

`openings.json`, source id `yagoo-starter-1`, is an original, manually entered
Yagoo contribution under the repository's **Apache-2.0** license (`../LICENSE`).
It contains seven short coordinate sequences and newly written descriptive
labels. It was composed directly from elementary corner coordinates and
four-corner/star-point arrangements for this implementation; it was not
downloaded, extracted, translated, or adapted from a joseki database, book,
annotated SGF collection, or engine output. There is no generated-model data.

The canonical corner is the upper left, coordinates are zero-based `[x, y]`,
and each move records its actual color. Whole-board records deliberately spell
out both players' moves: these are examples of an opening, not recognition of
every possible opposing reply or move order. Tests replay every line through
Yagoo's Go rules under all eight square symmetries and both color assignments.
The matcher generates those transformations at runtime; they are not separate
catalogue entries.

## Coverage and limits

There are three whole-board examples: parallel 4-4, diagonal 4-4, and Sanrensei.
Each has a recognition prefix followed by one author-defined sample move:

| Entry | Recognition prefix | Illustrative next move (zero-based) | Stored length |
| --- | --- | --- | --- |
| Parallel 4-4 | 4 plies | Black `[5, 2]` (`B[fc]` in SGF) | 5 plies |
| Diagonal 4-4 | 4 plies | Black `[5, 2]` (`B[fc]` in SGF) | 5 plies |
| Sanrensei | 5 plies | White `[16, 13]` (`W[qn]` in SGF) | 6 plies |

These three continuations were composed for this catalogue on 2026-10-21,
under the same Apache-2.0 license and original-source provenance above. They
make it possible to identify where play leaves a stored whole-board example.
The existing names describe the recognized prefix only. The extra moves are
legal illustrations, not prescribed continuations, evaluated recommendations,
or a claim that another move is bad. They do not enumerate all valid replies.
A fifth move forming the stored Sanrensei prefix takes precedence over the
shorter parallel 4-4 example and does not receive its deviation marker.

The four corner examples are short starts of familiar
sequences: 4-4/3-3 block-and-extend, two 4-4 low-approach replies, and 3-4
low-approach diagonal defense. The latter are **recognizable joseki starts**,
not complete balanced joseki or recommendations for the current board.

Only empty-start 19x19 games and the first 30 plies are considered. Corners use
an 8x8 window; moves elsewhere are ignored for that corner, while every move
counts for fuseki. Matching is sequence-based: arbitrary transpositions are
not accepted. A minimum prefix is required. Equal-length matches to different
lines are ambiguous and produce no label within that category. A unique fuseki
is preferred; otherwise the longest unique corner match is shown.

`deviationPly` is the original global move number of the first different move
**within the stored continuation** after recognition. A completed short line
stays recognized without labeling subsequent play a deviation. Playing outside
the corner is not a local deviation. A pass ends an unfinished corner line
without asserting a deviation. Nothing beyond the 30-ply horizon is judged.
Leaving this tiny catalogue does not imply a mistake or an inferior move.

Shared Rust/browser cases cover every completed entry, each whole-board
recognition prefix, all three whole-board deviations, and play after their
stored leaves under all sixteen symmetry/color combinations. Existing corner
ambiguity, tenuki, pass, and deviation cases retain the same expected results.

## Source review

Checked 2026-10-20:

- The repository `Cargo.toml` and `LICENSE` specify Apache-2.0, rather than MIT.
  The [Apache Software Foundation's license](https://www.apache.org/licenses/LICENSE-2.0)
  permits redistribution subject to its terms. This original catalogue uses
  that existing license; ship the repository license with distributions.
- [Kogo's official download page](https://waterfire.us/joseki.htm) was inspected.
  That page identifies contributors and provides downloads but did not establish
  an explicit redistribution license for this use. **No Kogo content was
  imported.** Availability for download is not treated as permission.
- No OGS, Sensei's Library, Waltheri, Kaya, or other AGPL/database content is
  included. This change does not assert a license for those projects' data.

Expanding the catalogue requires either additional original entries with
reviewed labels and legality tests, or a documented, verified data license
and the required attribution. Do not infer a dataset license from the license
of the software displaying it.
