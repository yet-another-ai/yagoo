# Glossary

One-sentence definitions used everywhere in Yagoo docs and schemas. When a distinction matters, a second sentence follows.

Chinese originals from the concept design are noted where helpful.

| Term | Definition |
| --- | --- |
| **Point** \(i\) | One of the board intersections; may hold a black stone, white stone, or empty. |
| **Chain** (串) | Maximal set of **orthogonally** (4-connected) same-color stones. A pure rules object for liberties and listing stones. **Not** used to define teaching groups. In casual English “group” sometimes means chain — **not here**. |
| **Ownership** \(o_i\) | KataGo’s expected final ownership of point \(i\), in \([-1,1]\). System-wide coordinate: **black-positive** (see [conventions](./appendix/conventions.md)). |
| **ownershipStdev** \(s_i\) | Std. deviation of ownership for \(i\) across the search tree, in \([0,1]\). |
| **Side sign** \(\sigma_p\) | \(\sigma_B=+1\), \(\sigma_W=-1\). \(\sigma_p o_i\) is “how favorable point \(i\) is for side \(p\)”. |
| **Scenario** \(s\) | A hypothetical future from the current position, with ownership map \(o^{(s)}\) and weight \(w_s\). Built from top-K `movesOwnership`, PV-end positions, and the pass probe. |
| **Fate vector** \(\mathbf{d}_i\) | Ownership change of \(i\) across scenarios relative to root: \(d_i(s)=o_i^{(s)}-o_i^{\mathrm{root}}\). (Name kept; this is the clustering feature, not a teaching unit.) |
| **Stable point** | Point whose weighted fate-vector magnitude is below threshold \(\varepsilon\). Stable points are excluded from clustering. |
| **Group** (块) | Set of non-stable points whose fate vectors are highly correlated — they “rise and fall together”. May mix colors and empties; parts need not be geometrically connected. **The basic teaching unit** formerly called “fate community”. |
| **Simple group** | A group that is one connected part and mostly one color (`kind: "simple"`). |
| **Contested group** | Group containing substantial black *and* white stones — typically a capturing race / mutual attack. Also called a **semeai group**. (`kind: "contested"`) |
| **Bound group** | A group with ≥2 connected parts that pass the remote-binding confidence check (`kind: "bound"`). |
| **Connected part** | A 4-connected component of a group’s member points (empties count as members). |
| **Remote binding** | Shared fate across disconnected parts of one group (shared cut, shared race), established statistically — not by geometry rules. |
| **Strength** \(g_C^{p}\) | Mean \(\sigma_p o_i\) over \(p\)’s stones in group \(C\). |
| **Certainty** \(c_C\) | Mean of \(1-s_i\) over members of \(C\). |
| **Pass probe** | Analyze again after appending a `pass` move — equivalent to letting the opponent play first once. |
| **First-move / second-move strength** \(g^{p,+}_C,\ g^{p,-}_C\) | Strength of \(C\) for side \(p\) when \(p\) moves first vs when the opponent moves first. |
| **Tempo sensitivity** \(\Delta_C^{p}\) | \(g^{p,+}_C - g^{p,-}_C\). Large ⇒ unsettled / “one move decides”. |
| **Group status** | One of: settled / weak / tempo-critical / dead / likely seki (see tempo module). |
| **Positional zoning** | Point labels (territory / moyo / neutral / dead / group-attached) plus group labels thickness / weak. |
| **Score distribution** | Probability distribution over final black net score (incl. komi), not a single lead. |
| **Pivotal region** | Area covered by groups that dominate score-distribution variance. |
| **Gain / loss ledger** | Decomposition of a move’s value or mistake into own territory / reduce opponent / group life-and-death terms. |
| **Concept head** | Small supervised head on a frozen KataGo trunk predicting human concepts (group status, eyes, …). |
| **Fact JSON** | Versioned structured facts from all modules; **sole** input to explanation generation. |

## Group vs chain

| | **Chain** (串) | **Group** (块) |
| --- | --- | --- |
| Defined by | Geometry + color (orthogonal connectivity) | Co-variation of future ownership across scenarios |
| May mix colors? | No | Yes (contested / semeai groups) |
| May include empties? | No | Yes (eye space, base) |
| Used for | Liberties, captures, rules | Teaching explanations |

- One dragon may be many chains in one group. Contiguous chains can split across groups under sacrifice: the sacrificed part does not share fate with the main body.
- Yagoo does **not** use geometric liaison rules (tiger’s mouth, diagonal, one-point jump, knight’s move, …) to define or repair groups.
- Clustering order is fixed: **correlation first**, then connectivity analysis **inside** each group. No geometric fallback.
