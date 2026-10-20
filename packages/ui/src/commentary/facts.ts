import type {
  GainLossLedger, LlmCommentary, MoveComparison, OpeningMatch, SacrificeAnnotation,
} from "../analysis/modules";
import type { CandidateSnapshot, EngineAnalysis, GroupSnapshot, GroupStatus } from "../analysis/types";

/** Additive historical-root fields; legacy comparisons without them are omitted. */
type RootedComparison = MoveComparison & {
  rootPly?: number;
  mover?: "B" | "W";
  scoreLoss?: number;
  winrateLoss?: number;
  groupTempo?: Array<{
    groupId: string; color: "B" | "W"; stones: string[];
    actualStatus: GroupStatus; preferredStatus: GroupStatus;
  }>;
};

export interface CommentaryInput {
  ply: number;
  toPlay?: string;
  root?: EngineAnalysis | null;
  candidates?: CandidateSnapshot[];
  groups?: GroupSnapshot[];
  ledger?: GainLossLedger | null;
  comparison?: RootedComparison | null;
  sacrifices?: SacrificeAnnotation[] | null;
  opening?: OpeningMatch | null;
}

/** JSON pointers into AnalysisState; values are copied before a request starts. */
export interface FactEvidence {
  path: string;
  value: unknown;
}

export interface CommentaryTarget {
  groupId?: string;
  intersections?: string[];
}

/** UI-only generation identity. Never exported to a provider or persisted. */
export interface CommentaryOrigin {
  ply: number;
  contextKey?: string | number;
}

export interface CommentaryFact {
  id: string;
  priority: number;
  evidence: FactEvidence[];
  /** Complete approved clauses. A provider may only select a variant by index. */
  variants: string[];
  target?: CommentaryTarget;
}

export interface CommentarySentence {
  factId: string;
  variant: number;
  text: string;
}

