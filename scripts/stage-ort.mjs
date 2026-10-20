// Copy ONNX Runtime wasm/mjs into the docs site. GitHub Pages cannot set
// wasmPaths headers, and the demo loads these from /yagoo/ort/.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  fileURLToPath(new URL("../packages/browser-engine/package.json", import.meta.url)),
);
const ortDist = dirname(require.resolve("onnxruntime-web"));
const repo = fileURLToPath(new URL("..", import.meta.url));
const destination = join(repo, "docs/public/ort");
mkdirSync(destination, { recursive: true });
let copied = 0;
for (const name of readdirSync(ortDist)) {
  if (!/^ort-wasm.*\.(wasm|mjs)$/.test(name)) continue;
  copyFileSync(join(ortDist, name), join(destination, name));
  copied += 1;
}
if (copied === 0) {
  console.error("No ONNX Runtime wasm/mjs assets found to stage.");
  process.exit(1);
}
console.log(`Staged ${copied} ORT runtime file(s) into docs/public/ort.`);
