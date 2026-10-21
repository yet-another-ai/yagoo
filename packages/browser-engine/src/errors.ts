/** Framework-agnostic error: a stable key plus params. Vue translates it. */

export type ErrorParams = Record<string, string | number>;

export class CodedError extends Error {
  readonly code: string;
  readonly params: ErrorParams;

  constructor(code: string, message: string, params: ErrorParams = {}) {
    super(message);
    this.name = "CodedError";
    this.code = code;
    this.params = params;
  }
}

export function coded(code: string, message: string, params: ErrorParams = {}): CodedError {
  return new CodedError(code, message, params);
}

export function isParams(value: unknown): value is ErrorParams {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Worker/postMessage shape. `message` stays human-readable for non-Vue callers. */
export function errorFields(error: unknown): { code: string; params: ErrorParams; message: string } {
  if (error instanceof CodedError) return { code: error.code, params: error.params, message: error.message };
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  const detail = error instanceof Error ? error.message : message;
  return { code: "engine.unknown", params: { detail }, message };
}
