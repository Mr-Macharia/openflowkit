import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readIconLabels, readIconManifest, renderIconManifest } from '../../../scripts/gen-icon-manifest.mjs';
import { PROVIDER_ICON_LABELS, PROVIDER_ICON_MANIFEST } from './providerIconManifest';
import { hasProviderIconPack, loadProviderIconUrl } from './providerIconUrls';

describe('provider icon manifest', () => {
  it('lists exactly the SVGs on disk (after adding or removing one: node scripts/gen-icon-manifest.mjs)', () => {
    expect(renderIconManifest(PROVIDER_ICON_MANIFEST, PROVIDER_ICON_LABELS)).toBe(renderIconManifest(readIconManifest(), readIconLabels()));
  });

  it('refuses a labels.json key with no SVG behind it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
    fs.mkdirSync(path.join(dir, 'acme', 'processed', 'Core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'acme', 'processed', 'Core', 'gke.svg'), '<svg/>');
    fs.writeFileSync(path.join(dir, 'acme', 'labels.json'), JSON.stringify({ 'Core/gke': 'GKE' }));
    expect(readIconLabels(dir)).toEqual({ acme: { 'Core/gke': 'GKE' } });
    fs.writeFileSync(path.join(dir, 'acme', 'labels.json'), JSON.stringify({ 'Core/gone': 'Gone' }));
    expect(() => readIconLabels(dir)).toThrow(/no SVG for Core\/gone/);
    fs.rmSync(dir, { recursive: true });
  });

  it('every provider in it has a URL pack to load from', () => {
    for (const provider of Object.keys(PROVIDER_ICON_MANIFEST)) expect(hasProviderIconPack(provider), provider).toBe(true);
  });

  it('resolves a manifest path to its URL, and null for one it does not have', async () => {
    expect(await loadProviderIconUrl('aws', 'Compute/Lambda')).toMatch(/\S/);
    expect(await loadProviderIconUrl('aws', 'Compute/Nope')).toBeNull();
    expect(await loadProviderIconUrl('nope', 'Compute/Lambda')).toBeNull();
  });
});
