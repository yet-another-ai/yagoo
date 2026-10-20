// Copy the experimental engine onto the VitePress artifact and fail if the
// production /yagoo/ base is missing from docs, fixtures, or engine assets.
import { cp, readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const site = join(repo, "docs/.vitepress/dist");
const engineDist = join(repo, "packages/browser-engine/dist");
const engineOut = join(site, "engine");

await cp(engineDist, engineOut, { recursive: true });

const failures = [];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function oneOf(label, paths) {
  for (const path of paths) {
    if (await exists(join(site, path))) return path;
  }
  failures.push(`${label}: none of ${paths.join(", ")}`);
  return null;
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

await oneOf("home", ["index.html"]);
await oneOf("reviewer", ["app/index.html", "app.html"]);
await oneOf("sample sgf", ["app/sample.sgf"]);
await oneOf("sample ndjson", ["app/sample-scan-deep.ndjson"]);
await oneOf("browser-engine page", ["browser-engine.html", "browser-engine/index.html"]);
await oneOf("demo", ["demo/index.html", "demo.html"]);
await oneOf("engine shell", ["engine/index.html"]);
await oneOf("isolation worker", ["engine/coi-serviceworker.js"]);

const siteFiles = await walk(site);
const wasm = siteFiles.filter((path) => path.startsWith(`${engineOut}/`) && path.endsWith(".wasm"));
if (wasm.length === 0) failures.push("engine wasm: no .wasm file under engine/");

const home = await readFile(join(site, "index.html"), "utf8");
if (!home.includes("/yagoo/")) failures.push("index.html does not reference /yagoo/");

const engineHome = await readFile(join(site, "engine/index.html"), "utf8");
if (!engineHome.includes("/yagoo/engine/")) {
  failures.push("engine/index.html does not reference /yagoo/engine/");
}

for (const path of siteFiles) {
  if (!path.endsWith(".js") && !path.endsWith(".html") && !path.endsWith(".css")) continue;
  const text = await readFile(path, "utf8");
  const rel = relative(site, path);
  if (rel.startsWith("engine/") && text.includes("/yagoo-engine/")) {
    failures.push(`${rel} still references /yagoo-engine/`);
  }
  if (text.includes('"/app/sample.sgf"') || text.includes("'/app/sample.sgf'")) {
    failures.push(`${rel} fetches /app/sample.sgf without the /yagoo/ base`);
  }
  if (text.includes('"/app/sample-scan-deep.ndjson"') || text.includes("'/app/sample-scan-deep.ndjson'")) {
    failures.push(`${rel} fetches /app/sample-scan-deep.ndjson without the /yagoo/ base`);
  }
}

const reviewerJs = siteFiles.filter((path) => path.endsWith(".js"));
const fixtureFetches = [];
for (const path of reviewerJs) {
  const text = await readFile(path, "utf8");
  const inlined =
    text.includes('"/yagoo/"') &&
    /fetch\(\s*`\$\{[A-Za-z_$][\w$]*\}app\/sample\.sgf`/.test(text) &&
    /fetch\(\s*`\$\{[A-Za-z_$][\w$]*\}app\/sample-scan-deep\.ndjson`/.test(text);
  const literal =
    (text.includes('"/yagoo/app/sample.sgf"') || text.includes("'/yagoo/app/sample.sgf'")) &&
    (text.includes('"/yagoo/app/sample-scan-deep.ndjson"') ||
      text.includes("'/yagoo/app/sample-scan-deep.ndjson'"));
  if (inlined || literal) fixtureFetches.push(relative(site, path));
}
if (fixtureFetches.length === 0) {
  failures.push("no built script fetches the sample SGF and NDJSON under /yagoo/");
}

if (failures.length > 0) {
  console.error("Pages assembly failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Pages site assembled at ${site} (${wasm.length} wasm file(s) under engine/).`);
