# Open questions

Maintainer decisions needed. Design defaults are noted where they exist.

## 1. Geometry in zoning heuristics?

Fate communities deliberately forbid geometric liaison rules. Moyo / thickness heuristics currently use distance ≤ 4–5. Is that an acceptable exception, or should thickness/moyo be redefined from pure fate signals (e.g. opponent invasion candidates’ `movesOwnership`)?

## 2. Weak remote bindings — hide or show?

Low-confidence “weak binding” parts: hide from teaching text, or surface as “possibly related”?

## 3. Score MC mean shift?

Should community Monte Carlo shift its mean onto `scoreLead` (shape-only comparison), or also show the raw mean bias?

## 4. Ledger in the first validation spike?

High teaching value, but competes with time validating fate communities. Include in the first spike or defer?

## 5. Network lock — confirmed

**Decided after the design draft:** start with `kata1-b18c384nbt-s9996604416-d4316597426` (SWA). Larger nets later. Concept heads bind to this choice. Listed here so it stays visible next to other product locks.

## 6. Validation bar

How many raters, what ranks, how the ~20-game corpus is composed, and whether the § decision-gate score of 3.5 is the ship line.

## 7. Frontend packaging

**Decided direction:** WebGPU web app, not Electron. Still open: hosting model (static + WASM?, local helper for KataGo process?), and how tightly the Rust core is shipped to end users vs a local daemon.

## 8. Pass midgame OOD?

Whether inserting `pass` midgame leaves the training distribution: **unverified**. Needs a validation study before relying on status labels in production copy.
