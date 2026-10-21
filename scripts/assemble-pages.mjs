// Fail the Pages build if the production /yagoo/ site is missing the demo
// engine wiring: fixtures, redirect, scoped isolation worker, or ORT wasm.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const site = join(repo, "docs/.vitepress/dist");
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
await oneOf("browser-engine docs", ["browser-engine.html", "browser-engine/index.html"]);
await oneOf("demo", ["demo/index.html", "demo.html"]);
await oneOf("engine redirect", ["engine/index.html"]);
await oneOf("isolation worker", ["coi-serviceworker.js"]);

const siteFiles = await walk(site);
const ortWasm = siteFiles.filter((path) => path.split(sep).includes("ort") && path.endsWith(".wasm"));
const bundledWasm = siteFiles.filter((path) => path.split(sep).includes("assets") && path.endsWith(".wasm"));
if (ortWasm.length === 0) failures.push("no ORT .wasm under ort/");
if (bundledWasm.length === 0) failures.push("no bundled engine .wasm under assets/");

const home = await readFile(join(site, "index.html"), "utf8");
if (!home.includes("/yagoo/")) failures.push("index.html does not reference /yagoo/");

const redirect = await readFile(join(site, "engine/index.html"), "utf8");
if (!redirect.includes("/yagoo/demo/")) failures.push("engine/index.html does not redirect to /yagoo/demo/");
if (redirect.includes("id=\"model-island\"")) failures.push("engine/index.html is still the standalone engine UI");

for (const path of siteFiles) {
  if (!path.endsWith(".js") && !path.endsWith(".html") && !path.endsWith(".css")) continue;
  const text = await readFile(path, "utf8");
  const rel = relative(site, path);
  if (text.includes('"/app/sample.sgf"') || text.includes("'/app/sample.sgf'")) {
    failures.push(`${rel} fetches /app/sample.sgf without the /yagoo/ base`);
  }
  if (text.includes('"/app/sample-scan-deep.ndjson"') || text.includes("'/app/sample-scan-deep.ndjson'")) {
    failures.push(`${rel} fetches /app/sample-scan-deep.ndjson without the /yagoo/ base`);
  }
  if (rel.endsWith(".js") && /fetch\(\s*["'`]models\/manifest\.json["'`]/.test(text)) {
    failures.push(`${rel} fetches models/manifest.json`);
  }
}

const reviewerJs = siteFiles.filter((path) => path.endsWith(".js"));
let fixtureFetch = false;
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
  if (inlined || literal) fixtureFetch = true;
}
if (!fixtureFetch) failures.push("no built script fetches the sample SGF and NDJSON under /yagoo/");

const workerFiles = siteFiles.filter((path) => /[/\\]engine\.worker-[^/\\]+\.js$/.test(path));
if (workerFiles.length !== 1) failures.push(`expected one engine worker bundle, found ${workerFiles.length}`);
const workerText = workerFiles.length === 1 ? await readFile(workerFiles[0], "utf8") : "";
for (const name of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  if (!workerText.includes(name)) failures.push(`engine worker does not reference ${name}`);
  if (!(await exists(join(site, "ort", name)))) failures.push(`missing ort/${name}, which the engine worker requests`);
}
for (const match of workerText.matchAll(/\/yagoo\/assets\/(ort[^"'`\s)]+\.(?:mjs|wasm))/g)) {
  if (!(await exists(join(site, "assets", match[1])))) {
    failures.push(`engine worker requests /yagoo/assets/${match[1]}, which was not emitted`);
  }
}

const swPath = join(site, "coi-serviceworker.js");
if (await exists(swPath)) {
  const sw = await readFile(swPath, "utf8");
  const swChecks = [
    ["Cross-Origin-Embedder-Policy", sw.includes("Cross-Origin-Embedder-Policy")],
    ["engine worker", sw.includes("engine\\.worker") || sw.includes("engine.worker")],
    ["demo", sw.includes("demo")],
    ["app", sw.includes("app")],
  ];
  for (const [label, ok] of swChecks) {
    if (!ok) failures.push(`coi-serviceworker.js does not mention ${label}`);
  }
}
let rootRegistration = false;
for (const path of reviewerJs) {
  const text = await readFile(path, "utf8");
  const rel = relative(site, path);
  if (text.includes("demo/coi-serviceworker.js") || text.includes("app/coi-serviceworker.js")) {
    failures.push(`${rel} still registers a page-scoped isolation worker`);
  }
  if (text.includes("coi-serviceworker.js") && text.includes('"/yagoo/"')) rootRegistration = true;
}
if (!rootRegistration) failures.push("no built script registers coi-serviceworker.js at /yagoo/");

if (failures.length > 0) {
  console.error("Pages assembly failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Pages site checked at ${site} (${ortWasm.length} ORT wasm, ${bundledWasm.length} bundled wasm).`);
