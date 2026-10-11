// Screen recording for the README GIF: page.screenshot at a steady interval
// while a script drives the page, then a small GIF via gifenc (no ffmpeg).
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

/** Screenshots `page` every `interval` ms until `script` resolves; each frame keeps the time it was taken. */
export async function record(page, script, { interval = 100 } = {}) {
  const frames = [];
  let done = false;
  const loop = (async () => {
    while (!done) {
      const start = Date.now();
      frames.push({ t: start, png: await page.screenshot() });
      const wait = interval - (Date.now() - start);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  })();
  try { await script(); } finally { done = true; await loop; }
  return frames;
}

/** A real pointer is not in screenshots, so the recording draws where it is: a plain dot, pressed = smaller. */
export async function showPointer(page) {
  await page.evaluate(() => {
    const dot = document.createElement('div');
    dot.setAttribute('aria-hidden', 'true');
    Object.assign(dot.style, {
      position: 'fixed', left: '-40px', top: '-40px', width: '20px', height: '20px', margin: '-10px 0 0 -10px',
      borderRadius: '50%', background: 'rgba(28, 25, 23, 0.55)', border: '2px solid #fff', boxSizing: 'border-box',
      boxShadow: '0 1px 6px rgba(0, 0, 0, 0.3)', pointerEvents: 'none', zIndex: '2147483647', transition: 'scale 90ms',
    });
    document.body.append(dot);
    const at = (event) => { dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`; };
    addEventListener('pointermove', at, true);
    addEventListener('pointerdown', (event) => { at(event); dot.style.scale = '0.75'; }, true);
    addEventListener('pointerup', () => { dot.style.scale = '1'; }, true);
  });
}

/** Glides the mouse (and the dot) to x, y over `ms`, eased. */
export async function glide(page, from, to, ms = 500) {
  const steps = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await page.waitForTimeout(16);
  }
}

/**
 * Frames ({ rgba, t }) of one size → a looping GIF. One palette for the whole clip (no colour flicker); each frame
 * after the first stores only the pixels that changed (the rest transparent), and identical frames merge into
 * one longer one, so a mostly still UI recording stays small. The last frame holds `holdMs`.
 */
export function encodeGif(frames, { width, height, holdMs = 1500 }) {
  const sample = frames.filter((_, i) => i % 4 === 0 || i === frames.length - 1);
  const pooled = new Uint8Array(sample.length * width * height * 4);
  sample.forEach(({ rgba }, i) => pooled.set(rgba, i * width * height * 4));
  const colors = quantize(pooled, 255);
  // One more entry, never matched by applyPalette, stands for "unchanged".
  const clear = colors.length;
  const palette = [...colors, [255, 0, 255]];

  const indexed = frames.map(({ rgba }) => applyPalette(rgba, colors));
  const shown = [];
  for (let i = 0; i < frames.length; i += 1) {
    const delay = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : holdMs;
    const previous = shown.at(-1);
    if (previous && indexed[i].every((value, p) => value === indexed[i - 1][p])) { previous.delay += delay; continue; }
    shown.push({ i, delay });
  }
  const gif = GIFEncoder();
  shown.forEach(({ i, delay }, n) => {
    if (n === 0) {
      gif.writeFrame(indexed[i], width, height, { palette, delay, repeat: 0 });
      return;
    }
    const last = indexed[shown[n - 1].i];
    const delta = indexed[i].map((value, p) => (value === last[p] ? clear : value));
    gif.writeFrame(delta, width, height, { delay, transparent: true, transparentIndex: clear, dispose: 1 });
  });
  gif.finish();
  return { bytes: gif.bytes(), frames: shown.length, ms: shown.reduce((sum, { delay }) => sum + delay, 0) };
}
