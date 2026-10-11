import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../document/json';
import type { SceneNode } from '../document/types';
import { createPixiSpikePage } from '../../infrastructure/pixi/spikeFixture';
import { resolveSequenceNodePresentation } from './sequenceNodePresentation';

function node(kind: string, content: JsonObject): SceneNode {
  return { ...createPixiSpikePage(1).nodes[0], id: kind, kind, content };
}

describe('sequence node presentation', () => {
  it('preserves participant identity and resolves nested activation ranges', () => {
    expect(
      resolveSequenceNodePresentation(
        node('sequence_participant', {
          label: 'Checkout API',
          seqParticipantAlias: 'api',
          seqParticipantKind: 'actor',
          seqActivations: [
            { order: 0, activate: true },
            { order: 1, activate: true },
            { order: 2, activate: false },
            { order: 4, activate: false },
          ],
        })
      )
    ).toMatchObject({
      kind: 'sequence_participant',
      label: 'Checkout API',
      alias: 'api',
      participantKind: 'actor',
      activations: [
        { startOrder: 0, endOrder: 4 },
        { startOrder: 1, endOrder: 2 },
      ],
    });
  });

  // A laid-out bar (rows) ends where `deactivate` is written; only a bare order pair keeps the one-row minimum.
  it('ends a bar on its deactivate row, with a short minimum, when the layout gives rows', () => {
    const bars = (seqActivations: JsonObject[]) => (resolveSequenceNodePresentation(
      node('sequence_participant', { label: 'B', seqActivations })
    ) as { activations: readonly { startOrder: number; endOrder: number }[] }).activations;
    expect(bars([{ order: 0, activate: true, row: 1 }, { order: 1, activate: false, row: 1.4 }])).toEqual([{ startOrder: 1, endOrder: 1.4 }]);
    expect(bars([{ order: 0, activate: true, row: 1 }, { order: 0, activate: false, row: 1 }])[0]!.endOrder).toBeCloseTo(1 + 12 / 52);
    expect(bars([{ order: 0, activate: true }, { order: 0, activate: false }])).toEqual([{ startOrder: 0, endOrder: 1 }]);
  });

  it('preserves note placement, targets, order, and fragment context', () => {
    expect(
      resolveSequenceNodePresentation(
        node('sequence_note', {
          label: 'Retry safely',
          seqNoteTarget: 'api',
          seqNoteTargets: ['api', 'worker', 'api'],
          seqNotePosition: 'right',
          seqMessageOrder: 3.8,
          seqFragment: { type: 'alt', condition: 'failed', branchKind: 'else', edgeIds: [] },
        })
      )
    ).toMatchObject({
      kind: 'sequence_note',
      label: 'Retry safely',
      targets: ['api', 'worker'],
      position: 'right',
      order: 3,
      fragment: { type: 'alt', condition: 'failed', branchKind: 'else' },
    });
  });

  it('recognizes fragment annotations without claiming ordinary annotations', () => {
    expect(
      resolveSequenceNodePresentation(
        node('annotation', {
          label: 'ALT',
          subLabel: 'authorized',
          seqFragmentId: 'fragment-1',
          seqMessageOrder: 2,
        })
      )
    ).toMatchObject({
      kind: 'sequence_fragment',
      fragmentId: 'fragment-1',
      label: 'ALT',
      condition: 'authorized',
      order: 2,
    });
    expect(resolveSequenceNodePresentation(node('annotation', { label: 'Review' }))).toBeNull();
  });
});
