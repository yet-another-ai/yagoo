export { buildCommentaryFacts, renderCommentary, resolveCommentary } from "./facts";
export type {
  CommentaryInput, CommentaryFact, FactEvidence, CommentarySentence,
  CommentaryTarget, CommentaryOrigin, GroundedCommentary,
} from "./facts";
export { CommentarySession, verifyCommentarySelection } from "./session";
export type {
  CommentaryProvider, CommentaryRequest, CommentarySessionState,
} from "./session";
