import type { GainLossLedger, MoveComparison, PlayedGroupTempo } from "./modules";
import type { ColorToken, GroupStatus } from "./types";
import { parseGtpVertex } from "./coords";

const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-7;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const map = (value: unknown, size: number): value is number[] => Array.isArray(value)
  && value.length === size * size && value.every((v) => Number.isFinite(v) && Math.abs(v) <= 1);
const sameStones = (a: unknown, b: unknown): a is string[] => Array.isArray(a) && Array.isArray(b)
  && a.length > 0 && a.length === b.length && new Set(a).size === a.length
  && a.every((stone) => typeof stone === "string" && b.includes(stone));

function status(plus: number, minus: number): GroupStatus {
  if (plus <= -0.8) return "dead";
  if (minus >= 0.8) return "settled";
  if (plus >= 0.4 && minus <= -0.4) return "tempo_critical";
  return "weak"; // Pass probes provide no geometric seki evidence.
}

function strengths(root: number[], pass: number[], toPlay: ColorToken, color: ColorToken, stones: string[], size: number) {
  const indices = stones.map((stone) => parseGtpVertex(stone, size));
  if (indices.some((point) => point == null)) return null;
  const mean = (values: number[]) => (color === "B" ? 1 : -1)
    * indices.reduce((sum, point) => sum + values[point![1] * size + point![0]]!, 0) / indices.length;
  return color === toPlay ? [mean(root), mean(pass)] : [mean(pass), mean(root)];
}

function validTempo(entry: PlayedGroupTempo, comparison: MoveComparison): boolean {
  if (!entry || !["B", "W"].includes(entry.color)) return false;
  const context = comparison.context;
  const size = context.board.size;
  const after = context.actualBranch;
  const group = context.groups.find((group) => group?.groupId === entry.groupId);
  const stones = entry.color === "B" ? group?.members?.blackStones : group?.members?.whiteStones;
  if (!sameStones(entry.stones, stones) || !after || after.board?.size !== size
    || after.toPlay !== (comparison.mover === "B" ? "W" : "B")
    || !id(context.passQueryId) || !id(after.rootQueryId) || !id(after.passQueryId)
    || !map(context.root?.ownership, size) || !map(context.passProbe?.ownership, size)
    || !map(after.root?.ownership, size) || !map(after.passProbe?.ownership, size)) return false;
  const beforeStrengths = strengths(context.root.ownership, context.passProbe!.ownership!, comparison.mover, entry.color, entry.stones, size);
  const afterStrengths = strengths(after.root.ownership, after.passProbe!.ownership!, after.toPlay, entry.color, entry.stones, size);
  return !!beforeStrengths && !!afterStrengths
    && close(entry.beforeGPlus, beforeStrengths[0]!) && close(entry.beforeGMinus, beforeStrengths[1]!)
    && close(entry.afterGPlus, afterStrengths[0]!) && close(entry.afterGMinus, afterStrengths[1]!)
    && entry.beforeStatus === status(beforeStrengths[0]!, beforeStrengths[1]!)
    && entry.afterStatus === status(afterStrengths[0]!, afterStrengths[1]!);
}

