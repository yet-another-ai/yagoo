import { defineConfig } from "vitepress";

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
        text: "Plan",
        items: [
          { text: "Architecture & data flow", link: "/architecture" },
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
});
