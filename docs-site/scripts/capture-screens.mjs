// Captures the product screenshots the docs embed, from the real app, in both
// themes. Run by hand when the chrome changes (not in the build: it needs a
// running app, a GPU (headed Chromium) and, for the map, one GitHub API read):
//
//   npm run dev -- --host 127.0.0.1 --port 4173   # repo root, other terminal
//   node docs-site/scripts/capture-screens.mjs [editor agent map home]
//
// APP_URL points it at another build (a frozen preview, say). The agent shot
// pairs this repo's mcp-server/dist on AGENT_PORT (default 43147), never 43119.
// GITHUB_REC=<folder> replays recorded GitHub responses (and records misses).
// Scenes live in scripts/readme/scenes.mjs, shared with capture-readme.mjs.
//
// ponytail: screenshots go stale silently when the UI changes; re-run this
// script, or diff them in CI if that starts to bite.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { agentScene, codeScene, homeScene, mapScene, openPage, setScheme, still } from '../../scripts/readme/scenes.mjs';

const OUT = fileURLToPath(new URL('../public/screens/', import.meta.url));
const VIEWPORT = { width: 1280, height: 800 };
// The map's toolbar needs the wider window: at 1280 it runs under the shortcuts button.
const MAP_VIEWPORT = { width: 1440, height: 900 };

// Each scene is set up once, then shot light and dark in place: one map read, one agent pairing.
const SHOTS = {
  editor: (page) => codeScene(page),
  agent: (page) => agentScene(page),
  map: (page) => mapScene(page),
  home: (page) => homeScene(page),
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
  for (const name of wanted) {
    const page = await openPage(browser, { viewport: name === 'map' ? MAP_VIEWPORT : VIEWPORT });
    const agent = await SHOTS[name](page);
    for (const scheme of ['light', 'dark']) {
      await setScheme(page, scheme);
      // WebP at 2x: sharp on retina, a fraction of the PNG's weight on a phone.
      await sharp(await still(page)).webp({ quality: 86 }).toFile(`${OUT}${name}-${scheme}.webp`);
      console.log(`screens/${name}-${scheme}.webp`);
    }
    await agent?.close();
    await page.context().close();
  }
} finally {
  await browser.close();
}
