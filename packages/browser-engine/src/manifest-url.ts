/** Remote manifest URL, only when a developer set one. Production builds leave this empty. */
export function configuredManifestUrl(): string | null {
  const value = import.meta.env?.VITE_YAGOO_MANIFEST_URL;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
