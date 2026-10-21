/** Same shape as `@yagoo/browser-engine` `CodedError`, without a Vue dependency. */

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

export function isCodedError(error: unknown): error is CodedError {
  return error instanceof Error
    && typeof (error as { code?: unknown }).code === "string"
    && typeof (error as { params?: unknown }).params === "object"
    && (error as { params?: unknown }).params != null;
}
