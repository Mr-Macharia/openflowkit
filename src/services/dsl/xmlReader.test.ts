import { describe, expect, it } from 'vitest';
import { decodeEntities, parseXml } from './xmlReader';

describe('parseXml', () => {
  it('reads nested elements, attributes and text', () => {
    const parsed = parseXml('<?xml version="1.0"?><!-- note --><a x="1" y=\'two\'><b/><c>hi &amp; bye</c></a>');
    expect(parsed).toEqual({
      root: {
        name: 'a', attributes: { x: '1', y: 'two' }, text: '',
        children: [
          { name: 'b', attributes: {}, children: [], text: '' },
          { name: 'c', attributes: {}, children: [], text: 'hi & bye' },
        ],
      },
    });
  });

  it('keeps a > inside a quoted attribute and decodes entities in it', () => {
    const parsed = parseXml('<cell value="a &gt; b" style="x>y"/>');
    expect(parsed).toMatchObject({ root: { attributes: { value: 'a > b', style: 'x>y' } } });
  });

  it('reads CDATA as text', () => {
    expect(parseXml('<a><![CDATA[<raw>]]></a>')).toMatchObject({ root: { text: '<raw>' } });
  });

  it('says what is wrong with broken XML', () => {
    expect(parseXml('<a><b></a>')).toEqual({ error: '</a> closes nothing open' });
    expect(parseXml('<a>')).toEqual({ error: '<a> is never closed' });
    expect(parseXml('<a x="1"')).toEqual({ error: 'A tag is never closed' });
    expect(parseXml('just text')).toEqual({ error: 'There is no XML element in it' });
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities and leaves unknown ones', () => {
    expect(decodeEntities('&lt;br&gt;&#10;&#x41;&nbsp;&bogus;')).toBe('<br>\nA\u00a0&bogus;');
  });
});
