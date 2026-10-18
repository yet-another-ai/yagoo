import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve('onnxruntime-web'));
const ortVersion: string = JSON.parse(readFileSync(resolve(ortDist, '../package.json'), 'utf8')).version;
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  base: process.env.YAGOO_BASE ?? '/yagoo-engine/',
  worker: { format: 'es' },
  server: { headers, fs: { allow: ['../..'] } },
  preview: { headers },
  plugins: [{
    name: 'bundle-ort-runtime',
    buildStart() {
      const destination = resolve(import.meta.dirname, 'public/ort');
      mkdirSync(destination, { recursive: true });
      // Copy the exact installed build, including .mjs pthread worker entrypoints.
      for (const name of readdirSync(ortDist)) {
        if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) copyFileSync(resolve(ortDist, name), resolve(destination, name));
      }
    },
    generateBundle() {
      // The npm runtime omits its license files. Keep the notices from the same
      // upstream release beside our adapted KataGo code notice in every deploy.
      // A dependency upgrade needs matching vendored notices or this build fails.
      const notices = [
        ['KataGo-CODE-NOTICE.txt', resolve(import.meta.dirname, '../../THIRD_PARTY_NOTICES.md')],
        ['ONNX-RUNTIME-LICENSE.txt', resolve(import.meta.dirname, `licenses/onnxruntime-${ortVersion}/LICENSE`)],
        ['ONNX-RUNTIME-THIRD-PARTY-NOTICES.txt', resolve(import.meta.dirname, `licenses/onnxruntime-${ortVersion}/ThirdPartyNotices.txt`)],
      ];
      for (const [name, path] of notices) this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: readFileSync(path) });
    },
  }],
});
