import { getCurrentInstance, type App } from "vue";
import { createI18n, useI18n } from "vue-i18n";
import { bindTranslator, translate, type MessageParams } from "./active";
import { isCodedError } from "./coded";
import { en } from "./en";
import { zhCN } from "./zh-CN";

export const YAGOO_LOCALES = ["en", "zh-CN"] as const;
export type YagooLocale = (typeof YAGOO_LOCALES)[number];
export const YAGOO_LOCALE_STORAGE_KEY = "yagoo.locale";

type YagooI18n = ReturnType<typeof createYagooI18n>;
const installed = new WeakMap<App, YagooI18n>();
const missingKeys = new Set<string>();

export function normalizeLocale(input: string | null | undefined): YagooLocale | null {
  if (!input) return null;
  const tag = input.trim().toLowerCase().replace(/_/g, "-");
  if (tag === "en" || tag.startsWith("en-")) return "en";
  if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
  return null;
}

export function readStoredLocale(): YagooLocale | null {
  try {
    return normalizeLocale(localStorage.getItem(YAGOO_LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeLocale(locale: YagooLocale): void {
  try {
    localStorage.setItem(YAGOO_LOCALE_STORAGE_KEY, locale);
  } catch {
    /* private mode */
  }
}

/** Stored choice, then VitePress/host locale, then navigator.language. */
export function resolveYagooLocale(options: {
  explicit?: string | null;
  host?: string | null;
  navigatorLanguage?: string | null;
} = {}): YagooLocale {
  return normalizeLocale(options.explicit)
    ?? readStoredLocale()
    ?? normalizeLocale(options.host)
    ?? normalizeLocale(options.navigatorLanguage ?? (typeof navigator === "undefined" ? null : navigator.language))
    ?? "en";
}

export function flattenMessageKeys(tree: unknown, prefix = ""): string[] {
  if (tree == null || typeof tree !== "object") return prefix ? [prefix] : [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [next] : flattenMessageKeys(value, next);
  });
}

export function consumeMissingKeys(): string[] {
  const keys = [...missingKeys];
  missingKeys.clear();
  return keys;
}

function createYagooI18n(locale: YagooLocale) {
  return createI18n({
    legacy: false,
    globalInjection: false,
    locale,
    fallbackLocale: "en",
    messages: { en, "zh-CN": zhCN },
    missing: (loc, key) => {
      missingKeys.add(`${loc}:${key}`);
      return key;
    },
    missingWarn: false,
    fallbackWarn: false,
  });
}

export function installYagooI18n(app: App, locale: YagooLocale, override = false): YagooI18n {
  const existing = installed.get(app);
  if (existing) {
    if (override) existing.global.locale.value = locale;
    return existing;
  }
  const i18n = createYagooI18n(locale);
  app.use(i18n);
  installed.set(app, i18n);
  return i18n;
}

/**
 * Composition-API i18n (`legacy: false`). Installs on the current app when the
 * host (VitePress or standalone) has not installed it yet. A later call only
 * changes locale when `explicit` is set (tests, `?lang=`, or the toolbar).
 */
export function useYagooI18n(options?: { explicit?: string | null; host?: string | null }) {
  const instance = getCurrentInstance();
  if (!instance) throw new Error("useYagooI18n() must be called in setup");
  const explicit = normalizeLocale(options?.explicit);
  const locale = explicit ?? resolveYagooLocale(options);
  installYagooI18n(instance.appContext.app, locale, explicit != null);
  const composer = useI18n({ useScope: "global", inheritLocale: true });
  bindTranslator((key, params) => composer.t(key, params ?? {}));
  return composer;
}

export type I18nPayload = { yagoo: "i18n"; key: string; params: MessageParams; fallback: string };

export function messageRef(key: string, params: MessageParams = {}, fallback?: string): string {
  const payload: I18nPayload = {
    yagoo: "i18n",
    key,
    params,
    fallback: fallback ?? translate(key, params),
  };
  return JSON.stringify(payload);
}

export function parseMessageRef(value: string): I18nPayload | null {
  if (!value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as Partial<I18nPayload>;
    if (parsed.yagoo !== "i18n" || typeof parsed.key !== "string") return null;
    return {
      yagoo: "i18n",
      key: parsed.key,
      params: parsed.params ?? {},
      fallback: typeof parsed.fallback === "string" ? parsed.fallback : parsed.key,
    };
  } catch {
    return null;
  }
}

const LEGACY_MESSAGES: Record<string, string> = {
  "Engine initialization was cancelled.": "engine.initCancelled",
  "Model download was cancelled.": "engine.downloadCancelled",
  "Model staging was cancelled.": "engine.stagingCancelled",
  "Wasm is running on one thread: cross-origin isolation and shared WebAssembly memory are required for multiple threads.": "engine.singleThread",
  "Cross-origin isolation is already active.": "engine.isolationActive",
  "This browser cannot install isolation support. Wasm will use one thread.": "engine.isolationUnsupported",
  "Isolation is still unavailable after reload. Check COOP/COEP headers; Wasm will use one thread.": "engine.isolationUnavailable",
  "Reloading once to enable shared Wasm memory.": "engine.isolationReloading",
  "A page-scoped isolation worker is still registered. Wasm stays on one thread until that worker is removed.": "engine.isolationStale",
  "Reloading to replace the page-scoped isolation worker.": "engine.isolationUpgrade",
  "Enable threads from the demo or reviewer page.": "engine.threadsScope",
  "Reviewer was closed.": "docs.closed",
  "Failed to load bundled sample SGF / NDJSON": "docs.loadFailed",
  "Provider request failed; showing deterministic templates.": "commentary.providerFailed",
  "Stored notes did not match the current approved facts.": "commentary.stale",
  "Invalid commentary provider configuration.": "commentary.invalidConfig",
  "Commentary provider request failed.": "commentary.requestFailed",
  "Commentary request cancelled.": "commentary.cancelled",
  "SGF contained no game trees": "game.noTrees",
};

const SOURCE_KEYS: Record<string, string> = {
  "bundled sample analysis": "source.bundled",
  "Browser engine (experimental)": "source.browser",
  "Local native engine": "source.native",
};

const ILLEGAL_MOVE = /^Illegal SGF move (\d+)$/;

function translated(key: string, params?: MessageParams, fallback?: string): string {
  const via = translate(key, params);
  if (via === key) return fallback ?? key;
  return via;
}

export function serializeError(error: unknown): string {
  if (isCodedError(error)) return messageRef(error.code, error.params, error.message);
  if (error instanceof Error) {
    const key = LEGACY_MESSAGES[error.message];
    return key ? messageRef(key, {}, error.message) : error.message;
  }
  return String(error ?? "");
}

/** Known source ids stay stable in state; this is the label shown in the UI. */
export function presentSource(label: string | null | undefined): string {
  if (!label) return "";
  const key = SOURCE_KEYS[label];
  return key ? translated(key, undefined, label) : label;
}

export function presentError(value: unknown): string {
  if (isCodedError(value)) return translated(value.code, value.params, value.message);
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : String(value ?? "");
  const payload = parseMessageRef(text);
  if (payload) {
    const params = { ...payload.params };
    if (typeof params.label === "string") params.label = presentSource(params.label);
    if (typeof params.message === "string") params.message = presentError(params.message);
    return translated(payload.key, params, payload.fallback);
  }
  const illegal = ILLEGAL_MOVE.exec(text);
  if (illegal?.[1]) return translated("game.illegal", { n: illegal[1] }, text);
  const legacy = LEGACY_MESSAGES[text];
  if (legacy) return translated(legacy, undefined, text);
  if (text.includes(".")) {
    const asKey = translated(text);
    if (asKey !== text) return asKey;
  }
  return text;
}

export { coded, CodedError } from "./coded";
export { translate } from "./active";
export { en } from "./en";
export { zhCN } from "./zh-CN";