export interface GroundedCommentary extends LlmCommentary {
  sentences: CommentarySentence[];
  /** Exact values used for each selected clause, including unrounded numbers. */
  factEvidence: Record<string, FactEvidence[]>;
  /** Present when a requested external selection was rejected or failed. */
  fallbackReason?: string;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const probability = (n: unknown): n is number => finite(n) && n >= 0 && n <= 1;
const coordinate = (s: unknown): s is string =>
  typeof s === "string" && /^(?:[A-HJ-Z](?:[1-9]|1\d|2[0-5])|pass)$/i.test(s);
const stoneCoordinate = (s: unknown): s is string => coordinate(s) && s.toLowerCase() !== "pass";
const label = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 120 && !/[\r\n\u0000-\u001f]/.test(s);
const number = (n: number) => (Object.is(n, -0) ? 0 : n).toFixed(1);
const signed = (n: number) => `${n > 0 ? "+" : ""}${number(n)}`;
const agrees = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const side = (c: string) => c === "B" ? "Black" : "White";
const statusNames: Record<string, string> = {
  settled: "settled", weak: "weak", tempo_critical: "tempo critical",
  dead: "dead", likely_seki: "likely seki",
};
const statusName = (s: unknown) =>
  typeof s === "string" && Object.hasOwn(statusNames, s) ? statusNames[s] : undefined;

/**
 * Render only source-backed assertions. No mistake labels, fate inference,
 * branch status inference, raw ownership-to-points conversion, or LLM prose.
 */
export function buildCommentaryFacts(input: CommentaryInput): CommentaryFact[] {
  if (!Number.isSafeInteger(input.ply) || input.ply < 0) return [];
  const prefix = `/plies/${input.ply}`;
  const facts: CommentaryFact[] = [];
  const evidence = (path: string, value: unknown): FactEvidence => ({
    path: `${prefix}${path}`,
    value: Array.isArray(value) ? [...value] : value,
  });
  const add = (
    id: string, priority: number, refs: FactEvidence[],
    variants: string[], target?: CommentaryTarget,
  ) => facts.push({
    id: `ply-${input.ply}/${id}`, priority,
    evidence: [evidence("/ply", input.ply), ...refs], variants, target,
  });

  const comparison = input.comparison;
  if (input.ply > 0 && comparison?.ply === input.ply &&
      comparison.rootPly === input.ply - 1 && ["B", "W"].includes(comparison.mover ?? "") &&
      coordinate(comparison.actualMove) && coordinate(comparison.aiMove)) {
    const mover = side(comparison.mover!);
    const refs = [
      evidence("/comparison/ply", comparison.ply),
      evidence("/comparison/rootPly", comparison.rootPly),
      evidence("/comparison/mover", comparison.mover),
      evidence("/comparison/actualMove", comparison.actualMove),
      evidence("/comparison/aiMove", comparison.aiMove),
    ];
    if (probability(comparison.actualWinrate) && probability(comparison.aiWinrate)) {
      add("comparison-winrate", 100, [
        ...refs,
        evidence("/comparison/actualWinrate", comparison.actualWinrate),
        evidence("/comparison/aiWinrate", comparison.aiWinrate),
      ], [
        `At root ply ${comparison.rootPly}, the comparison reports ${number(comparison.actualWinrate * 100)}% winrate for ${comparison.actualMove} and ${number(comparison.aiWinrate * 100)}% for ${comparison.aiMove}, from ${mover}'s perspective.`,
        `For ${mover} at root ply ${comparison.rootPly}, the reported winrates are ${comparison.actualMove}: ${number(comparison.actualWinrate * 100)}%; ${comparison.aiMove}: ${number(comparison.aiWinrate * 100)}%.`,
      ]);
      if (finite(comparison.winrateLoss) &&
          agrees(comparison.winrateLoss, comparison.aiWinrate - comparison.actualWinrate)) {
        add("comparison-winrate-loss", 101, [
          ...refs, evidence("/comparison/actualWinrate", comparison.actualWinrate),
          evidence("/comparison/aiWinrate", comparison.aiWinrate),
          evidence("/comparison/winrateLoss", comparison.winrateLoss),
        ], [
          `For move ${comparison.ply}, ${mover}'s reported winrate difference (preferred ${comparison.aiMove} minus played ${comparison.actualMove}) is ${signed(comparison.winrateLoss * 100)} percentage points at root ply ${comparison.rootPly}.`,
        ]);
      }
    }
    if (finite(comparison.actualScoreLead) && finite(comparison.aiScoreLead)) {
      add("comparison-score", 85, [
        ...refs,
        evidence("/comparison/actualScoreLead", comparison.actualScoreLead),
        evidence("/comparison/aiScoreLead", comparison.aiScoreLead),
      ], [
        `The comparison's Black-positive score leads are ${signed(comparison.actualScoreLead)} points for ${comparison.actualMove} and ${signed(comparison.aiScoreLead)} points for ${comparison.aiMove}.`,
      ]);
      const expectedLoss = (comparison.aiScoreLead - comparison.actualScoreLead) *
        (comparison.mover === "B" ? 1 : -1);
      if (finite(comparison.scoreLoss) && agrees(comparison.scoreLoss, expectedLoss)) {
        add("comparison-score-loss", 110, [
          ...refs, evidence("/comparison/actualScoreLead", comparison.actualScoreLead),
          evidence("/comparison/aiScoreLead", comparison.aiScoreLead),
          evidence("/comparison/scoreLoss", comparison.scoreLoss),
        ], [
          `For move ${comparison.ply}, the score difference (preferred ${comparison.aiMove} minus played ${comparison.actualMove}) is ${signed(comparison.scoreLoss)} points from ${mover}'s perspective at root ply ${comparison.rootPly}.`,
        ]);
      }
    }
    if (comparison.ledgerDiff?.move === comparison.actualMove &&
        comparison.ledgerDiff.referenceMove === comparison.aiMove &&
        comparison.ledgerDiff.vs === "best") {
      addLedger(comparison.ledgerDiff, "/comparison/ledgerDiff", "comparison-ledger",
        comparison.rootPly, comparison.mover, refs);
    }
    for (const [i, tempo] of (comparison.groupTempo ?? []).entries()) {
      if (!stoneCoordinate(tempo.groupId) || !["B", "W"].includes(tempo.color) ||
          !statusName(tempo.actualStatus) || !statusName(tempo.preferredStatus)) continue;
      const path = `/comparison/groupTempo/${i}`;
      add(`comparison-tempo-${i}`, 95, [
        ...refs, evidence(`${path}/groupId`, tempo.groupId),
        evidence(`${path}/color`, tempo.color), evidence(`${path}/stones`, tempo.stones),
        evidence(`${path}/actualStatus`, tempo.actualStatus),
        evidence(`${path}/preferredStatus`, tempo.preferredStatus),
      ], [
        `For root-ply-${comparison.rootPly} ${side(tempo.color)} group ${tempo.groupId}, the branch probes classify the ${comparison.actualMove} line as ${statusNames[tempo.actualStatus]} and the ${comparison.aiMove} line as ${statusNames[tempo.preferredStatus]}.`,
      ], { groupId: tempo.groupId, intersections: tempo.stones.filter(stoneCoordinate) });
    }
  }

  function addLedger(
    ledger: GainLossLedger | null | undefined, path: string, id: string,
    rootPly: number, mover?: string, contextRefs: FactEvidence[] = [],
  ) {
    if (ledger?.rootPly === rootPly &&
        ["B", "W"].includes(ledger.mover) &&
        (mover == null || ledger.mover === mover) &&
        coordinate(ledger.move) && coordinate(ledger.referenceMove) &&
        ["pass", "best"].includes(ledger.vs) && finite(ledger.value)) {
      const refs = [
        ...contextRefs,
        evidence(`${path}/rootPly`, ledger.rootPly),
        evidence(`${path}/mover`, ledger.mover),
        evidence(`${path}/move`, ledger.move),
        evidence(`${path}/referenceMove`, ledger.referenceMove),
        evidence(`${path}/vs`, ledger.vs),
      ];
      add(`${id}-search`, 90, [...refs, evidence(`${path}/value`, ledger.value)], [
        `At root ply ${ledger.rootPly}, ${ledger.move} has a search score difference of ${signed(ledger.value)} points versus ${ledger.referenceMove}, from ${side(ledger.mover)}'s perspective.`,
        `The search comparison at ply ${ledger.rootPly} is ${ledger.move} versus ${ledger.referenceMove}: ${signed(ledger.value)} points from ${side(ledger.mover)}'s perspective.`,
      ]);
      const priced = ledger.consistent === true && ledger.scaling === "score";
      const scalingRefs = [
        evidence(`${path}/consistent`, ledger.consistent),
        evidence(`${path}/scaling`, ledger.scaling),
      ];
      if (!priced) {
        add(`${id}-unpriced`, id === "comparison-ledger" ? 99 : 89, [...refs, ...scalingRefs], [
          `The ownership attribution for ${ledger.move} versus ${ledger.referenceMove} at root ply ${ledger.rootPly} is unpriced; its line shares are not point values.`,
        ]);
      }
      for (const [i, line] of ledger.ledger.entries()) {
        const kindNames: Record<string, string> = {
          own_territory: "Own territory", reduce_opponent: "Opponent territory reduction",
          other: "Other intersections",
        };
        const name = line.kind === "group" && stoneCoordinate(line.id)
          ? `Group ${line.id}` : Object.hasOwn(kindNames, line.kind) ? kindNames[line.kind] : undefined;
        if (!name) continue;
        const linePrefix = `${path}/ledger/${i}`;
        const lineRefs = [
          ...refs, ...scalingRefs, evidence(`${linePrefix}/kind`, line.kind),
          ...(line.id ? [evidence(`${linePrefix}/id`, line.id)] : []),
        ];
        const intersections = line.intersections?.filter(stoneCoordinate) ?? [];
        const target = { groupId: line.kind === "group" ? line.id : undefined, intersections };
        if (priced && finite(line.points)) {
          add(`${id}-line-${i}`, 70 + Math.min(10, Math.abs(line.points)), [
            ...lineRefs, evidence(`${linePrefix}/points`, line.points),
            evidence(`${linePrefix}/intersections`, line.intersections),
          ], [
            `${name} is attributed ${signed(line.points)} points for ${ledger.move} versus ${ledger.referenceMove}, from ${side(ledger.mover)}'s perspective.`,
          ], target);
        } else if (finite(line.proportion) && Math.abs(line.proportion) <= 1) {
          add(`${id}-line-${i}`, 60 + Math.abs(line.proportion) * 10, [
            ...lineRefs, evidence(`${linePrefix}/proportion`, line.proportion),
            evidence(`${linePrefix}/intersections`, line.intersections),
          ], [
            `${name} has a signed share of ${signed(line.proportion * 100)}% of total absolute ownership-book contribution for ${ledger.move} versus ${ledger.referenceMove}; this is unpriced.`,
          ], target);
        }
      }
    }
  }
  addLedger(input.ledger, "/ledger", "ledger", input.ply, input.toPlay);

  for (const [i, group] of (input.groups ?? []).entries()) {
    const status = statusName(group.status);
    if (!stoneCoordinate(group.groupId) || !status) continue;
    add(`group-${i}-status`, group.status === "tempo_critical" ? 88 : 55, [
      evidence(`/groups/${i}/groupId`, group.groupId),
      evidence(`/groups/${i}/status`, group.status),
    ], [
      `At ply ${input.ply}, the group module classifies group ${group.groupId} as ${status}.`,
      `Group ${group.groupId} is classified as ${status} by the group module at ply ${input.ply}.`,
    ], { groupId: group.groupId });
  }

  for (const [i, sacrifice] of (input.sacrifices ?? []).entries()) {
    if (!stoneCoordinate(sacrifice.groupId) || !finite(sacrifice.ownershipFlip)) continue;
    add(`sacrifice-${i}`, 75, [
      evidence(`/sacrifices/${i}/groupId`, sacrifice.groupId),
      evidence(`/sacrifices/${i}/ownershipFlip`, sacrifice.ownershipFlip),
    ], [
      `The sacrifice module reports group ${sacrifice.groupId} with an ownership flip of ${number(sacrifice.ownershipFlip)}.`,
    ], { groupId: sacrifice.groupId });
  }

  if (finite(input.root?.scoreLead)) {
    add("root-score", 40, [evidence("/root/scoreLead", input.root.scoreLead)], [
      `At ply ${input.ply}, the engine's Black-positive score lead is ${signed(input.root.scoreLead)} points.`,
    ]);
  }
  for (const [i, candidate] of (input.candidates ?? []).entries()) {
    if (!coordinate(candidate.move) || !Number.isSafeInteger(candidate.visits) || candidate.visits! < 0) continue;
    add(`candidate-${i}`, 30 - i, [
      evidence(`/candidates/${i}/move`, candidate.move),
      evidence(`/candidates/${i}/visits`, candidate.visits),
    ], [`Candidate ${candidate.move} has ${candidate.visits} visits in the reported search.`]);
  }
  if (label(input.opening?.name)) {
    const opening = input.opening!;
    add("opening", 20, [
      { path: "/opening/name", value: opening.name },
      { path: "/opening/source", value: opening.source },
    ], [`The opening catalogue label is “${opening.name}”.`]);
  }
  return facts.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function renderCommentary(
  facts: readonly CommentaryFact[],
  selections = facts.slice(0, 3).map((f) => ({ factId: f.id, variant: 0 })),
  provider = "templates",
  verified = false,
  fallbackReason?: string,
): GroundedCommentary {
  const sentences = selections.map(({ factId, variant }) => ({
    factId, variant, text: facts.find((f) => f.id === factId)!.variants[variant]!,
  }));
  return {
    text: sentences.map((s) => s.text).join(" "),
    citedFactIds: sentences.map((s) => s.factId),
    provider, verified, sentences,
    factEvidence: Object.fromEntries(sentences.map((s) => [
      s.factId, structuredClone(facts.find((f) => f.id === s.factId)!.evidence),
    ])),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

/**
 * Revalidate persisted notes against the current registry before report/export.
 * A stored `verified` flag is not evidence. Re-render exact approved clauses and
 * reject changed source values, even when rounded displayed values are equal.
 */
export function resolveCommentary(
  facts: readonly CommentaryFact[], stored: unknown,
): GroundedCommentary {
  const fallback = () => renderCommentary(
    facts, undefined, "templates", false,
    "Stored notes did not match the current approved facts.",
  );
  if (stored == null) return renderCommentary(facts);
  try {
    if (typeof stored !== "object" || Array.isArray(stored)) return fallback();
    const value = stored as Partial<GroundedCommentary>;
    if (!Array.isArray(value.sentences) || value.sentences.length < 1 ||
        value.sentences.length > 3 || !Array.isArray(value.citedFactIds) ||
        !value.factEvidence || typeof value.factEvidence !== "object" ||
        typeof value.verified !== "boolean") return fallback();
    const seen = new Set<string>();
    for (const sentence of value.sentences) {
      const fact = facts.find((f) => f.id === sentence?.factId);
      if (!fact || !Number.isInteger(sentence.variant) || sentence.variant < 0 ||
          sentence.variant >= fact.variants.length || seen.has(fact.id) ||
          sentence.text !== fact.variants[sentence.variant] ||
          JSON.stringify(value.factEvidence[fact.id]) !== JSON.stringify(fact.evidence)) return fallback();
      seen.add(fact.id);
    }
    if (JSON.stringify(value.citedFactIds) !== JSON.stringify(value.sentences.map((s) => s.factId)) ||
        Object.keys(value.factEvidence).length !== seen.size ||
        value.text !== value.sentences.map((s) => s.text).join(" ")) return fallback();
    return renderCommentary(
      facts, value.sentences, label(value.provider) ? value.provider : "stored selection",
      value.verified,
    );
  } catch {
    return fallback();
  }
}
