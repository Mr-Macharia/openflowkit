# State
What is done and what is next. Maintainers' plan and logs live in the untracked `docs/` folder.

## Now (2026-10-13): 2.1.0 is live
- `main` = v2 since PR #86 (merge commit, tagged `v2.1.0`; release + Docker published). App 2.1.0, MCP server +
  CLI 0.2.3. Changes reach `main` by PR only (one review; repo admins bypass through a PR).
- Repo: github.com/openflowkit/openflowkit. npm `openflowkit` (`npx -y openflowkit mcp`) pins the engine
  `@openflowkit/openflowkit-mcp` at the same version; `@vrun-design/openflowkit-mcp` is deprecated at 0.2.2.
- MCP registry `io.github.openflowkit/openflowkit-mcp` publishes from `release.yml` on an `mcp-v*` tag
  (GitHub OIDC, no secret). Push the tag only after both npm packages are live.
- Hosting (Cloudflare Pages, production = `main`): `ofk-app` app.openflowkit.com, `ofk-docs` docs.openflowkit.com,
  `ofk-site` openflowkit.com (website repo; `/` 302s to the app, marketing home at `/product/`).
  Share Worker: share.openflowkit.com (R2 + Quota Durable Object, Turnstile); `worker/README.md`.
- Gate: `npm run verify` (typecheck, lint, unit, MCP tests + typecheck, headed `@gate`). CI: `quality`
  ∥ 4 e2e shards → `e2e-report`; `@local` specs (GPU budgets, `agent-live`) run only in `e2e:headed`.

## Release steps (MCP server + CLI)
Bump `mcp-server/package.json`, `src/lib/version.ts`, `server.json`, `cli/package.json` (version and
the exact engine pin), both plugin manifests, and the `openflowkit@x.y.z` pins (`git grep 'openflowkit@0\.'`);
`src/agent/plugin.test.ts` fails on drift. Verify, publish `mcp-server/` then `cli/`, push `mcp-vX.Y.Z`.

## Shipped in this cycle
- Language + canvas: DSL families, Mermaid / Structurizr / D2 import, Copy as Mermaid, headless ELK,
  exports (SVG, PNG, animated SVG, GIF/MP4/WebM), share links (end-to-end encrypted).
- Agents: one op registry for MCP, CLI (`op`, `render`, `convert`, `validate`, `map`, `discover`,
  `drift`, `build`, `mcp`), WebMCP, in-app assistant, PR Action, Claude Code / Codex plugins.
- Twelve starter templates (`src/agent/starterTemplates.ts`); `UPDATE_HOME_PREVIEWS=1` redraws their previews.
- Map mode: repo maps from GitHub with file:line evidence, grow-in-place motion, focus + flow.

## Known ceilings (`// ponytail:` in code)
- Whole SVG re-emitted per export; chart/ink/image/annotation/text frames rasterized in JS.
- GIF: 256 colours, ≤ 20 fps, no custom keyframes. Frames don't clip on export.
- Headless layout cap: 1000 shapes / 400 connections. Discovery is blind to .NET/Elixir without containers.

## Next
- Launch week: apply D1 migration 0004 (one usage row per person per day, nightly rollup past 100 days)
  before deploying the share Worker; origin check on `/e`.
- After launch: npm trusted publishing from CI, triage Dependabot alerts, main branch ruleset,
  owner click-through of the release build (`npm run e2e:headed` first).
