import type { Family } from './types';
import type { StructuredKind } from './structuredModel';
import { parseStructured } from './structuredParse';
import { materialize } from './structuredScene';
import { structuredText } from './structuredText';

// ERD and UML class diagrams share one engine: a graph of structured entities
// (blocks of member rows) with typed relations. Only the row grammar, the
// relation vocabulary and the scene content differ (grammar §8.5, §8.6).

function familyFor(kind: StructuredKind): Family {
  return {
    name: kind === 'erd' ? 'erd' : 'class',
    async compile(segments, context) {
      return materialize(kind, parseStructured(kind, segments, context), context);
    },
    serialize: (scene) => structuredText(kind, scene),
  };
}

export const erdFamily = familyFor('erd');
export const classFamily = familyFor('class');
