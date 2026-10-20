import type { ReviewReportDocument } from "./types";

export type ReviewExportFormat = "markdown" | "html";
export interface ReviewExportFile { filename: string; mimeType: string; contents: string }

/** Escape all ASCII punctuation, including autolinks and raw HTML, as plain text. */
export function escapeMarkdown(value: string): string {
  return [...value.replace(/[\r\n\u0000-\u001f]/g, " ")].map((char) => {
    const n = char.charCodeAt(0);
    return ((n >= 33 && n <= 47) || (n >= 58 && n <= 64) ||
      (n >= 91 && n <= 96) || (n >= 123 && n <= 126)) ? `\\${char}` : char;
  }).join("");
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const reportNumber = (value: number) => Number.isFinite(value) ? value.toFixed(2) : "unavailable";
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0 ? String(value) : "0";
const plies = (values: number[]) => values.length ? values.join(", ") : "none";

function coverageLines(report: ReviewReportDocument): string[] {
  const c = report.coverage;
  return [
    `Report: ${report.status}; analysis stream: ${report.streamStatus}.`,
    `Completed positions: ${c.completedPositionPlies.length}/${c.moveCount + 1}.`,
    `Compared played moves: ${c.comparedMovePlies.length}/${c.moveCount}.`,
    `Missing positions: ${plies(c.missingPositionPlies)}.`,
    `Missing played-move comparisons: ${plies(c.missingComparisonPlies)}.`,
    `Positive score differences among compared moves: ${report.overview.positiveScoreDifferences}.`,
    `Moves matching the preferred move: ${report.overview.matchesPreferred}.`,
    `Sum of positive score differences on compared moves only: Black ${reportNumber(report.overview.blackPositiveScoreLoss)}, White ${reportNumber(report.overview.whitePositiveScoreLoss)} points. This is not a full-game rating.`,
  ];
}

export function exportReviewMarkdown(report: ReviewReportDocument): string {
  const m = escapeMarkdown;
  const lines = ["# Yagoo game review", "", `Source: ${m(report.source)}`, ""];
  for (const entry of report.metadata) lines.push(`- ${m(entry.label)}: ${m(entry.value)}`);
  lines.push("", "## Coverage and overview", "", ...coverageLines(report).map(m), "");
  if (report.opening) {
    lines.push(`Catalogue opening: ${m(report.opening.name)}; source: ${m(report.opening.source)}.`, "");
  }
  lines.push("## Ranked compared moves", "",
    "Ranking uses signed score loss, then signed winrate loss, then move number. Loss is preferred minus actual from the mover's perspective. Equality and negative estimates are retained.", "");
  for (const row of report.moves) {
    lines.push(`### ${integer(row.rank)}. Move ${integer(row.ply)}: ${m(row.mover)} ${m(row.actualMove)}`, "",
      `Root ${integer(row.rootPly)}; preferred ${m(row.aiMove)}; score loss ${reportNumber(row.scoreLoss)} points; winrate loss ${reportNumber(row.winrateLoss * 100)} percentage points.`,
      "", `Categories: ${row.categories.map(m).join(", ") || "none"}.`, "",
      m(row.explanation.text), "");
    for (const recommendation of row.recommendations) {
      lines.push(`- ${m(recommendation.text)} Facts: ${recommendation.factIds.map(m).join(", ")}.`);
    }
    lines.push(...row.missingEvidence.map((line) => `- ${m(line)}`));
    lines.push("", "Evidence:", "");
    for (const fact of row.facts) {
      lines.push(`- ${m(fact.id)}: ${m(fact.variants[0] ?? "")}`);
      for (const evidence of fact.evidence) {
        lines.push(`  - ${m(evidence.path)} = ${m(JSON.stringify(evidence.value) ?? "null")}`);
      }
    }
    lines.push("");
  }
  if (!report.moves.length) lines.push("No validated played-move comparisons are available.", "");
  lines.push("## Unassessed scan leads", "", m(`Plies: ${plies(report.unassessedPlies)}. These are analysis priorities, not mistake labels.`),
    "", "## Limits and provenance", "", ...report.warnings.map((w) => `- ${m(w)}`), "");
  return lines.join("\n");
}

/** Self-contained, script-free HTML. No untrusted markup, URLs, or styles. */
export function exportReviewHtml(report: ReviewReportDocument): string {
  const h = escapeHtml;
  const list = (items: string[]) => `<ul>${items.map((s) => `<li>${h(s)}</li>`).join("")}</ul>`;
  const rows = report.moves.map((row) => `<article id="move-${integer(row.ply)}">
<h2>${integer(row.rank)}. Move ${integer(row.ply)}: ${h(row.mover)} ${h(row.actualMove)}</h2>
<p>Root ${integer(row.rootPly)}; preferred ${h(row.aiMove)}; score loss ${reportNumber(row.scoreLoss)} points; winrate loss ${reportNumber(row.winrateLoss * 100)} percentage points.</p>
<p>Categories: ${h(row.categories.join(", ") || "none")}.</p>
<p>${h(row.explanation.text)}</p>
${list(row.recommendations.map((r) => `${r.text} Facts: ${r.factIds.join(", ")}.`))}
${list(row.missingEvidence)}
<details><summary>Source facts</summary>${row.facts.map((f) =>
  `<h3>${h(f.id)}</h3><p>${h(f.variants[0] ?? "")}</p>${list(f.evidence.map((e) => `${e.path} = ${JSON.stringify(e.value) ?? "null"}`))}`).join("")}</details>
</article>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yagoo game review</title><style>
body{font:16px/1.55 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#17212b;background:#fafafa}h1,h2,h3{line-height:1.2}article{background:white;border:1px solid #ccd2d8;padding:1.2rem;margin:1rem 0;border-radius:8px}li{overflow-wrap:anywhere}nav a{margin-right:1rem;color:#075b9c}details{font-size:.9rem}dt{font-weight:600}dd{margin:0 0 .5rem} @media print{body{background:white}article{break-inside:avoid}}
</style></head><body><h1>Yagoo game review</h1><p>Source: ${h(report.source)}</p>
<dl>${report.metadata.map((e) => `<dt>${h(e.label)}</dt><dd>${h(e.value)}</dd>`).join("")}</dl>
<h2>Coverage and overview</h2>${list(coverageLines(report))}
${report.opening ? `<p>Catalogue opening: ${h(report.opening.name)}; source: ${h(report.opening.source)}.</p>` : ""}
<h2>Ranked compared moves</h2>
<p>Ranking uses signed score loss, then signed winrate loss, then move number. Loss is preferred minus actual from the mover's perspective. Equality and negative estimates are retained.</p>
<nav aria-label="Compared moves">${report.moves.map((m) => `<a href="#move-${integer(m.ply)}">Move ${integer(m.ply)}</a>`).join("")}</nav>
${rows || "<p>No validated played-move comparisons are available.</p>"}
<h2>Unassessed scan leads</h2><p>${h(`Plies: ${plies(report.unassessedPlies)}. These are analysis priorities, not mistake labels.`)}</p>
<h2>Limits and provenance</h2>${list(report.warnings)}</body></html>`;
}

export function renderReviewExport(report: ReviewReportDocument, format: ReviewExportFormat): ReviewExportFile {
  return format === "html"
    ? { filename: "yagoo-review.html", mimeType: "text/html;charset=utf-8", contents: exportReviewHtml(report) }
    : { filename: "yagoo-review.md", mimeType: "text/markdown;charset=utf-8", contents: exportReviewMarkdown(report) };
}

/** Latest-request-wins export. Cancellation/source changes suppress stale downloads. */
export class ReviewExportSession {
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(
    private readonly deliver: (file: ReviewExportFile) => void,
    private readonly render = async (report: ReviewReportDocument, format: ReviewExportFormat, _signal: AbortSignal) =>
      renderReviewExport(report, format),
  ) {}
  cancel() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }
  async export(report: ReviewReportDocument, format: ReviewExportFormat): Promise<boolean> {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const file = await this.render(report, format, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return false;
      this.deliver(file);
      return true;
    } finally {
      if (generation === this.generation) this.controller = null;
    }
  }
}

export function downloadReviewFile(file: ReviewExportFile): void {
  const url = URL.createObjectURL(new Blob([file.contents], { type: file.mimeType }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
