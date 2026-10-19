import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitepress";

const emptyShim = fileURLToPath(
  new URL("../../packages/ui/src/shims/empty.ts", import.meta.url),
);

export default defineConfig({
  title: "Yagoo",
  description:
    "Interpret KataGo internals for practical Go review and teaching.",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Overview", link: "/" },
      { text: "Architecture", link: "/architecture" },
      { text: "Reviewer", link: "/app/" },
      { text: "Demo", link: "/demo/" },
      { text: "MVP", link: "/mvp" },
      {
        text: "GitHub",
        link: "https://github.com/yet-another-ai/yagoo",
      },
    ],
    sidebar: [
      {
        text: "Foundation",
        items: [
          { text: "Overview", link: "/" },
          { text: "Goals & non-goals", link: "/goals" },
          { text: "Glossary", link: "/glossary" },
          { text: "Data sources", link: "/data-sources" },
        ],
      },
      {
        text: "Modules",
        items: [
          { text: "Groups", link: "/modules/groups" },
          { text: "Tempo sensitivity", link: "/modules/tempo-sensitivity" },
          { text: "Score distribution", link: "/modules/score-distribution" },
          { text: "Positional zoning", link: "/modules/positional-zoning" },
          { text: "Gain / loss ledger", link: "/modules/gain-loss-ledger" },
          { text: "Concept heads", link: "/modules/concept-heads" },
          {
            text: "Explanation generation",
            link: "/modules/explanation-generation",
          },
        ],
      },
      {
        text: "Pipeline",
        items: [
          { text: "Snapshots", link: "/pipeline/snapshots" },
          { text: "Streaming events", link: "/pipeline/streaming" },
          { text: "Browser engine (EXPERIMENTAL)", link: "/browser-engine" },
        ],
      },
      {
        text: "Plan",
        items: [
          { text: "Architecture & data flow", link: "/architecture" },
          { text: "Reviewer app", link: "/app/" },
          { text: "Frontend demo", link: "/demo/" },
          { text: "MVP & validation", link: "/mvp" },
          { text: "Open questions", link: "/open-questions" },
        ],
      },
      {
        text: "Appendix",
        items: [
          { text: "Parameters", link: "/appendix/parameters" },
          { text: "Conventions", link: "/appendix/conventions" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/yet-another-ai/yagoo" },
    ],
    search: { provider: "local" },
  },
  markdown: {
    config(md) {
      const defaultFence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token !== undefined && token.info.trim() === "mermaid") {
          return `<ClientOnly><MermaidDiagram code="${encodeURIComponent(token.content)}" /></ClientOnly>\n`;
        }
        if (defaultFence !== undefined) {
          return defaultFence(tokens, idx, options, env, self);
        }
        return self.renderToken(tokens, idx, options);
      };
    },
  },
  vite: {
    resolve: {
      alias: [
        {
          find: "@yagoo/ui/styles.css",
          replacement: fileURLToPath(
            new URL("../../packages/ui/src/styles/index.css", import.meta.url),
          ),
        },
        {
          find: "@yagoo/ui/goban.css",
          replacement: fileURLToPath(
            new URL(
              "../../packages/ui/src/goban/styles/goban.css",
              import.meta.url,
            ),
          ),
        },
        {
          find: /^@yagoo\/ui$/,
          replacement: fileURLToPath(
            new URL("../../packages/ui/src/index.ts", import.meta.url),
          ),
        },
        // @sabaki/sgf browser usage: parse only (see its README).
        { find: /^fs$/, replacement: emptyShim },
        { find: "iconv-lite", replacement: emptyShim },
        { find: "jschardet", replacement: emptyShim },
      ],
    },
    ssr: {
      noExternal: ["@yagoo/ui", "@sabaki/sgf", "@sabaki/go-board", "@sabaki/immutable-gametree"],
    },
    server: {
      fs: {
        allow: ["../.."],
      },
    },
  },
});
