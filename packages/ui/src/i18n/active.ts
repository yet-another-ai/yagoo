import { effectScope, ref, watch, type WatchSource } from "vue";
import { en } from "./en";

export type MessageParams = Record<string, unknown>;

/**
 * Incremented when the bound locale changes. `translate()` reads it so Vue
 * computeds and renders that call the module helper refresh immediately,
 * including when the active translator itself does not touch a Vue ref.
 */
const localeRevision = ref(0);
let localeScope = effectScope(true);

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
  void localeRevision.value;
  return active(key, params);
}

export function bindTranslator(
  fn: (key: string, params?: MessageParams) => string,
  locale?: WatchSource<string>,
): void {
  active = fn;
  localeScope.stop();
  localeScope = effectScope(true);
  if (locale != null) {
    localeScope.run(() => {
      watch(locale, () => {
        localeRevision.value += 1;
      });
    });
  }
}

export function resetTranslator(): void {
  active = fallback;
  localeScope.stop();
  localeScope = effectScope(true);
}
