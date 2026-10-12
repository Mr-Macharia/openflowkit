# openflowkit

The [OpenFlowKit](https://openflowkit.com) command line. Turn diagram text into SVG, check diagrams in CI, and map a repository.

```sh
npx openflowkit render flow.mmd -o flow.svg        # Mermaid, D2, Structurizr or OpenFlow DSL → SVG
npx openflowkit convert flow.mmd -o flow.openflow.json   # → a file you can open and edit in the app
npx openflowkit validate flow.ofk                  # line-by-line errors; exit 1 on a broken diagram
npx openflowkit discover .                         # propose an architecture model from the repo
npx openflowkit map . --html map.html              # what the repo is made of, as a page
npx openflowkit --help                             # every command
```

Install it once with `npm i -g openflowkit`, then run `openflowkit …`.

This package is a short name for [`@vrun-design/openflowkit-mcp`](https://www.npmjs.com/package/@vrun-design/openflowkit-mcp), which also ships the MCP server for Claude Code, Cursor and other agents. Docs: [docs.openflowkit.com/cli](https://docs.openflowkit.com/cli/).

MIT licensed.
