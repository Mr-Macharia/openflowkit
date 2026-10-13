---
title: Context menu
description: Right-click on a shape, a connector, a generated frame or empty canvas for the actions that apply to it.
---

Right-click (or long-press on touch) opens a menu scoped to what is under the pointer. Cut,
Paste, Delete, Lock and the other edits are disabled when they can't apply (in a read-only
document, say). Group, Align, Distribute, Ungroup, Edit as code, Icons from labels, Remove
icon and the model items only appear when they apply.

## On empty canvas

| Item | What it does |
| --- | --- |
| Paste | Paste the clipboard at the cursor |
| Select all | Select every node on the page |
| Zoom to fit | Frame the whole page |
| Zoom to 100% | Reset to one-to-one scale |
| Show grid | Toggle the dot grid |
| Snap to grid | Toggle grid snapping |

The last two are the same preferences as [Settings](/settings/), kept here because they are
things you reach for mid-drag.

## On a shape or a selection

| Item | What it does |
| --- | --- |
| Cut / Copy / Duplicate | Clipboard and duplication |
| Edit label | Open the in-place label editor |
| Inspect (`⌥I`) | Read-only facts about the selection: layout, style, source line, model element |
| Edit as code | Appears on a generated frame; reopens its DSL source |
| Icons from labels | Appears on a generated flowchart or architecture frame; ticks on or off [icons from labels](/diagram-architecture/#icons-from-labels) for that diagram |
| Remove icon | Appears when the selection has icons; one undo step for all of them |
| Edit in model / Open *name* view / Unplace from this view / Remove from model | Appear when the shape is a [C4 model](/architecture-c4/) placement; Open *name* view only when the element has its own view |
| Style → Copy style / Paste style | Copy the appearance between shapes |
| Reorder → Bring to front / Bring forward / Send backward / Send to back | Z-order |
| Transform → Flip horizontal / Flip vertical | Mirror the selection; with two or more selected, Align left, centre, right, top, middle and bottom follow, and with three or more, Distribute horizontally and vertically |
| Group / Wrap in section / Ungroup | Group appears with two or more selected; Ungroup when the selection can be unwrapped |
| Export… | Open the [export panel](/exporting/) scoped to this element — a container brings its whole subtree |
| Zoom to selection | Frame the selection |
| Lock / Unlock | Toggle the lock |
| Delete | Delete the selection |

## On a connector

| Item | What it does |
| --- | --- |
| Edit label | Edit the connector's label |
| Inspect (`⌥I`) | Read-only facts about the connector |
| Path → Elbow / Straight / Curve | Change the routing |
| Reverse direction | Swap the endpoints and the arrow head |
| Style → Copy / Paste style | Appearance between connectors |
| Export… | Export just this connection, without its endpoints |
| Delete | Remove the connector |

## What it cannot do

- **No custom menus or plugins.** The menu is the set of operations the editor has.
- **No multi-connector operations.** One connector at a time; style copy/paste works from a
  node to a node and from a connector to a connector, not across the two.
- **No "open in new tab" style items.** Everything acts on the current page.

## Where to go next

- [Keyboard shortcuts](/keyboard-shortcuts/) — the same actions on keys.
- [Properties panel](/properties-panel/) — the style editors the menu links to.
