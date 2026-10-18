# Glossary

One-sentence definitions used everywhere in Yagoo docs and schemas. When a distinction matters, a second sentence follows.

| Term | Definition |
| --- | --- |
| **Point** \(i\) | One of the 361 intersections; may hold a black stone, white stone, or empty. |
| **Chain** | Maximal 4-connected set of same-color stones. A pure rules object for liberties and listing stones. **Not** used to define fate communities. |
| **Ownership** \(o_i\) | KataGo’s expected final ownership of point \(i\), in \([-1,1]\). System-wide coordinate: **black-positive** (see [conventions](./appendix/conventions.md)). |
| **ownershipStdev** \(s_i\) | Std. deviation of ownership for \(i\) across the search tree, in \([0,1]\). |
| **Side sign** \(\sigma_p\) | \(\sigma_B=+1\), \(\sigma_W=-1\). \(\sigma_p o_i\) is “how favorable point \(i\) is for side \(p\)”. |
| **Scenario** \(s\) | A hypothetical future from the current position, with ownership map \(o^{(s)}\) and weight \(w_s\). Built from top-K `movesOwnership`, PV-end positions, and the pass probe. |
| **Fate vector** \(\mathbf{d}_i\) | Ownership change of \(i\) across scenarios relative to root: \(d_i(s)=o_i^{(s)}-o_i^{\mathrm{root}}\). |
| **Stable point** | Point whose weighted fate-vector magnitude is below threshold \(\varepsilon\). Stable points are excluded from clustering. |
| **Fate community** | Set of non-stable points whose fate vectors are highly correlated — they “rise and fall together”. May mix colors and empties; parts need not be connected. **The basic unit for explaining “a group”.** |
| **Adversarial community** | Fate community containing substantial black *and* white stones (typical: capturing races / mutual attack). |
| **Connected part** | A 4-connected component of a community’s member points (empties count as members). |
| **Remote binding** | A community with ≥2 connected parts that pass the confidence check — bound by shared fate (shared cut, shared race), not by geometry rules. |
| **Strength** \(g_C^{p}\) | Mean \(\sigma_p o_i\) over \(p\)’s stones in community \(C\). |
| **Certainty** \(c_C\) | Mean of \(1-s_i\) over members of \(C\). |
| **Pass probe** | Analyze again after appending a `pass` move — equivalent to letting the opponent play first once. |
| **First-move / second-move strength** \(g^{p,+}_C,\ g^{p,-}_C\) | Strength of \(C\) for side \(p\) when \(p\) moves first vs when the opponent moves first. |
| **Tempo sensitivity** \(\Delta_C^{p}\) | \(g^{p,+}_C - g^{p,-}_C\). Large ⇒ unsettled / “one move decides”. |
| **Community status** | One of: settled / weak / tempo-critical / dead / likely seki (see tempo module). |
| **Positional zoning** | Point labels (territory / moyo / neutral / dead / community-attached) plus community labels thickness / weak. |
| **Score distribution** | Probability distribution over final black net score (incl. komi), not a single lead. |
| **Pivotal region** | Area covered by fate communities that dominate score-distribution variance. |
| **Gain / loss ledger** | Decomposition of a move’s value or mistake into own territory / reduce opponent / community life-and-death terms. |
| **Concept head** | Small supervised head on a frozen KataGo trunk predicting human concepts (group status, eyes, …). |
| **Fact JSON** | Versioned structured facts from all modules; **sole** input to explanation generation. |

## Fate community vs chain

- Chains follow geometry and color. Fate communities follow **co-variation of future ownership**.
- One dragon may be many chains in one community. Contiguous chains can split across communities under sacrifice: the sacrificed part does not share fate with the main body.
- Communities may be cross-color (adversarial) and may include empties (eye space, base).
- Yagoo does **not** use geometric liaison rules (tiger’s mouth, diagonal, one-point jump, knight’s move, …) to define or repair communities.
