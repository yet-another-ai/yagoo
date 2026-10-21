import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import snapshotsJson from "../../analysis/__fixtures__/comparison-positions.json";
import type { PipelineEvent, PositionSnapshot } from "../../analysis/types";
import ReviewReport from "../../reviewer/ReviewReport.vue";
import { reviewPipelineEvents } from "../build";
import { escapeMarkdown, exportReviewHtml, exportReviewMarkdown } from "../export";

const snapshots = snapshotsJson as unknown as PositionSnapshot[];
function genuineReport(ply = 60) {
  const events: PipelineEvent[] = [
    { type: "gameStarted", v: 1, size: 19, komi: 0.5, moveCount: 100, positionCount: 101, strategy: "scan_then_deep" },
    { type: "positionCompleted", v: 1, phase: "deep", snapshot: snapshots.find((item) => item.ply === ply)! },
    { type: "gameCompleted", v: 1 },
  ];
  return reviewPipelineEvents(events);
}

describe("visible report evidence", () => {
  it("shows genuine group and branch tempo facts without opening the source appendix", () => {
    const wrapper = mount(ReviewReport, { props: { report: genuineReport() } });
    const source = wrapper.findAll("details").find((details) =>
      details.get("summary").text() === "Source facts and comparison limits")!;
    expect(source.attributes("open")).toBeUndefined();

    const group = wrapper.get('[data-report-evidence="group_tradeoffs"]');
    expect(group.get("h4").text()).toBe("Group and territory trade-offs");
    const groupFact = group.get('[data-report-fact="ply-60/comparison-ledger-line-0"]');
    expect(groupFact.get("p").text()).toBe(
      "Group M4 is attributed -1.8 points for S3 versus H3, from White's perspective.");
    expect(groupFact.get("p").element.closest("details")).toBeNull();
    expect(groupFact.get("details").attributes("open")).toBeUndefined();
    expect(groupFact.findAll("code").map((code) => code.text())).toContain(
      "/plies/60/comparison/ledgerDiff/ledger/0/points = -1.8162430067156092");

    const tempo = wrapper.get('[data-report-evidence="tempo_changes"]');
    expect(tempo.get("h4").text()).toBe("Group tempo comparison");
    const tempoFact = tempo.get('[data-report-fact="ply-60/comparison-tempo-0"]');
    expect(tempoFact.get("p").text()).toBe(
      "For root-ply-59 White group L2, the branch probes classify the S3 line as weak and the H3 line as weak.");
    expect(tempoFact.get("p").element.closest("details")).toBeNull();
    expect(tempoFact.findAll("code").map((code) => code.text())).toEqual(expect.arrayContaining([
      '/plies/60/comparison/groupTempo/0/actualStatus = "weak"',
      '/plies/60/comparison/groupTempo/0/preferredStatus = "weak"',
    ]));
    expect(wrapper.get('[data-report-evidence="sacrifices"] > p').text()).toBe(
      "No supported sacrifice candidate was reported for the assessed groups.");
    wrapper.unmount();
  });

  it.each([
    [60, "No supported sacrifice candidate was reported for the assessed groups."],
    [50, "Sacrifice assessment is unassessed."],
  ] as const)("keeps move %i evidence and assessment status aligned across UI and exports", (ply, status) => {
    const report = genuineReport(ply);
    const wrapper = mount(ReviewReport, { props: { report } });
    const markdown = exportReviewMarkdown(report);
    const html = new DOMParser().parseFromString(exportReviewHtml(report), "text/html");
    const sections = html.querySelectorAll(`#move-${ply} > .report-evidence-section`);
    expect(sections).toHaveLength(3);
    expect(wrapper.get('[data-report-evidence="sacrifices"] > p').text()).toBe(status);
    expect(sections[2]!.textContent).toContain(status);
    expect(markdown).toContain(escapeMarkdown(status));
    for (const [index, section] of report.moves[0]!.evidenceSections.entries()) {
      const rendered = sections[index]!;
      expect(rendered.querySelector("h3")!.textContent).toBe(section.title);
      expect(markdown).toContain(`#### ${escapeMarkdown(section.title)}`);
      for (const fact of section.facts) {
        const sentence = [...rendered.querySelectorAll("li > p")].find((node) => node.textContent === fact.variants[0]);
        expect(sentence).toBeDefined();
        expect(sentence!.closest("details")).toBeNull();
        expect(markdown).toContain(`- ${escapeMarkdown(fact.variants[0]!)}`);
        for (const evidence of fact.evidence) {
          const exact = `${evidence.path} = ${JSON.stringify(evidence.value)}`;
          expect(rendered.querySelector("ul")!.textContent).toContain(exact);
          expect(markdown).toContain(`${escapeMarkdown(evidence.path)} = ${escapeMarkdown(JSON.stringify(evidence.value))}`);
        }
      }
    }
    wrapper.unmount();
  });

  it("keeps additional source facts accessible and escapes section payloads as text", () => {
    const report = genuineReport();
    // Constructed presentation-boundary strings; these are not engine evidence.
    const attack = '<img src=x onerror="alert(1)"> [click](javascript:alert(1)) <script>alert(1)</script>';
    const row = report.moves[0]!;
    const section = row.evidenceSections[0]!;
    section.title = attack;
    section.facts = [{ ...section.facts[0]!, variants: [attack], evidence: [{ path: attack, value: attack }] }];
    section.omittedFacts = 2;
    row.evidenceSections[2]!.emptyMessage = attack;
    row.facts.push({ id: "constructed-omitted-source-fact", priority: 0, variants: ["Additional source detail"], evidence: [] });

    const wrapper = mount(ReviewReport, { props: { report } });
    const visible = wrapper.get('[data-report-evidence="group_tradeoffs"]');
    expect(visible.get("h4").text()).toBe(attack);
    expect(visible.get("li > p").text()).toBe(attack);
    expect(visible.get("code").text()).toBe(`${attack} = ${JSON.stringify(attack)}`);
    expect(visible.get(".yagoo-report__omitted").text()).toContain("2 additional facts are available in Source facts");
    expect(wrapper.findAll("img,script")).toHaveLength(0);
    const source = wrapper.findAll("details").find((details) =>
      details.get("summary").text() === "Source facts and comparison limits")!;
    expect(source.text()).toContain("Additional source detail");

    const html = new DOMParser().parseFromString(exportReviewHtml(report), "text/html");
    expect(html.querySelectorAll("script,img,iframe,object")).toHaveLength(0);
    expect(html.querySelector(".report-evidence-section h3")!.textContent).toBe(attack);
    expect(html.querySelector(".report-evidence-section")!.textContent).toContain("2 additional facts are available in Source facts below.");
    expect(html.body.textContent).toContain("Additional source detail");
    const markdown = exportReviewMarkdown(report);
    expect(markdown).toContain(escapeMarkdown(attack));
    expect(markdown).toContain("2 additional facts are available in Source facts below");
    expect(markdown).toContain("Additional source detail");
    expect(markdown).not.toMatch(/(?<!\\)<(?:img|script)/);
    expect(markdown).not.toContain("[click](javascript:");
    wrapper.unmount();
  });
});
