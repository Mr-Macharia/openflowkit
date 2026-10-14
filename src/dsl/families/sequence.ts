import type { Family } from './types';
import { parseSequence } from './sequenceParse';
import { materialize } from './sequenceScene';
import { sequenceText } from './sequenceText';

// The sequence family: participants, messages, activations, notes and
// control-flow fragments on a pure timeline layout. Strict line order is the
// canonical form (grammar §8.3), so serialization walks the block tree.

export const sequenceFamily: Family = {
  name: 'sequence',
  async compile(segments, context) {
    return materialize(parseSequence(segments, context), context);
  },
  serialize: sequenceText,
};
