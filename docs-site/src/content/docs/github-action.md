---
title: GitHub Action
description: Comment on every pull request with how its diagrams changed — DSL diff, node counts, drift and stale SVGs — from your own CI.
---

The PR diagrams Action posts one comment on a pull request that changes a diagram file. It runs
in your CI with the [`openflowkit` CLI](/cli/), `git` and `gh`: no server and no hosting.

## Set it up

```yaml
on:
  pull_request:
    paths: ['**/*.openflow.json', '**/*.ofk']
permissions:
  contents: write        # only to push refreshed SVGs
  pull-requests: write   # the comment
jobs:
  diagrams:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Vrun-design/openflowkit/action@<tag>
```

`<tag>` must be a release tag on `main` whose tree contains the `action/` folder. The Action
works from another repository only once such a tag exists. A branch name also works but moves
under you; a tag or a commit SHA does not. Inside the OpenFlowKit repository itself,
`uses: ./action` works.

The default CLI is pinned to `@vrun-design/openflowkit-mcp@0.2.1`, so that version must be on
npm. A CLI you point the `cli` input at must also be 0.2.0 or newer: older versions have no
`render`, `convert` or `op`.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Comments, and pushes refreshed SVGs |
| `cli` | `npx -y -p @vrun-design/openflowkit-mcp@0.2.1 openflowkit` | The command that runs the CLI; it never sees the token |
| `refresh-svg` | `false` | Commit a fresh `<name>.svg` when the committed one is stale (same-repo PRs only) |
| `comment-author` | `github-actions[bot]` | The login whose comment is updated; set it when you pass a PAT or App token |
| `paths` | `.openflow.json,.ofk` | Extensions (starting with `.`) or globs, comma-separated |

## What it posts

One comment per pull request, updated in place. For each changed diagram: its status, node
and connector counts before and after, the DSL diff (first 300 lines) and, for `.ofk`
architecture models, drift (gone, new, changed). A file that fails to render gets a line, not
a failed job. When no diagram changed, there is no comment.

A committed SVG beside a diagram (`x.openflow.json` or `x.ofk` next to `x.svg`) that differs
from a fresh render is listed as stale. With `refresh-svg: true` on a same-repo PR, the Action
commits the fresh SVG to the PR branch instead, and still lists it if the push is rejected.

## Forks and branch protection

Fork and Dependabot PRs get a read-only token, so the Action can't comment or push there. It
writes the same text to the job summary and exits 0. It does the same if the comment call
returns 403.

A push made with `GITHUB_TOKEN` doesn't trigger workflows, so a refreshed commit has no checks
and required checks block the merge. That is why `refresh-svg` is off by default. To use it
under branch protection, pass an App or PAT token as `github-token`, and its login as
`comment-author`.

## What it does not do

- **No inline images.** GitHub can't show an SVG from CI without hosting it. The before and
  after SVGs are uploaded as the run's `diagram-svgs` artifact (kept 14 days), and the comment
  links to it.
- **No PNG.** Pictures are SVG, like the CLI's.

## Where to go next

- [The openflowkit CLI](/cli/): the commands the Action runs.
- [Architecture workspace](/architecture-workspace/): `.ofk` models and drift.
