import { contrastRatio, getContrastText, normalizeHex } from '../../../lib/colorUtils';
import type { NodeStyle } from './nodeStyle';

// Every paint an SVG names, as an attribute (`fill="#333"`) or in CSS (`fill:#333`).
// ponytail: one dark plate stands in for every dark plate (the dark canvas; a dark fill is about as dark) —
// pass the real plate in if a mid-grey plate ever keeps a colour it shouldn't.
const DARK_PLATE = '#191b19';
/** WCAG's 3:1 for graphics: a colour at least this far from the plate still reads as the brand drew it. */
const READS_ON_PLATE = 3;
const PAINT = /\b(fill|stroke|stop-color|color)(\s*=\s*["']|\s*:\s*)([^"';}\s>]+)/gi;

/**
 * A one-colour icon that would vanish on a dark plate (Tabler's slate stroke, Kafka's implicit black,
 * `currentColor`, a navy) redrawn in `ink`, or null when it has its own colours or one that already
 * reads there (Google Blue, Go's cyan) and must stay as authored.
 */
export function inkMonochromeSvg(svg: string, ink: string): string | null {
  const paints = new Set<string>();
  for (const [, , , value] of svg.matchAll(PAINT)) {
    const paint = value!.toLowerCase();
    // currentColor is whatever `color` says, so it adds no colour of its own.
    if (paint !== 'none' && paint !== 'transparent' && paint !== 'currentcolor') paints.add(paint);
  }
  if (paints.size > 1) return null;
  const [only] = paints;
  if (only !== undefined) {
    const hex = normalizeHex(only);
    if (!hex || contrastRatio(hex, DARK_PLATE) >= READS_ON_PLATE) return null;
  }
  const inked = svg.replace(PAINT, (match, property: string, joint: string, value: string) =>
    /^(none|transparent)$/i.test(value) ? match : `${property}${joint}${ink}`);
  // No paint at all draws black by default; `color` feeds currentColor. Never a second `color` on the root.
  const root = /<svg\b[^>]*>/i.exec(inked)?.[0] ?? '';
  const defaults = [only === undefined ? `fill="${ink}"` : '', /\scolor\s*=/i.test(root) ? '' : `color="${ink}"`].filter(Boolean).join(' ');
  return defaults ? inked.replace(/<svg\b/i, `<svg ${defaults}`) : inked;
}

/**
 * The ink a one-colour icon takes on its plate: on a dark plate (a dark-canvas wash, or a dark fill)
 * the label's ink, else null. A card's icon sits on a light tile, so it never changes.
 */
export function monochromeIconInk(display: 'provider-icon' | 'architecture-card', style: NodeStyle, canvasColor: string): string | null {
  if (display !== 'provider-icon') return null;
  const plate = normalizeHex(style.fill);
  if (plate) return getContrastText(plate) === '#ffffff' ? '#ffffff' : null;
  return getContrastText(normalizeHex(canvasColor) ?? '#ffffff') === '#ffffff' ? style.textColor : null;
}

const SVG_DATA_URL = 'data:image/svg+xml';

/** The SVG text inside a data URL, or null when the URL holds something else. */
export function svgFromDataUrl(url: string): string | null {
  if (!url.startsWith(SVG_DATA_URL)) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const header = url.slice(0, comma);
  const body = url.slice(comma + 1);
  try {
    return header.endsWith(';base64') ? atob(body) : decodeURIComponent(body);
  } catch {
    return null;
  }
}

export function svgDataUrl(svg: string): string {
  return `${SVG_DATA_URL};charset=utf-8,${encodeURIComponent(svg)}`;
}
