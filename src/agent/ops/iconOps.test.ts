import { describe, expect, it } from 'vitest';
import { findIconsFor } from './iconOps';
import type { IconMatch, OpContext } from './types';

// A catalog where every term answers several icons, as the real AWS pack does for "rds".
const CATALOG: Readonly<Record<string, readonly string[]>> = {
  kafka: ['others-kafka', 'msk'],
  sqs: ['sqs', 'sqs-queue', 'sqs-message'],
  'service bus': ['service-bus'],
  queue: ['queue'],
  rds: ['rds', 'rds-multi-az', 'rds-proxy', 'rds-writes'],
  dynamodb: ['dynamodb'],
  'sql database': ['sql-database'],
  database: ['database'],
};

const context = {
  capabilities: {
    searchIcons: async (term: string, limit: number): Promise<readonly IconMatch[]> =>
      (CATALOG[term] ?? []).slice(0, limit).map((slug) => ({ provider: 'test', slug, label: slug, category: 'test' })),
  },
} as unknown as OpContext;

const slugs = async (concept: string, limit = 4) =>
  ((await findIconsFor.run({ concept, limit }, context)).output as { matches: readonly IconMatch[] }).matches.map(({ slug }) => slug);

describe('find_icons_for', () => {
  it('puts the named product first when it is one of a concept’s terms', async () => {
    expect((await slugs('kafka'))[0]).toBe('others-kafka');
  });

  it('reads a multi-word concept by its words', async () => {
    expect(await slugs('message queue')).toContain('sqs');
  });

  it('takes one icon from each term before a second from any', async () => {
    expect(await slugs('database')).toEqual(['rds', 'dynamodb', 'sql-database', 'database']);
  });
});
