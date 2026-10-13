import { afterEach, describe, expect, it, vi } from 'vitest';
import { SVG_BACKGROUND } from './canonicalSvg';
import { buildPrintDocument, printSvgDocument } from './print';

describe('print document', () => {
  it('puts each page on its own sheet', () => {
    const html = buildPrintDocument(['<svg data-page="a"></svg>', '<svg data-page="b"></svg>'], 'Talk');
    expect(html.match(/<section class="sheet">/g)).toHaveLength(2);
    expect(html).toContain('break-after: page');
    expect(html.indexOf(encodeURIComponent('data-page="a"'))).toBeLessThan(html.indexOf(encodeURIComponent('data-page="b"')));
  });

  it('keeps each page\'s ids to itself: a duplicated page must not clip with the first page\'s outline', () => {
    const page = '<svg xmlns="http://www.w3.org/2000/svg"><clipPath id="clip-a"><rect/></clipPath><g clip-path="url(#clip-a)"/></svg>';
    const html = buildPrintDocument([page, page], 'Talk');
    // Each sheet is its own image document, so `#clip-a` resolves inside it only.
    expect(html).not.toContain('id="clip-a"');
    expect(html.match(/<img [^>]*src="data:image\/svg\+xml/g)).toHaveLength(2);
  });

  it('breaks after every sheet but the last', () => {
    expect(buildPrintDocument(['<svg></svg>'], 'T')).toContain('.sheet:last-of-type { break-after: auto; }');
  });

  it('paints the sheet in the export theme, and keeps it when printing', () => {
    expect(buildPrintDocument(['<svg></svg>'], 'T', { theme: 'dark' })).toContain(`background: ${SVG_BACKGROUND.dark}`);
    expect(buildPrintDocument(['<svg></svg>'], 'T')).toContain(`background: ${SVG_BACKGROUND.light}`);
    expect(buildPrintDocument(['<svg></svg>'], 'T')).toContain('print-color-adjust: exact');
  });

  it('escapes the title', () => {
    expect(buildPrintDocument(['<svg></svg>'], '<b>&')).toContain('<title>&lt;b&gt;&amp;</title>');
  });

  it('carries no script (the CSP forbids inline ones)', () => {
    expect(buildPrintDocument(['<svg></svg>'], 'T')).not.toMatch(/<script/i);
  });
});

describe('printSvgDocument', () => {
  afterEach(() => { document.querySelectorAll('iframe').forEach((frame) => frame.remove()); });

  it('prints the frame from the parent once it has loaded, and not before', async () => {
    printSvgDocument(['<svg></svg>'], 'T');
    const frame = document.querySelector('iframe')!;
    const print = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { focus: vi.fn(), print } });
    Object.defineProperty(frame, 'contentDocument', { value: { fonts: { ready: Promise.resolve() } } });
    expect(print).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
  });
});
