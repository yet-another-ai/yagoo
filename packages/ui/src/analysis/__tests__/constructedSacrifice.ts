/**
 * Constructed legal 5x5 rendering contract, NOT engine output or calibration.
 * Same setup as Rust sacrifice arithmetic tests; never part of the demo bundle.
 */
import type { MoveComparison, SacrificeAnnotation } from "../modules";

export const constructedSgf = "(;SZ[5]AB[bd][cd]AW[ad][be][ce][cc][dd];B[bc])";
export function constructedSacrifice(): MoveComparison {
  const board = { size: 5, black: ["B2", "C2"], white: ["A2", "B1", "C1", "C3", "D2"] };
  const referenceOwnership: number[] = Array(25).fill(0);
  const preferredOwnership: number[] = Array(25).fill(0);
  for (const index of [16, 17]) { referenceOwnership[index] = .9; preferredOwnership[index] = -.9; }
  for (const index of [0, 1, 2, 3, 5]) preferredOwnership[index] = 1;
  const actual = { move: "B3", visits: 64, winrate: .5, scoreLead: 0,
    pv: ["B3", "E1"], ownership: referenceOwnership };
  const preferred = { move: "E5", visits: 64, winrate: .6, scoreLead: 1.4,
    pv: ["E5", "B3"], ownership: preferredOwnership };
  const item: SacrificeAnnotation = {
    rootPly: 0, mover: "B", groupId: "B2", stones: ["B2", "C2"], capturedStones: ["B2", "C2"],
    preferredMove: "E5", referenceMove: "B3", ownershipFlip: 1.8,
    rootOwnership: -.9, referenceOwnership: .9, preferredOwnership: -.9, endpointOwnership: -.9,
    costBook: 3.6, compensationBook: 5, compensationPoints: null,
    exchangedWith: ["own_territory"],
    exchanges: [{ kind: "own_territory", id: null, intersections: ["A5", "B5", "C5", "D5", "A4"],
      bookValue: 5, proportion: .58, points: null }],
    pv: ["E5", "B3"],
    evidence: { rootQueryId: "constructed-root", referenceQueryId: "constructed-root",
      preferredPvQueryId: "constructed-pv", rootHash: "constructed",
      preferredVisits: 64, referenceVisits: 64, endpointVisits: 64, preferredCapturePlyOffset: 2,
      referencePv: ["B3", "E1"], scoreAdvantage: 1.4, winrateAdvantage: .1,
      endpointScoreChange: 0, endpointWinrateChange: 0 },
  };
  return {
    ply: 1, rootPly: 0, mover: "B", actualMove: "B3", aiMove: "E5",
    actualWinrate: .5, aiWinrate: .6, actualScoreLead: 0, aiScoreLead: 1.4,
    winrateLoss: .1, scoreLoss: 1.4, ownershipDelta: Array(25).fill(0), ledgerDiff: null, groupTempo: [],
    context: { rootPly: 0, mover: "B", board,
      groups: [{ groupId: "B2", kind: "simple", members: { blackStones: ["B2", "C2"], whiteStones: [], empty: [] } }],
      root: { ...preferred }, passProbe: null, passQueryId: null, actual, preferred,
      actualBranch: null, preferredBranch: null,
      preferredPvEnd: { fromMove: "E5", pv: [...preferred.pv], analysis: { ...preferred } },
      preferredPvQueryId: "constructed-pv", rootCandidates: [preferred, actual],
      pvLineages: [
        { rootPly: 0, move: "E5", pv: [...preferred.pv],
          board: { size: 5, black: ["E5"], white: [...board.white, "B3"] },
          captures: [{ color: "B", stone: "B2", plyOffset: 2 }, { color: "B", stone: "C2", plyOffset: 2 }] },
        { rootPly: 0, move: "B3", pv: [...actual.pv],
          board: { size: 5, black: [...board.black, "B3"], white: [...board.white, "E1"] }, captures: [] },
      ] },
    evidence: { rootQueryId: "constructed-root", actualQueryId: "constructed-root", actualSource: "root_candidate",
      requestedVisits: 64, minimumCandidateVisits: 16, rootVisits: 64, actualVisits: 64, aiVisits: 64,
      rootHash: "constructed", actualRootHash: "constructed", limitations: ["Constructed test, not engine evidence."] },
    sacrificeAssessment: { rootPly: 0, mover: "B", preferredMove: "E5", status: "assessed",
      annotations: [item], checks: [{ groupId: "B2", reason: "supported", referenceMove: "B3" }],
      parameters: { minimumStones: 2, minimumVisits: 16, savingOwnershipMinimum: .6,
        preferredOwnershipMaximum: -.4, endpointOwnershipMaximum: -.6, ownershipFlipMinimum: 1,
        minimumCompensationBook: .5, maximumScoreDecline: 1, maximumWinrateDecline: .02,
        maximumEndpointScoreDecline: 3, maximumEndpointWinrateDecline: .03 },
      limitations: ["Constructed UI contract only. Thresholds remain uncalibrated."] },
  };
}
