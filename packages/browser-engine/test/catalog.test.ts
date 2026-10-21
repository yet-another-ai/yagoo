import { expect, it } from 'vitest';
import { MODEL_CATALOG, defaultCatalogEntry, formatBytes } from '../src/catalog';

it('lists b18 as the default selectable model and keeps mobile disabled', () => {
  const defaults = MODEL_CATALOG.filter(entry => entry.default);
  expect(defaults).toHaveLength(1);
  expect(defaultCatalogEntry().id).toBe('b18c384nbt-swa');
  expect(defaultCatalogEntry().manifestUrl).toBeNull();
  expect(MODEL_CATALOG.some(entry => entry.id === 'b10c128-mobile' && entry.disabled)).toBe(true);
  expect(formatBytes(122_000_000)).toMatch(/MiB/);
});
