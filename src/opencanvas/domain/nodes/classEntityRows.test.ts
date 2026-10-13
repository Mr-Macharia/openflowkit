import { describe, expect, it } from 'vitest';
import { createProductionSceneNode } from '../../application/active-document/productionNodeCatalog';
import { classEntityLayout, classEntityRowAt, classEntityRows } from './classEntityRows';

const classNode = createProductionSceneNode('class', 'c', { x: 0, y: 0 }, 'default', {
  classAttributes: ['+a', '+b'], classMethods: ['+run()'],
});

describe('classEntityRows', () => {
  it('lists attribute rows, an add row, then method rows in the lower half', () => {
    const rows = classEntityRows(classNode);
    expect(rows.map(({ list, index }) => `${list}:${index}`)).toEqual([
      'classAttributes:0', 'classAttributes:1', 'classAttributes:2', 'classMethods:0', 'classMethods:1',
    ]);
    expect(rows[0].bounds).toEqual({ x: 10, y: 54, width: 220, height: 18 });
    expect(rows[3].bounds.y).toBeGreaterThan(rows[2].bounds.y + 18);
  });

  it('lists entity fields with one add row and caps at the visible slots', () => {
    const entity = createProductionSceneNode('er_entity', 'e', { x: 0, y: 0 }, 'default', {
      erFields: Array.from({ length: 20 }, (_, i) => `f${i} string`),
    });
    const rows = classEntityRows(entity);
    expect(rows.every(({ list }) => list === 'erFields')).toBe(true);
    expect(rows.length).toBe(Math.floor((180 - 44 - 20) / 18));
  });

  it('hit-tests rows and returns null for the header, other kinds, and gaps', () => {
    expect(classEntityRowAt(classNode, { x: 20, y: 60 })).toMatchObject({ list: 'classAttributes', index: 0 });
    expect(classEntityRowAt(classNode, { x: 20, y: 20 })).toBeNull();
    expect(classEntityRowAt(createProductionSceneNode('process', 'p', { x: 0, y: 0 }, 'default'), { x: 20, y: 60 })).toBeNull();
  });

  // One layout for the canvas and the SVG export (U2-9: the export drew neither).
  it('lays out an entity: header, key badges, name and right-aligned type per field, then "… n more"', () => {
    const entity = createProductionSceneNode('er_entity', 'e', { x: 0, y: 0 }, 'default', {
      label: 'users', erFields: ['id: uuid PK NN', ...Array.from({ length: 20 }, (_, i) => `f${i}: text`)],
    });
    const layout = classEntityLayout(entity)!;
    expect(layout.dividers).toEqual([44]);
    expect(layout.texts.slice(0, 5).map(({ text }) => text)).toEqual(['Entity', 'users', 'PK·NN', 'id', 'uuid']);
    expect(layout.texts[4]).toMatchObject({ anchor: 'end', x: entity.size.width - 10, y: 56 });
    expect(layout.texts.at(-1)!.text).toMatch(/^… \d+ more$/);
  });

  it('badges a nullable column NULL', () => {
    const entity = createProductionSceneNode('er_entity', 'e', { x: 0, y: 0 }, 'default', {
      erFields: [{ name: 'auth_code', dataType: 'text', isNullable: true }, { name: 'id', dataType: 'uuid', isPrimaryKey: true }],
    });
    expect(classEntityLayout(entity)!.texts.filter(({ x, size }) => x === 10 && size === 9).map(({ text }) => text)).toEqual(['NULL', 'PK']);
  });

  it('lays out a class: stereotype, members either side of the compartment divider', () => {
    const layout = classEntityLayout({ ...classNode, content: { ...classNode.content, classStereotype: 'interface' } })!;
    expect(layout.dividers).toHaveLength(2);
    expect(layout.texts.map(({ text }) => text)).toEqual(['«interface»', 'Class', '+', 'a', '+', 'b', '+', 'run()']);
    expect(classEntityLayout(createProductionSceneNode('process', 'p', { x: 0, y: 0 }, 'default'))).toBeNull();
  });
});
