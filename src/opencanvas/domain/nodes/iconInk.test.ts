import { describe, expect, it } from 'vitest';
import { inkMonochromeSvg, monochromeIconInk, svgDataUrl, svgFromDataUrl } from './iconInk';
import type { NodeStyle } from './nodeStyle';

// Found 2026-10-11: on a dark canvas a Tabler or Kafka icon drew dark ink on a dark plate.
describe('one-colour icon ink', () => {
  it('redraws a dark one-colour icon in the ink: a stroke, an implicit black fill, currentColor', () => {
    const tabler = '<svg viewBox="0 0 24 24" fill="none" stroke="#334155"><path d="M1 1"/></svg>';
    expect(inkMonochromeSvg(tabler, '#ffffff')).toBe('<svg color="#ffffff" viewBox="0 0 24 24" fill="none" stroke="#ffffff"><path d="M1 1"/></svg>');
    expect(inkMonochromeSvg('<svg viewBox="0 0 9 9"><path d="M0 0"/></svg>', '#fff')).toBe('<svg fill="#fff" color="#fff" viewBox="0 0 9 9"><path d="M0 0"/></svg>');
    expect(inkMonochromeSvg('<svg><path fill="currentColor"/></svg>', '#fff')).toContain('fill="#fff"');
    expect(inkMonochromeSvg('<svg color="#333"><path fill="currentColor"/></svg>', '#fff')).toBe('<svg color="#fff"><path fill="#fff"/></svg>');
    expect(inkMonochromeSvg('<svg><style>.a{fill:#231f20}</style><path class="a"/></svg>', '#fff')).toContain('.a{fill:#fff}');
  });

  it('leaves a coloured, many-coloured or gradient icon as authored', () => {
    expect(inkMonochromeSvg('<svg><path fill="#ff9900"/></svg>', '#fff')).toBeNull();
    expect(inkMonochromeSvg('<svg><path fill="#232f3e"/><path fill="#ffffff"/></svg>', '#fff')).toBeNull();
    expect(inkMonochromeSvg('<svg><path fill="url(#g)"/></svg>', '#fff')).toBeNull();
  });

  // Found 2026-10-11: Google Blue Pub/Sub went white on a dark plate; only a colour that would vanish there is redrawn.
  it('keeps a brand colour that reads on a dark plate, redraws one that would vanish', () => {
    expect(inkMonochromeSvg('<svg><path fill="#4285F4"/></svg>', '#fff')).toBeNull();
    expect(inkMonochromeSvg('<svg><path fill="#00ADD8"/></svg>', '#fff')).toBeNull();
    expect(inkMonochromeSvg('<svg><path fill="#232f3e"/></svg>', '#fff')).toBe('<svg color="#fff"><path fill="#fff"/></svg>');
    expect(inkMonochromeSvg('<svg><path fill="#5b21b6"/></svg>', '#fff')).toBe('<svg color="#fff"><path fill="#fff"/></svg>');
  });

  it('inks only an icon plate that is dark', () => {
    const style = (fill: string, textColor = '#ffffff') => ({ fill, textColor } as NodeStyle);
    expect(monochromeIconInk('provider-icon', style('rgba(255,255,255,0.08)'), '#191b19')).toBe('#ffffff');
    expect(monochromeIconInk('provider-icon', style('#ffffff', '#0f172a'), '#191b19')).toBeNull();
    expect(monochromeIconInk('provider-icon', style('#1e293b', '#0f172a'), '#ffffff')).toBe('#ffffff');
    expect(monochromeIconInk('provider-icon', style('transparent', '#0f172a'), '#ffffff')).toBeNull();
    expect(monochromeIconInk('architecture-card', style('rgba(255,255,255,0.08)'), '#191b19')).toBeNull();
  });

  it('round-trips SVG data URLs', () => {
    expect(svgFromDataUrl(svgDataUrl('<svg a="1"/>'))).toBe('<svg a="1"/>');
    expect(svgFromDataUrl(`data:image/svg+xml;base64,${btoa('<svg/>')}`)).toBe('<svg/>');
    expect(svgFromDataUrl('data:image/png;base64,AAAA')).toBeNull();
  });
});
