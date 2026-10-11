import { describe, expect, it } from 'vitest';
import { resolveDslIcon } from './iconResolver';
import { compile } from '../../dsl/compile';
import { AUTO_ICON_IDS } from '../../dsl/autoIcon';
import { GCP_PRODUCT_ICONS } from '../../dsl/gcpProducts';
import awsFixture from '../../dsl/fixtures/architecture/aws-3tier.dsl?raw';

describe('resolveDslIcon', () => {
  it('resolves provider slash and dash syntax', () => {
    const slash = resolveDslIcon('aws/lambda');
    const dash = resolveDslIcon('aws-lambda');
    expect(slash?.packId).toBe('aws-official-starter-v1');
    expect(dash).toEqual(slash);
  });

  it('returns null for unknown ids', () => {
    expect(resolveDslIcon('aws/not-a-real-service-xyz')).toBeNull();
    expect(resolveDslIcon('unknown/lambda')).toBeNull();
  });

  it('resolves bundled icons in the architecture fixture', async () => {
    const result = await compile(awsFixture, { resolveIcon: resolveDslIcon });
    // Three authored AWS icons, plus the person, which is a user-icon card.
    expect(result.nodes.filter((node) => typeof node.content.archIconShapeId === 'string')).toHaveLength(4);
    expect(result.diagnostics.filter((item) => item.code === 'W132')).toEqual([]);
  });

  // The gcp ids diagrams were written with before Google's official icons were imported (2026-10-11).
  it.each(['analytics', 'bigquery', 'cloud-composer', 'cloud-spanner', 'cloud-storage', 'colab', 'dataflow', 'dataproc', 'docs',
    'drive', 'gemini', 'google-ads', 'google-cloud', 'looker', 'maps', 'pubsub', 'sheets', 'slides'])('keeps gcp/core-%s and gcp/%s resolving', (name) => {
    expect(resolveDslIcon(`gcp/core-${name}`)?.shapeId).toBe(`core-${name}`);
    expect(resolveDslIcon(`gcp/${name}`)?.shapeId).toBe(`core-${name}`);
  });

  it('keeps the short gcp forms docs and samples use', () => {
    expect(resolveDslIcon('gcp/cloud')?.shapeId).toBe('core-google-cloud');
    expect(resolveDslIcon('gcp-pubsub')?.shapeId).toBe('core-pubsub');
    expect(resolveDslIcon('gcp:bigquery')?.shapeId).toBe('core-bigquery');
  });

  it('resolves every icon the Google Cloud product table names, and a product to its category icon', () => {
    const unresolved = GCP_PRODUCT_ICONS.map(([id]) => id!).filter((id) => resolveDslIcon(id)?.shapeId !== id.split('/')[1]);
    expect(unresolved).toEqual([]);
    expect(resolveDslIcon('gcp/cloud-functions')?.shapeId).toBe('general-serverless-computing');
    expect(resolveDslIcon('gcp/cloud-run')?.shapeId).toBe('core-cloud-run');
    expect(resolveDslIcon('gcp/compute')?.shapeId).toBe('general-compute');
  });

  it('resolves every auto-icon id to exactly that icon', () => {
    const unresolved = AUTO_ICON_IDS.filter((id) => resolveDslIcon(id)?.shapeId !== id.split('/')[1]);
    expect(unresolved).toEqual([]);
  });
});
