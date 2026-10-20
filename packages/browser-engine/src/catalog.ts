import { configuredManifestUrl } from './manifest-url';

/** User-facing model presets. Weights are never fetched until Load is clicked. */

export type CatalogEntry = {
  id: string;
  name: string;
  /** Official identity string when available. */
  model: string | null;
  /** Same-origin or absolute manifest URL. Null = local/custom only. */
  manifestUrl: string | null;
  /** Approximate total download (onnx + warmup) before the manifest is known. */
  approxBytes: number;
  default?: boolean;
  /** Prefer fp16 when the adapter supports it (still falls back to fp32). */
  preferFp16?: boolean;
  /** Greyed-out / not selectable yet. */
  disabled?: boolean;
  notes: string;
};

/**
 * Catalog mirrors jet/wllama's selectable list: one default ready path, others
 * disclosed as unavailable until follow-ups land. Only b18 SWA validates today.
 */
export const MODEL_CATALOG: CatalogEntry[] = [
  {
    id: 'b18c384nbt-swa',
    name: 'b18c384nbt SWA (default)',
    model: 'kata1-b18c384nbt-s9996604416-d4316597426',
    manifestUrl: configuredManifestUrl(),
    // Research / Kaya-scale fp32 onnx (~116 MiB) + small warmup/json; exact from manifest at load.
    approxBytes: 122_000_000,
    default: true,
    notes: 'Official experimental teaching net. This site does not host the weights. Load a local export (manifest.json, .onnx, warmup.json). A remote manifest is used only when VITE_YAGOO_MANIFEST_URL is set.',
  },
  {
    id: 'b18c384nbt-swa-fp16',
    name: 'b18c384nbt SWA · prefer fp16',
    model: 'kata1-b18c384nbt-s9996604416-d4316597426',
    manifestUrl: configuredManifestUrl(),
    approxBytes: 62_000_000,
    preferFp16: true,
    notes: 'Same local or configured bundle. WebGPU tries fp16 first, then retries fp32 if warmup fails (#8). The manifest must include an fp16 variant.',
  },
  {
    id: 'b10c128-mobile',
    name: 'b10c128 (mobile / CPU) — not available yet',
    model: null,
    manifestUrl: null,
    approxBytes: 0,
    disabled: true,
    notes: 'Tracked in #15. Not offered for download in this experimental build.',
  },
];

export function defaultCatalogEntry(): CatalogEntry {
  return MODEL_CATALOG.find(entry => entry.default) ?? MODEL_CATALOG[0]!;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
