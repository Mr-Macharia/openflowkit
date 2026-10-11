---
title: FAQ
description: Privacy, offline use, file formats, Mermaid, Structurizr and D2, browser support, where your data lives, backups, and the errors people hit most.
---

## What is OpenFlowKit?

Architecture diagrams you draw, write as code, or hand to your agent. It is free, open source
(MIT) and local-first: one document you can draw on, write as
[OpenFlow DSL](/openflow-dsl/), or let an MCP client edit. There is no account.

## What leaves my browser?

Your diagrams stay in your browser. Something leaves it only when you choose: AI with your own
key goes to that provider, a share link uploads an encrypted copy, a repo map reads from GitHub.

Every request the app makes, and when:

| When you… | What is sent | Where |
| --- | --- | --- |
| Ask the [AI assistant](/ai-generation/) | Your message, the diagrams in scope, any images you attached, and your key | Only the provider you picked |
| Copy a **view-only link** | The document, encrypted in the browser first; the key stays in the link's `#fragment` and is never sent | The share Worker (`share.openflowkit.com`), after a Cloudflare Turnstile check |
| Open a view-only link | A request for the encrypted copy | The share Worker |
| Copy or open an **editable copy** link | Nothing: the diagram's code rides in the link's `#fragment` | Nowhere |
| Map a repo, or turn a repo into a diagram | Requests for the repo's file list and files (plus your GitHub token, if you gave one) | `api.github.com` and `raw.githubusercontent.com` |
| [Connect an agent](/mcp-server/) | Tool calls and their results | The MCP server on your own machine, at `127.0.0.1` |
| Paste an image URL | A normal image request | That URL |
| Open Home | A request for the repository's star count, at most once a day (no diagram data) | `api.github.com` |

There is no analytics, telemetry or crash reporting in the app. Everything else, including
compiling, layout, icons and every export, runs in the page.

## Where does my data live?

In the browser you used, on the address you opened the app from:

- **Documents**: IndexedDB. Each save also keeps the previous good copy for crash recovery.
- **Preferences, AI keys and chats**: this browser's local storage. A key is only ever sent to
  the provider it was entered for.
- **A GitHub token for repo maps**: session storage, gone when the tab closes.

Nothing is synced. Another browser, another device or another address (say, a self-hosted copy)
has its own separate set. Clearing site data for the app deletes your documents.

## How do I back up my diagrams?

Click **Export**, pick **JSON** and download. The JSON file is the whole document, every page,
and **Open file…** (or Home → **Import**) reads it back in any browser. For architecture work in
Chrome or Edge, a [workspace folder](/architecture-workspace/) writes `architecture.ofk` and
its views to a folder on disk, which you can commit to Git.

## Does it work offline?

Not as an installed app: it registers no service worker, so the hosted app needs a connection
to load. Once the page is open, drawing, the code panel and exports run in the page. AI, share
links and repo maps need the network. To work with no internet at all, run your own copy on
your machine; see [Self-hosting](/self-hosting/).

## Which file formats can I open and save?

| Direction | Formats |
| --- | --- |
| Open or import | OpenFlowKit `.json` (including files from version 1), Mermaid (`.mmd`, `.mermaid`), D2 (`.d2`), Structurizr DSL (`.dsl`), OpenFlow DSL (`.ofk`, `.txt`) |
| Export | PNG, SVG, PDF (through the print dialog), JSON; animated SVG, GIF, MP4 and WebM ([Animated export](/animated-export/)) |
| Copy | PNG to the clipboard; a flowchart or sequence diagram as Mermaid text |

The MCP server and the [CLI](/cli/) read and write the same JSON as `.openflow.json` files, and
architecture models as `architecture.ofk`.

## Can I use my Mermaid, Structurizr or D2 diagrams?

Yes, all three come in. Paste them into the code panel (`⌥C`) and click **Convert**, import the
file on Home, or pass the text to an agent tool or `openflowkit convert`. Each converter reports
what it could not carry over instead of dropping it silently. Going back out, only flowcharts
and sequence diagrams can be copied as Mermaid; there is no Structurizr or D2 export. See
[Mermaid, Structurizr and D2 import](/mermaid-import/).

## Which browsers does it support?

A current desktop browser with WebGL. If WebGL is off, the canvas says so and points you to
hardware acceleration in your browser's settings. Our automated tests run in Chromium. Two
features depend on newer browser APIs:

- **Workspace folders** need the File System Access API (Chrome and Edge); elsewhere the menu
  item is hidden.
- **MP4 export** needs WebCodecs; where it is missing the option is hidden, and WebM falls back
  to recording in real time.

Tablets work with touch (pinch, pan, long-press for the context menu), but the controls are
desktop-sized.

## Which AI providers work, and does it cost anything?

The app itself is free. The assistant works with Gemini, OpenAI, Claude, Groq, NVIDIA, Cerebras,
Mistral, OpenRouter, Ollama, or any OpenAI-compatible endpoint, using your own key, so the
provider bills you directly. The MCP server needs no key at all: your MCP client's model does
the work.

## Troubleshooting

| Message or symptom | What it means |
| --- | --- |
| An agent says "No document: pair an editor" | The MCP server is running but no editor is connected. In the app, open **Connect agent** and click **Connect**, or have the agent use `openflow_open` on a file |
| "Another tab saved first" | The same document is open in two tabs. **Reload** takes the other tab's version; **Save as copy** keeps yours as a new document |
| The canvas asks for WebGL | Turn on hardware acceleration in the browser settings, or try another browser |
| Ollama doesn't answer from the hosted app | Ollama rejects other origins by default. Quit the Ollama app and run `OLLAMA_ORIGINS='*' ollama serve` |
| A plain-`http` model server on another machine is blocked | The app's security policy only allows HTTPS, plus `http` on `localhost` and `127.0.0.1`. Put the server behind HTTPS |
| `npx … openflowkit` says the command doesn't exist | The CLI needs `@vrun-design/openflowkit-mcp` 0.2.0 or newer |

## Where to go next

- [Local-first diagramming](/local-first-diagramming/): saving, recovery and opening files.
- [Self-hosting](/self-hosting/): run your own copy.
- [Share links](/share-links/): what the share Worker stores.
