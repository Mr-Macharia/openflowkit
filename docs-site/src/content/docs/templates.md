---
title: Home and templates
description: Home lists your diagrams, imports files and offers seven starter templates — real diagrams you open and change, no API key needed.
---

Home is where your diagrams are listed. Open it from the canvas menu (☰) → **Back to home**, or
go to `app.openflowkit.com/#/home`. Opening the app's address without a path takes you back to
the last document you had open, or starts a new one.

## Ways in

On a first visit, Home offers four starts:

| Card | What it opens |
| --- | --- |
| **Blank canvas** | An empty document, to draw by hand |
| **Describe it to AI** | A new document with the [AI assistant](/ai-generation/) open |
| **Paste code or Mermaid** | A new document with the [code panel](/openflow-dsl/) open; OpenFlow DSL, Mermaid, D2 and Structurizr all work |
| **Connect your agent** | A new document with the [Connect agent](/mcp-server/) panel open |

Below them, **Or start from a template** shows the templates. **Import** (or dropping files
anywhere on Home) brings in `.json` documents and diagram text files; see
[Local-first diagramming](/local-first-diagramming/#opening-and-importing-files).

## Templates

Each template is a finished diagram written in OpenFlow DSL. Picking one opens a new document
with it generated, so you can change the text or the canvas straight away. The originals never
change.

| Template | Family | What it shows |
| --- | --- | --- |
| **Shop architecture** | architecture | One C4 model drawn as a system map, an overview and its services, with a checkout flow you can play back |
| **User authentication** | flowchart | Login with an MFA branch and an access-denied terminal |
| **Three-tier AWS architecture** | architecture | Edge, application and data tiers with AWS icons |
| **Request lifecycle** | sequence | Browser, gateway and service, with an `alt` fragment |
| **Order state machine** | state | Draft, review, fulfilment and terminal states |
| **Event pipeline** | flowchart | Producer to stream to consumers, with a dead-letter path |
| **Simple process flow** | flowchart | A purchase approval in plain steps: request, review, a yes/no decision |

This is the source of **Simple process flow**:

```openflow
%% ofk 1
flowchart right
title: Simple process flow

Review [label: "Manager reviews"]
Decision [diamond, amber, label: "Approved?"]
Request [rounded, emerald, label: "Request received"] -> Review
Review -> Decision
Decision -> Done [rounded, emerald, label: "Order placed"] : Yes
Decision -> Revise [label: "Ask for changes"] : No
Revise -> Review
```

Agents get the same seven: the MCP tools `list_starter_templates` and `get_starter_template`
return them by name, so an agent can start from one without writing DSL from scratch.

## Your diagrams

The sidebar has **Recents**, **Starred**, **Templates**, **Archive** and **What's new**.

| Key | On Home |
| --- | --- |
| `N` | New diagram |
| `/` | Filter the list by name |
| `⌘K` | Find any diagram, template or action |
| `S` | Star or unstar the focused diagram |
| `F2` | Rename the focused diagram |
| `⌘A` | Select every diagram in the list |
| `Delete` | Archive the selection; in **Archive**, delete it for good (after a confirmation) |
| `Esc` | Clear the selection |
| `?` | The list of keys |

Archiving takes a diagram off your list without deleting it; restore it from **Archive**.

## What it does not do

- **No folders or tags for diagrams.** Star the ones you use, and archive the rest.
- **No custom templates.** To reuse a diagram, duplicate it or keep its DSL somewhere and paste
  it into the code panel.
- **No sync.** Home lists the documents in this browser only.

## Where to go next

- [Quick start](/quick-start/): draw, write and export in five minutes.
- [OpenFlow DSL](/openflow-dsl/): the language every template is written in.
- [Architecture (C4)](/architecture-c4/): the model behind **Shop architecture**.
