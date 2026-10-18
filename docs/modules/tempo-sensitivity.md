# Tempo sensitivity (pass probe)

**Role.** Answer “does this group need an urgent move?” without flipping labels solely because it is Black’s turn vs White’s turn.

## Inputs

- Root analysis (side \(P\) to play) and pass-probe analysis (after `pass`, \(\bar{P}\) to play)
- Group partition from the root + scenario set (computed once; the pass probe is itself one scenario)

## Computation

For the \(p\)-side portion of group \(C\):

\[
g^{p,+}_C=\begin{cases}
g^p_C(\mathrm{root}) & p=P\\
g^p_C(\mathrm{pass}) & p=\bar{P}
\end{cases}
\qquad
g^{p,-}_C=\begin{cases}
g^p_C(\mathrm{pass}) & p=P\\
g^p_C(\mathrm{root}) & p=\bar{P}
\end{cases}
\]

\[
\Delta_C^{p}=g^{p,+}_C-g^{p,-}_C
\]

Contested groups report \(\Delta\) for both colors. Usually same sign and similar magnitude → merge narratively as “race tempo gap”.

## Group status (**initial** thresholds; retune)

| Status | Condition (side \(p\)) | Teaching gloss |
| --- | --- | --- |
| **Settled** | \(g^{p,-}\ge 0.8\) | Safe even if opponent plays first |
| **Tempo-critical** | \(g^{p,+}\ge 0.4\) and \(g^{p,-}\le -0.4\) | Whoever plays first benefits — one move decides |
| **Weak** | Neither above; \(g^{p,-}<0.8\) and \(g^{p,+}> -0.8\) | Needs care; attackable |
| **Dead** | \(g^{p,+}\le -0.8\) | Even playing first cannot save |
| **Likely seki** | \(|g^{p,\pm}|<0.3\), high \(c_C\), and seki head (path B) significant on members | Seki, not “unresolved” |

Auxiliary: if \(\Delta_C^{p}\ge 0.6\), mark **unsettled** even when status is “weak”, and emphasize in explanations.

## Output

Per group: `g_plus`, `g_minus`, `delta`, `status`.

## Teaching uses

- Tempo-critical → both sides’ urgent point
- Settled → tenuki OK
- Dead → stop investing

Addresses the “label flips with side-to-move” failure mode that go-review-timelapse acknowledges on its own pages — a deliberate differentiator.

## Known limits

- Doubles Analysis Engine cost per position.
- Midgame `pass` vs training distribution: **unverified**. Validation should sample “pass probe” vs “opponent’s best local move”.
- If the previous move was already `pass`, another pass may end the game — **skip** the probe.
- Only measures a **one-move** gap. Two-move gaps / ko threats blur into “weak”.
