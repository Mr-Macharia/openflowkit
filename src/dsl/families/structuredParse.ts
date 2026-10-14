import type { DslDiagnostic } from '../ast';
import { readAttributes } from '../attributes';
import { tokenDiagnostic } from '../diagnostics';
import { joinTokens, type DslSegment } from '../segments';
import { slugifyDslId } from '../text';
import type { FamilyContext } from './types';
import type { DslToken } from '../tokenize';
import {
  CLASS_STEREOTYPES,
  type EntityDraft,
  type GroupDraft,
  type RelationDraft,
  type StructuredKind,
  type StructuredModel,
  canonicalRelationToken,
  cardinalityOf,
  findCardinalityAlias,
  isChainOrFan,
  isDivider,
  isRelationPiece,
  parseClassMember,
  parseErRow,
} from './structuredModel';

export function parseStructured(kind: StructuredKind, segments: readonly DslSegment[], context: FamilyContext): StructuredModel {
  const entities: EntityDraft[] = [];
  const groups: GroupDraft[] = [];
  /** The groups whose block is open, outermost first. */
  const open: GroupDraft[] = [];
  const relations: RelationDraft[] = [];
  const reserved: string[] = [];
  const dividers: Array<{ entity: string; line: number }> = [];
  const byId = new Map<string, EntityDraft>();
  const byLabel = new Map<string, EntityDraft>();
  const used = new Set<string>();
  let current: EntityDraft | null = null;

  const fail = (segment: DslSegment, code: DslDiagnostic['code'], message: string, hint?: string): void => {
    context.diagnostics.push(tokenDiagnostic(code, 'warning', segment.tokens[0], message, hint));
  };
  const declareEntity = (reference: { id?: string; label: string }, line: number) => {
    const existing = (reference.id ? byId.get(reference.id) : undefined) ?? byLabel.get(reference.label);
    if (existing) return existing;
    let id = reference.id ?? slugifyDslId(reference.label);
    const base = id;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    const entity: EntityDraft = { id, label: reference.label, line, members: [], attrs: [], comments: [], parentId: null };
    entities.push(entity);
    byId.set(id, entity);
    byLabel.set(reference.label, entity);
    return entity;
  };
  // By id, then by label — never by slug: every CJK or emoji name slugs to `n`.
  const resolve = (name: string): EntityDraft | undefined => byId.get(name) ?? byLabel.get(name);
  const fanned = (segment: DslSegment, sides: readonly (readonly DslToken[])[]): boolean => {
    if (!isChainOrFan(sides)) return false;
    fail(segment, 'W112', 'One relation per line: chains and fans are not read in this family; line dropped',
      kind === 'erd' ? 'A ||--o{ B, then B ||--o{ C' : 'A --> B, then B --> C');
    return true;
  };

  for (const segment of segments) {
    const claimed = context.comments.claim(segment.line);
    if (segment.closes) {
      if (current) current = null;
      else if (!open.pop()) fail(segment, 'W101', 'Unexpected block close; line dropped');
      continue;
    }
    if (segment.tokens[0]?.kind === 'comment' || segment.tokens.length === 0) continue;

    if (segment.opens && !current && segment.tokens[0]?.value === 'group' && segment.tokens.length > 1) {
      const parsed = readAttributes(segment.tokens.slice(1), context.diagnostics);
      const body = parsed.body.filter((token) => token.kind !== 'comment');
      const equal = body.findIndex((token) => token.value === '=');
      const label = joinTokens(equal >= 0 ? body.slice(equal + 1) : body);
      if (!label) {
        fail(segment, 'W101', 'A group needs a name', 'group Zoo {');
        continue;
      }
      let id = (equal >= 0 ? joinTokens(body.slice(0, equal)) : '') || slugifyDslId(label);
      const base = id;
      for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
      used.add(id);
      const group: GroupDraft = { id, label, parentId: open.at(-1)?.id ?? null, line: segment.line, attrs: parsed.attributes, comments: claimed };
      groups.push(group);
      open.push(group);
      continue;
    }

    if (segment.opens) {
      // `Order [interface] {` / `class Order {` / `users [blue] {`
      const tokens = segment.tokens[0]?.value === 'class' ? segment.tokens.slice(1) : segment.tokens;
      const parsed = readAttributes(tokens, context.diagnostics);
      const body = parsed.body.filter((token) => token.kind !== 'comment');
      if (body.length === 0) {
        fail(segment, 'W101', 'A block needs a name', kind === 'erd' ? 'users {' : 'Order {');
        continue;
      }
      const equal = body.findIndex((token) => token.value === '=');
      const label = joinTokens(equal >= 0 ? body.slice(equal + 1) : body, true);
      const id = equal >= 0 ? joinTokens(body.slice(0, equal)) : undefined;
      if (!label) {
        fail(segment, 'W101', 'A block needs a name', kind === 'erd' ? 'users {' : 'Order {');
        continue;
      }
      const entity = declareEntity({ ...(id ? { id } : {}), label }, segment.line);
      entity.attrs = parsed.attributes;
      entity.comments.push(...claimed);
      // Declared inside a group, it is boxed by it; declared at the top level it keeps the box it had.
      if (open.length > 0) entity.parentId = open.at(-1)!.id;
      const stereotype = parsed.attributes.find((attribute) => !attribute.key && CLASS_STEREOTYPES.has(attribute.value.toLowerCase()))?.value.toLowerCase();
      if (stereotype) entity.stereotype = stereotype;
      current = entity;
      continue;
    }

    if (kind === 'class' && isDivider(segment.tokens)) {
      if (!current) {
        fail(segment, 'W101', 'Member divider outside a class; ignored');
        continue;
      }
      current.divider = true;
      dividers.push({ entity: current.id, line: segment.line });
      continue;
    }

    const tokens = segment.tokens.filter((token) => token.kind !== 'comment');
    const alias = kind === 'erd' ? findCardinalityAlias(tokens) : null;
    if (alias) {
      if (fanned(segment, [alias.before, alias.after])) continue;
      const from = resolve(joinTokens(alias.before, true)) ?? declareEntity({ label: joinTokens(alias.before, true) }, segment.line);
      const to = resolve(joinTokens(alias.after, true)) ?? declareEntity({ label: joinTokens(alias.after, true) }, segment.line);
      relations.push({
        id: `${from.id}->${to.id}`,
        from: from.id, to: to.id, token: alias.token,
        ...(alias.label ? { label: alias.label } : {}),
        line: segment.line, attrs: [], comments: claimed,
      });
      continue;
    }
    const relationStart = tokens.findIndex(isRelationPiece);
    if (relationStart > 0 && tokens.some((token) => token.kind === 'arrow')) {
      const runStart = relationStart;
      let runEnd = relationStart;
      while (runEnd + 1 < tokens.length && isRelationPiece(tokens[runEnd + 1]!)) runEnd += 1;
      const run = joinTokens(tokens.slice(runStart, runEnd + 1)).replace(/\s+/g, '');
      const canonical = canonicalRelationToken(kind, run);
      if (!canonical) {
        fail(segment, 'W101', `Unknown ${kind === 'erd' ? 'cardinality' : 'relation'} ${run}`, kind === 'erd' ? '||--o{' : '--|>');
        continue;
      }
      const leftTokens = tokens.slice(0, runStart);
      let rightTokens = tokens.slice(runEnd + 1);
      const colon = rightTokens.findIndex((token) => token.value === ':');
      const label = colon >= 0 ? joinTokens(rightTokens.slice(colon + 1), true) : undefined;
      if (colon >= 0) rightTokens = rightTokens.slice(0, colon);
      if (fanned(segment, [leftTokens, rightTokens])) continue;
      // Multiplicity sits in quotes beside the arrow: `Order "1" --> "*" Item`.
      const leftCardinality = cardinalityOf(leftTokens, leftTokens.at(-1));
      const leftName = joinTokens(leftCardinality ? leftTokens.slice(0, -1) : leftTokens, true);
      const rightCardinality = cardinalityOf(rightTokens, rightTokens[0]);
      const rightName = joinTokens(rightCardinality ? rightTokens.slice(1) : rightTokens, true);
      // Relations auto-declare their endpoints, exactly like graph edges; a later
      // block fills in the members.
      const from = resolve(leftName) ?? declareEntity({ label: leftName }, segment.line);
      const to = resolve(rightName) ?? declareEntity({ label: rightName }, segment.line);
      const reversed = canonical.startsWith('reverse:');
      const token = reversed ? canonical.slice(8) : canonical;
      const sourceCardinality = reversed ? rightCardinality : leftCardinality;
      const targetCardinality = reversed ? leftCardinality : rightCardinality;
      relations.push({
        id: `${reversed ? to.id : from.id}->${reversed ? from.id : to.id}`,
        from: reversed ? to.id : from.id,
        to: reversed ? from.id : to.id,
        token,
        ...(label ? { label } : {}),
        ...(sourceCardinality ? { sourceCardinality } : {}),
        ...(targetCardinality ? { targetCardinality } : {}),
        line: segment.line,
        attrs: [],
        comments: claimed,
      });
      continue;
    }

    if (current) {
      const member = kind === 'erd' ? parseErRow(tokens, segment) : parseClassMember(tokens, segment);
      if (member) current.members.push(member);
      continue;
    }
    if (isDivider(segment.tokens)) {
      reserved.push(segment.raw);
      continue;
    }
    fail(segment, 'W101', `Statement outside a ${kind === 'erd' ? 'entity' : 'class'} block; dropped`, kind === 'erd' ? 'wrap rows in users { … }' : 'wrap members in Order { … }');
  }
  return { entities, groups, relations, reserved, dividers };
}

