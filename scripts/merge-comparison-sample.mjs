// Offline derivative only. No engine, downloads, models or generated evaluations.
import { readFile, writeFile } from "node:fs/promises";
const base = new URL("../", import.meta.url);
const snapshots = JSON.parse(await readFile(new URL(
  "packages/ui/src/analysis/__fixtures__/comparison-positions.json", base), "utf8"));
const byPly = new Map(snapshots.map((snapshot) => [snapshot.ply, snapshot]));
const events = (await readFile(new URL(
  "packages/ui/src/analysis/__fixtures__/sample-scan-deep.ndjson", base), "utf8"))
  .trim().split(/\r?\n/).map(JSON.parse);
const replaced = new Set();
for (const event of events) {
  if (event.type === "positionCompleted" && event.phase === "deep" && byPly.has(event.snapshot.ply)) {
    event.snapshot = byPly.get(event.snapshot.ply);
    replaced.add(event.snapshot.ply);
  } else if (event.type === "stageCompleted" && event.phase === "deep" && byPly.has(event.ply)) {
    const snapshot = byPly.get(event.ply);
    if (event.stage === "root") event.analysis = snapshot.root;
    if (event.stage === "pass_probe") event.analysis = snapshot.passProbe;
  } else if (event.type === "deepPliesSelected") {
    event.plies = [...new Set([...event.plies, ...byPly.keys()])].sort((a, b) => a - b);
    event.mode = "recorded_fixture_union";
  }
}
const finish = events.findIndex((event) => event.type === "gameCompleted");
if (finish < 0) throw new Error("Base replay has no completion event");
events.splice(finish, 0, ...snapshots.filter((snapshot) => !replaced.has(snapshot.ply))
  .map((snapshot) => ({ type: "positionCompleted", v: 1, phase: "deep", snapshot })));
events.splice(1, 0, {
  type: "warning", v: 1,
  message: "Recorded demo combines legacy setup-only scan/deep responses with genuine full-history 64-visit snapshots and comparisons at moves 43, 44, 50, 60 and 96. Legacy roots omit ko history and are not valid historical move comparisons. Candidate visit counts and comparison provenance are shown separately.",
});
await writeFile(new URL("docs/public/app/sample-scan-deep.ndjson", base),
  events.map((event) => JSON.stringify(event)).join("\n") + "\n");
