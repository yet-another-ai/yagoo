import DefaultTheme from "vitepress/theme";
import { defineClientComponent } from "vitepress";
import type { Theme } from "vitepress";
import MermaidDiagram from "./MermaidDiagram.vue";
import "./custom.css";

const ReviewerDemo = defineClientComponent(
  () => import("../../demo/ReviewerDemo.vue"),
);
const ReviewerApp = defineClientComponent(
  () => import("../../app/ReviewerApp.vue"),
);

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MermaidDiagram", MermaidDiagram);
    // Client-only: goban / SGF / analysis stream must not SSR.
    app.component("ReviewerDemo", ReviewerDemo);
    app.component("ReviewerApp", ReviewerApp);
  },
} satisfies Theme;
