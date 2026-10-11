# State
Plan: `docs/plans/plan-v3.md` (untracked, owner's copy), v3 from 2026-10-03: phases 12–16. Build plan
(0–11) done, archived at `docs/archive/plan-executed-2026-10-03/`; 7b/8 parked; 6.10 → 14.1.

## Now
- **Overnight 2026-10-11 (uncommitted, owner reviews)**: 9 personas/audits → README + docs site rebuilt, ERD/class export, tool keys vs
  labels, agent canvasEdits, repo-map cards, CI lint: `docs/logs/overnight-2026-10-11.md` (owner decisions + holds). 10-10 night: `overnight-2026-10-10.md`.
  Day 10-11 (same log, rounds 2–3): Share = view-only | editable copy; GitHub #68 arrow ends + #51 Icon above/left (`iconpos`);
  section headers clear of content; labels off other edges; round 5: map drill-down GIF, Layers audit (11 fixes), WebMCP
  (`docs/plans/webmcp-plan.md`). Owner to-dos: `docs/owner/actions.md`. README art: `scripts/readme/*.mjs`.
- **Launch checks 2026-10-10**: `docs/logs/launch-checks-2026-10-10.md` (`_headers` ships; dev + e2e fail on any CSP violation).
- Icon catalog: re-run `node scripts/gen-icon-manifest.mjs` after adding SVGs. Gate: `npm run verify` (~9 min headed). README/docs screens: `scripts/capture-readme.mjs`, `docs-site/scripts/capture-screens.mjs`. CI: `quality` (unit, build, MCP) ∥ 4 e2e shards → `e2e-report` (one merged report).
- **Phases 12 + 13 DONE 2026-10-03.** Owner's: merge `main` → `v2`, PR `v2` → `main`, Cloudflare Landing, tag `v1-final`; 13.4 needs a stronger model.
## Roadmap 2026-10 run (opus-5.5, from 2026-10-07): plan `docs/plans/roadmap-2026-10.md`, log + RESUME `docs/logs/roadmap-progress.md`
- Done, pushed: 1.1 headless ELK, 1.2–1.6 discovery + names, 2.1 CLI ops, 2.2 repo → diagram, 2.3 share links, 2.4 `--svg`,
  2.6 ⌘F, 2.7/Codex plugins, 2.8 dark wash, 4.1 MCP Apps endpoint, 4.2 PR Action, 4.3 Copy as Mermaid, AI first fit,
  Workers + R2/D1 discovery, W122 (details: roadmap-progress.md).
## Map mode run (from 2026-10-08): plan `docs/plans/map-mode-plan.md` (supersedes map-plan P5+), log + RESUME `docs/logs/map-progress.md`
- Living Map P1–P4 (engine, import facts, SVG page `/#/map/github/o/r`, CLI map). Map mode in the editor: M1 b0b90370
  (fromArch, mapScene), M2 a78a5995 (`Canvas | Map`, click opens in place, arrow → relations), M3 2ae7cafa (grow-in-place
  motion), focus + flow; overnight 2026-10-09: two-way arrows + wrap everywhere, toolbar/keys/find, repo maps in the
  editor, drill → Map, Pin as page, panel clearance (51dd85ea…ae1bc1b1). Owner look #3 + open decisions:
  https://claude.ai/artifact/9gnWpNCFg2i9fFwmKVKKMD. Owner took the defaults: Canvas/Map remembered + pin on repo maps
  (52fea93a). UI pass 10-09 DONE (review https://claude.ai/artifact/TXok1h8arREGfZpJ4QmeX4, owner took A–C): fixed Canvas|Map
  switch + Map path crumb, selection carries across modes, Model panel = outline (Tree) + element card, save on blur, no
  Views tab; views/first open land readable; one dark card palette (+ dark SVG export); panels never hide content; blue
  focus ring, neutral read-only lock (dff3aeac). cf87050b: Canvas|Map on every doc (Map start screen shares the canvas
  welcome layout), Share/Export bar top right. Map bar = segmented Top level (all shut) | One level in | All levels +
  Edit as drawing; Map edits go to the model card (double-click, menu, ⌘⇧⌫) or explain once per visit. Export panel docks right. Pushed.
- Live 10-11: MCP 0.2.0 on npm + official registry; share Worker at share.openflowkit.com (R2, Turnstile, Quota DO caps it under R2's free tier; live round trip passed on the v2 preview). App/docs/www are Cloudflare Pages building `main` to production: merging v2 → main is the launch deploy. Usage stats + feedback (D1 `openflowkit-data`, `npm run stats`) live; private dashboard live at stats.openflowkit.com behind Cloudflare Access (Access values are Worker secrets, `stats/README.md`). Pro waitlist (home sidebar fake door, `V2ProWaitlist.tsx`) live 10-11: D1 0003 applied, share + stats Workers deployed; contract changes go migration → share Worker → stats → app. Launch = v2.1.0 via the tag-driven release workflow (CONTRIBUTING → Releases). Owner: merge, `start:http` over HTTPS (`docs/owner/actions.md`). `e2e:headed` 10-09: 261/266 (5 GPU budgets, Mac). Open: H5 eval.
## Found, not fixed (owner calls)
- Launch checklist (tested + evidence, then holds: MCP publish, merge, canvas UI): `docs/plans/launch-holds.md`. CI uploads first-failure
  traces (`e2e-traces`). A new worker's deps are pre-scanned (`optimizeDeps.entries`), or dev reloads mid-session.
- AI pass 10-09 (Haiku/Sonnet + real Ollama): hangs, silent failures, Ollama context, camera lands on the applied diagram, chart title ×1, sequence labels clear; big grouped layouts kept INCLUDE_CHILDREN (SEPARATE wrecks small ones). Discovery is blind to .NET/Elixir without containers (G1). Headless layout cap: 1000 shapes / 400 connections; Share Worker: `worker/README.md`.
## Ceilings (`// ponytail:` in code)
- Whole SVG re-emitted per export; chart/ink/image/annotation/text frames rasterized in JS. GIF: 256 colours, ≤ 20 fps,
  no custom keyframes. Frames don't clip on export. Animation is page-scoped; deployment/migration fidelity partial.
## Next — owner's order, 2026-10-06 (D8 decided: no labs flag)
- Canvas UI done (10-06 rail/Inspect/Shapes/connector pass; 10-09 UI pass above) → launch holds, 13.4 → 14.4 → 15.
  Open: D7, D11 (own glyphs, empty screen). Next: owner click-through when the GPU is free, then `docs/prompts/launch-qa-prompt.md`.
