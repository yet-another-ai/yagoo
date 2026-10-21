// Copy ONNX Runtime wasm/mjs into a directory the site can serve with stable
// names. The engine worker resolves these through ort.env.wasm.wasmPaths.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  fileURLToPath(new URL("../packages/browser-engine/package.json", import.meta.url)),
);
const ortDist = dirname(require.resolve("onnxruntime-web"));

export const ortRuntimeNames = () =>
  readdirSync(ortDist).filter((name) => /^ort-wasm.*\.(wasm|mjs)$/.test(name));

export function stageOrtRuntime(destination) {
  mkdirSync(destination, { recursive: true });
  const names = ortRuntimeNames();
  for (const name of names) copyFileSync(join(ortDist, name), join(destination, name));
  return names;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const names = stageOrtRuntime(join(repo, "docs/public/ort"));
  if (names.length === 0) {
    console.error("No ONNX Runtime wasm/mjs assets found to stage.");
    process.exit(1);
  }
  console.log(`Staged ${names.length} ORT runtime file(s) into docs/public/ort.`);
}
