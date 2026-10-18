import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { defineAsyncComponent } from "vue";
import MermaidDiagram from "./MermaidDiagram.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MermaidDiagram", MermaidDiagram);
    // Client-only: goban / SGF stack touches DOM and must not SSR.
    app.component(
      "ReviewerDemo",
      defineAsyncComponent(() => import("../../demo/ReviewerDemo.vue")),
    );
  },
} satisfies Theme;
