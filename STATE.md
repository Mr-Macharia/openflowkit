# State
What is done and what is next. Maintainers' plan and logs live in the untracked `docs/` folder.

## Now (2026-10-14): 2.1.0 is live; v2 is ahead of main
- `main` = v2 since PR #86 (merge commit, tagged `v2.1.0`; release + Docker published). App 2.1.0, MCP server +
  CLI 0.2.4 on v2 and on npm. `main` by PR only.
- **On v2, not main:** map ↔ drawing, one-reveal loader, private repos, agent connect/presence, self-host AI proxy
  (`OPENFLOWKIT_AI_UPSTREAM`), source files ≤ 500 lines (ESLint `max-lines`). Why: `docs/logs/2026-10-14.md`.
- Repo: github.com/openflowkit/openflowkit. npm `openflowkit` (`npx -y openflowkit mcp`) pins the engine
  `@openflowkit/openflowkit-mcp` at the same version; `@vrun-design/openflowkit-mcp` is deprecated at 0.2.2.
- MCP registry `io.github.openflowkit/openflowkit-mcp` publishes from `release.yml` on an `mcp-v*` tag
  (GitHub OIDC, no secret). Push the tag only after both npm packages are live.
- Hosting (Cloudflare Pages, production = `main`): `ofk-app` app.openflowkit.com, `ofk-docs` docs.openflowkit.com,
  `ofk-site` openflowkit.com + www (website repo; marketing home at `/`, its buttons open the app).
  Share Worker: share.openflowkit.com (R2 + Quota Durable Object, Turnstile); `worker/README.md`.
  MCP Worker: mcp.openflowkit.com/mcp (`mcp-server/`: `deploy:remote`, then `smoke:remote -- <url>`).
- Gate: `npm run verify` (typecheck, lint, unit, MCP tests + typecheck, headed `@gate`). CI: `quality`
  ∥ 4 e2e shards → `e2e-report`; `@local` specs (GPU budgets, `agent-live`) run only in `e2e:headed`.

## Release steps (MCP server + CLI)
Bump `mcp-server/package.json`, `src/lib/version.ts`, `server.json`, `cli/package.json` (version and
the exact engine pin), both plugin manifests, and the `openflowkit@x.y.z` pins (`git grep 'openflowkit@0\.'`);
`src/agent/plugin.test.ts` fails on drift. Verify, publish `mcp-server/` then `cli/`, push `mcp-vX.Y.Z`.

## Shipped in this cycle
- DSL families, Mermaid / Structurizr / D2 import, headless ELK, exports (SVG, PNG, GIF/MP4/WebM), encrypted share links.
- Agents: one op registry for MCP, CLI (`op`, `render`, `convert`, `validate`, `map`, `discover`,
  `drift`, `build`, `mcp`), WebMCP, in-app assistant, PR Action, Claude Code / Codex plugins.
- Twelve starter templates (`UPDATE_HOME_PREVIEWS=1` redraws previews); Map mode: repo maps with file:line evidence.

## Known ceilings (`// ponytail:` in code)
- Whole SVG re-emitted per export; chart/ink/image/annotation/text frames rasterized in JS. GIF: 256 colours, ≤ 20 fps,
  no custom keyframes; frames don't clip. Headless layout cap: 1000 shapes / 400 connections. Discovery blind to .NET/Elixir.

## Next
- PR v2 → main; then release in order: app → MCP Worker (`deploy:remote`, `smoke:remote`) → npm (bump first) →
  docs/site. Owner calls: bridge token default, canvas relay for claude.ai (log, "decisions"), frame names (#92).
- Launch week: apply D1 migration 0004 (one usage row per person per day, nightly rollup past 100 days)
  before deploying the share Worker; origin check on `/e`.
- After launch: npm trusted publishing, Dependabot triage, main ruleset, owner click-through (`npm run e2e:headed` first).
