import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import AnalysisReviewer from "../../layout/AnalysisReviewer.vue";
import CandidatesPanel from "../../layout/CandidatesPanel.vue";
import EngineSourcePanel from "../../reviewer/EngineSourcePanel.vue";
import { coded } from "../coded";
import {
  consumeMissingKeys,
  flattenMessageKeys,
  presentError,
  resolveYagooLocale,
  storeLocale,
  useYagooI18n,
  YAGOO_LOCALE_STORAGE_KEY,
} from "../index";
import { en } from "../en";
import { zhCN } from "../zh-CN";

const SAMPLE = "(;FF[4]GM[1]SZ[19]RU[chinese]PB[Black]PW[White])";

describe("message catalogs", () => {
  it("uses the same key set in English and Simplified Chinese", () => {
    const english = flattenMessageKeys(en).sort();
    const chinese = flattenMessageKeys(zhCN).sort();
    expect(chinese).toEqual(english);
    expect(english.length).toBeGreaterThan(100);
  });

  it("follows navigator.language, then a stored choice", () => {
    expect(resolveYagooLocale({ navigatorLanguage: "zh-Hans-CN" })).toBe("zh-CN");
    expect(resolveYagooLocale({ navigatorLanguage: "fr-FR" })).toBe("en");
    storeLocale("zh-CN");
    expect(resolveYagooLocale({ navigatorLanguage: "en-US" })).toBe("zh-CN");
    expect(resolveYagooLocale({ explicit: "en", navigatorLanguage: "zh-CN" })).toBe("en");
    expect(localStorage.getItem(YAGOO_LOCALE_STORAGE_KEY)).toBe("zh-CN");
  });

  it("translates stable engine error codes and keeps the English fallback", () => {
    const stored = presentError(coded(
      "engine.nativeLocalhost",
      "Native engine URL must use HTTP(S) on localhost.",
    ));
    expect(stored).toContain("localhost");
  });
});

const LocaleHost = defineComponent({
  components: { EngineSourcePanel, CandidatesPanel },
  props: { locale: { type: String, required: true } },
  setup(props) {
    useYagooI18n({ explicit: props.locale });
    return {
      candidates: [
        { move: "Q16", order: 0, visits: 400, winrate: 0.51 },
        { move: "D4", order: 1, visits: 2, winrate: 0.9 },
      ],
    };
  },
  template: `
    <div>
      <EngineSourcePanel
        :native-available="true"
        :browser-available="false"
        source-label="bundled sample analysis"
        thread-hint="engine.singleThread"
        model-status="engine.isolationActive"
      />
      <CandidatesPanel :root-visits="500" :candidates="candidates" />
    </div>
  `,
});

describe("message compilation", () => {
  it("compiles every catalog message in both locales", () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      fallbackLocale: "en",
      messages: { en, "zh-CN": zhCN },
      missingWarn: false,
      fallbackWarn: false,
    });
    for (const locale of ["en", "zh-CN"] as const) {
      i18n.global.locale.value = locale;
      for (const key of flattenMessageKeys(en)) {
        const message = key.split(".").reduce<unknown>((node, part) => (
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined
        ), locale === "en" ? en : zhCN);
        const params: Record<string, string> = {};
        if (typeof message === "string") {
          for (const name of message.matchAll(/\{(\w+)\}/g)) params[name[1]!] = "1";
        }
        expect(() => i18n.global.t(key, params), `${locale}:${key}`).not.toThrow();
      }
    }
    i18n.global.locale.value = "en";
    expect(i18n.global.t("phase.active", { phase: "scan", ply: 0, count: 4 })).toBe(
      "scan @ ply 0 (4 events)",
    );
  });
});

describe("reviewer locales", () => {
  it.each(["en", "zh-CN"] as const)("renders the reviewer and engine panel in %s without missing keys", async (locale) => {
    consumeMissingKeys();
    const reviewer = mount(AnalysisReviewer, {
      props: { initialSgf: SAMPLE, locale },
    });
    const host = mount(LocaleHost, { props: { locale } });
    await nextTick();
    expect(consumeMissingKeys()).toEqual([]);
    if (locale === "en") {
      expect(reviewer.text()).toContain("Review");
      expect(reviewer.text()).toContain("Opening");
      expect(reviewer.get('[data-testid="locale-toggle"]').text()).toBe("中文");
      expect(host.text()).toContain("Load local model");
      expect(host.text()).toContain("bundled sample analysis");
      expect(host.text()).toContain("Wasm is running on one thread");
      expect(host.text()).toMatch(/1 low-visit move hidden/);
    } else {
      expect(reviewer.text()).toContain("复盘");
      expect(reviewer.text()).toContain("布局");
      expect(reviewer.get('[data-testid="locale-toggle"]').text()).toBe("EN");
      expect(host.text()).toContain("载入本地模型");
      expect(host.text()).toContain("内置示例分析");
      expect(host.text()).toContain("单线程");
      expect(host.text()).toContain("候选点");
      expect(host.text()).not.toContain("Candidates");
    }
    reviewer.unmount();
    host.unmount();
  });

  it("persists the toolbar language choice", async () => {
    const reviewer = mount(AnalysisReviewer, { props: { initialSgf: SAMPLE, locale: "en" } });
    await reviewer.get('[data-testid="locale-toggle"]').trigger("click");
    expect(reviewer.text()).toContain("复盘");
    expect(localStorage.getItem(YAGOO_LOCALE_STORAGE_KEY)).toBe("zh-CN");
    reviewer.unmount();
  });

  it("retranslates analysis comments and variation labels when the locale changes", async () => {
    const ndjson = JSON.stringify({
      type: "positionCompleted",
      v: 1,
      phase: "scan",
      snapshot: {
        schemaVersion: 1,
        ply: 0,
        toPlay: "B",
        ownershipConvention: "black_positive",
        board: { size: 19, black: [], white: [] },
        chains: [],
        root: { scoreLead: 1, visits: 100, winrate: 0.6 },
        candidates: [{ move: "D4", visits: 80, order: 0 }],
      },
    });
    const reviewer = mount(AnalysisReviewer, {
      props: {
        initialSgf: "(;FF[4]GM[1]SZ[19];B[])",
        initialNdjson: ndjson,
        locale: "en",
        vertexSize: 16,
      },
    });
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
      await flushPromises();
    }
    expect(reviewer.text()).toContain("Black WR");
    expect(reviewer.text()).toContain("B pass");
    reviewer.get("[title='D4 · order 0']");
    await reviewer.get('[data-testid="locale-toggle"]').trigger("click");
    await nextTick();
    expect(reviewer.text()).toContain("黑胜率");
    expect(reviewer.text()).toContain("B 停着");
    expect(reviewer.text()).not.toContain("Black WR");
    expect(reviewer.text()).not.toContain("B pass");
    reviewer.get("[title='D4 · 顺序 0']");
    reviewer.unmount();
  });
});
