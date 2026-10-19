import type { BoardMap, HeatVertex, Vertex } from "../types";

/**
 * Parse a GTP coordinate (`C3`, `Q16`, `pass`) into a Shudan/SGF vertex
 * `[x, y]` with `(0,0)` at the upper-left (A19 / aa).
 */
export function parseGtpVertex(
  text: string,
  size: number,
): Vertex | null {
  const t = text.trim();
  if (!t || t.toLowerCase() === "pass") return null;
  if (t.length < 2) return null;

  const colChar = t[0]!.toUpperCase();
  if (colChar === "I") return null;
  const colCode = colChar.charCodeAt(0);
  if (colCode < 65 || colCode > 90) return null;
  let x = colCode - 65;
  if (colChar > "I") x -= 1;

  const row = Number.parseInt(t.slice(1), 10);
  if (!Number.isFinite(row) || row < 1 || row > size || x < 0 || x >= size) {
    return null;
  }
  const y = size - row;
  return [x, y];
}

export function emptyBoardMap<T>(size: number, fill: T): BoardMap<T> {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => fill),
  );
}

/**
 * Clamp ownership to the KataGo black-positive range [-1, 1].
 */
export function clampOwnership(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

/**
 * Ownership (row-major from A19, black-positive ∈ [-1, 1]) → Shudan heat map.
 *
 * Strength 1–9 scales with |ownership|. **No text labels** — candidate winrate /
 * visits belong on ghost markers, not ownership cells (Sabaki-style).
 *
 * Prefer paint-map for Sabaki-like black/white territory shading (docs reviewer).
 */
export function ownershipToHeatMap(
  ownership: number[] | null | undefined,
  size: number,
): BoardMap<HeatVertex | null> {
  const map = emptyBoardMap<HeatVertex | null>(size, null);
  if (ownership == null || ownership.length === 0) return map;
  for (let i = 0; i < ownership.length; i++) {
    const raw = ownership[i];
    if (raw == null) continue;
    const v = clampOwnership(raw);
    const abs = Math.abs(v);
    // Skip near-zero / unsettled points to avoid a muddy full-board wash.
    if (abs < 0.12) continue;
    const y = Math.floor(i / size);
    const x = i % size;
    if (y < 0 || y >= size || x < 0 || x >= size) continue;
    // Map |own| ∈ [0.12, 1] → strength 1–9. Sign is not encoded in Shudan
    // heat colors; intensity alone is the ownership heatmap.
    const strength = Math.max(
      1,
      Math.min(9, Math.round(((abs - 0.12) / 0.88) * 8) + 1),
    );
    map[y]![x] = { strength, text: null };
  }
  return map;
}

/**
 * Medium Sabaki-like paint strength: max |paint| ≈ this value so Vertex opacity
 * stays translucent (stones/grid remain visible; no opaque blocks).
 *
 * Combined with a modest floor boost below so mid-range |own| stays readable
 * (raw `|own| * 0.55` alone looked too faint on wood).
 */
export const OWNERSHIP_PAINT_STRENGTH = 0.72;

/**
 * Ownership → Sabaki paint map. Values are **signed fractions** so `Vertex`
 * sets `--shudan-paint-opacity` to `|paint|` (black / white territory shading
 * scaled by confidence). Near-zero / unsettled points are left unpainted.
 */
export function ownershipToPaintMap(
  ownership: number[] | null | undefined,
  size: number,
  threshold = 0.15,
  strength = OWNERSHIP_PAINT_STRENGTH,
): BoardMap<number> {
  const map = emptyBoardMap(size, 0);
  if (ownership == null) return map;
  for (let i = 0; i < ownership.length; i++) {
    const raw = ownership[i];
    if (raw == null) continue;
    const v = clampOwnership(raw);
    const abs = Math.abs(v);
    if (abs < threshold) continue;
    const y = Math.floor(i / size);
    const x = i % size;
    if (y < 0 || y >= size || x < 0 || x >= size) continue;
    // Boost mid-range slightly: map |own|∈[threshold,1] → [~0.35, strength].
    const t = (abs - threshold) / (1 - threshold);
    const opacity = 0.35 + t * (strength - 0.35);
    map[y]![x] = Math.sign(v) * opacity;
  }
  return map;
}
