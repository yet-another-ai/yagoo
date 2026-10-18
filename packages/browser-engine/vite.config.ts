import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ortDist = dirname(require.resolve('onnxruntime-web'));
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
  }],
});
