import { en } from "./en";

export type MessageParams = Record<string, unknown>;

function lookup(tree: unknown, key: string): string | undefined {
  let current: unknown = tree;
  for (const part of key.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function interpolate(message: string, params: MessageParams = {}): string {
  return message.replace(/\{(\w+)\}/g, (_, name: string) => (
    params[name] == null ? "" : String(params[name])
  ));
}

const fallback = (key: string, params?: MessageParams): string => {
  const message = lookup(en, key);
  return message == null ? key : interpolate(message, params);
};

let active = fallback;

export function translate(key: string, params?: MessageParams): string {
  return active(key, params);
}

export function bindTranslator(fn: (key: string, params?: MessageParams) => string): void {
  active = fn;
}

export function resetTranslator(): void {
  active = fallback;
}
