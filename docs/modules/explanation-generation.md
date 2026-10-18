# Explanation generation

**Role.** Turn structured module outputs into short teaching text a student can trust. Facts are the source of truth; language is a presentation layer.

## Inputs

Versioned **fact JSON** from modules 4.1–4.6 — single schema. Nothing else may invent board judgments.

## Pipeline

1. **Topic selection** — pick 1–3 points by teaching priority (**initial** order):
   large mistake loss → pivotal groups (\(V_C\) high) → tempo-critical groups → positional summary
2. **Template render** — each fact class has templates, e.g.

   > “{move} is worth about {value} points: {top.points} of that comes from making {top.name} {top.change}.”

   Group display names like “lower-left Black group” / “central White dragon” are rule-generated from location + color + size.
3. **Optional LLM rewrite** — wording and order only. Input = template text + fact JSON. **Forbidden:** new judgments, numbers, or stone coordinates.
4. **Verify** — extract numbers, coordinates, and status words from the rewrite; compare to fact JSON; on mismatch **fall back** to the template.

## Output

Per position / move: explanation text + cited fact IDs (UI click → highlight group or zone).

## Known limits

- Templates sound stiff until iterated
- LLM rewrite still risks hallucination — evaluate **factual correctness** and **teaching usefulness** separately