function validLedger(ledger: GainLossLedger, comparison: MoveComparison): boolean {
  const { context } = comparison;
  const size = context.board.size;
  const actual = context.actual.ownership;
  const recordedPass = context.passProbe?.ownership;
  const recordedPassScore = context.passProbe?.scoreLead;
  // A played pass and its reference share action identity. Validate the recorded
  // probe, but price the self-comparison from the actual candidate on both sides.
  const sameAction = comparison.actualMove.toLowerCase() === "pass";
  const pass = sameAction ? actual : recordedPass;
  const passScore = sameAction ? context.actual.scoreLead : recordedPassScore;
  const sign = comparison.mover === "B" ? 1 : -1;
  if (!ledger || !id(context.passQueryId) || !map(actual, size) || !map(pass, size)
    || !map(recordedPass, size) || !Number.isFinite(recordedPassScore)
    || !Number.isFinite(passScore) || !Number.isFinite(context.actual.scoreLead)
    || ledger.rootPly !== comparison.rootPly || ledger.mover !== comparison.mover
    || ledger.move !== comparison.actualMove || ledger.vs !== "pass" || ledger.referenceMove !== "pass"
    || !close(ledger.value, sign * (context.actual.scoreLead! - passScore!))
    || !Array.isArray(ledger.ledger) || ledger.ledger.length === 0) return false;
  const seen = new Set<number>();
  const occupied = new Set([...context.board.black, ...context.board.white].map((stone) => {
    const point = parseGtpVertex(stone, size)!;
    return point[1] * size + point[0];
  }));
  let total = 0;
  let absolute = 0;
  for (const line of ledger.ledger) {
    if (!line || !Array.isArray(line.intersections) || !line.intersections.length
      || !["group", "own_territory", "reduce_opponent", "other"].includes(line.kind)) return false;
    let book = 0;
    for (const stone of line.intersections) {
      if (typeof stone !== "string") return false;
      const point = parseGtpVertex(stone, size);
      if (!point) return false;
      const index = point[1] * size + point[0];
      if (seen.has(index)) return false;
      seen.add(index);
      if (line.kind !== "group" && line.kind !== (occupied.has(index) ? "other"
        : sign * pass[index]! >= 0 ? "own_territory" : "reduce_opponent")) return false;
      book += sign * (actual[index]! - pass[index]!);
    }
    if (!close(line.bookValue, book)) return false;
    if (line.kind === "group") {
      const group = context.groups.find((group) => group?.groupId === line.id);
      if (!id(line.id) || !group?.members || !Array.isArray(group.members.blackStones)
        || !Array.isArray(group.members.whiteStones) || !Array.isArray(group.members.empty)
        || !sameStones(line.intersections, [
        ...group.members.blackStones, ...group.members.whiteStones, ...group.members.empty,
      ])) return false;
    }
    if (line.strengthChanges != null && (!Array.isArray(line.strengthChanges)
      || !line.strengthChanges.every((change) => {
        if (!change || !["B", "W"].includes(change.color) || line.kind !== "group") return false;
        const group = context.groups.find((group) => group?.groupId === line.id)!;
        const stones = change.color === "B" ? group.members.blackStones : group.members.whiteStones;
        if (!stones.length) return false;
        const means = strengths(actual, pass, change.color, change.color, stones, size);
        return !!means && close(change.candidate, means[0]!) && close(change.reference, means[1]!)
          && close(change.delta, means[0]! - means[1]!);
      }))) return false;
    if (line.kind !== "group" && (line.id != null || line.tempo != null)) return false;
    if (line.tempoChanges != null && (!Array.isArray(line.tempoChanges) || line.tempoChanges.length > 0)) return false;
    if (line.playedTempoChanges != null && (!Array.isArray(line.playedTempoChanges)
      || !line.playedTempoChanges.every((entry) => line.kind === "group"
        && entry?.groupId === line.id && validTempo(entry, comparison)
        && comparison.playedTempo?.some((top) => top.groupId === entry.groupId && top.color === entry.color)))) return false;
    total += book;
    absolute += Math.abs(book);
  }
  const inconsistency = Math.abs(total) < 1e-6 ? "zero_book"
    : Math.abs(total - ledger.value) > 3 ? "book_search_mismatch" : undefined;
  if (seen.size !== size * size || !close(ledger.bookTotal, total)
    || ledger.consistent !== (inconsistency == null) || ledger.inconsistency !== inconsistency
    || ledger.scaling !== (inconsistency == null ? "score" : "proportions")) return false;
  return ledger.ledger.every((line) => close(line.proportion, absolute > 0 ? line.bookValue / absolute : 0)
    && (inconsistency == null ? close(line.points!, line.bookValue * ledger.value / total) : line.points === null));
}

/** New optional claims must agree with their existing historical evidence. Old recordings remain valid. */
export function validPlayedEvidence(comparison: MoveComparison): boolean {
  return (comparison.playedTempo == null || (Array.isArray(comparison.playedTempo)
    && comparison.playedTempo.every((entry) => validTempo(entry, comparison))
    && new Set(comparison.playedTempo.map((entry) => `${entry.groupId}:${entry.color}`)).size === comparison.playedTempo.length))
    && (comparison.playedLedger == null || validLedger(comparison.playedLedger, comparison));
}
