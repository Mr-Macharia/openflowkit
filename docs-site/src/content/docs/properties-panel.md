---
title: Properties panel
description: The selection's style panels — fill, outline, text, icon, ink, chart and connector editors.
---

Selection drives the inspector: the context bar floats over what you selected and shows the
style panels that apply to it. Each panel opens in place, previews live while you drag a
value, and commits one undo step when you let go.

## Node panels

| Panel | What it edits |
| --- | --- |
| **Fill** | **Pastel** or **Solid** mode, then one of ten colours (White, Gray, Blue, Green, Red, Orange, Violet, Pink, Yellow, Teal), no fill, or a custom colour; corner radius, opacity, shadow. Titled **Background** on text nodes |
| **Outline** | Stroke colour (or no outline), width, dash (solid, dashed, dotted) |
| **Text** | Colour (or auto), font family, size, weight/italic/underline/strikethrough, alignment, vertical alignment, padding, line height, letter spacing; containers get a header shown/hidden toggle instead of vertical alignment |
| **Shape** | Swap a basic shape for another outline, keeping its label and style |
| **Icon** | Pick an icon for a shape, turning it into an icon card. On icon cards, **Layout** puts the icon above the name (a tile) or to its left (a row card) |
| **Ink** | Pen and highlighter colour and width; stroke nodes keep their ink in `content`, not appearance |
| **Chart** | **Chart type**, for chart nodes; the **Data** button beside it opens the numbers |
| **State** | A wireframe control's state: on/off, value, selected item or style |

**Solid** switches the ten swatches from pastel to solid fills. The four diagram palettes
(Pastel, Paper, Builder, Mono) are a different thing: they are chosen in the code panel and
apply when a diagram is generated. A custom colour is kept verbatim.

Besides **Appearance**, the context bar has **Data** (charts), **Arrange** (**Align** and
**Arrange**) and **Actions**: **Open …** on a model element with its own view, **Inspect**
(`⌥I`) and **More options**, which opens the [context menu](/context-menu/).

## Connector panels

| Panel | What it edits |
| --- | --- |
| **Line** | Colour, width, dash, path (elbow, straight, curve), corner radius for elbows |
| **Ends** | Start and end markers (none, arrow, dot, diamond) and reverse direction |
| **Label** | Label colour, background, font, size, bold/italic |

## Mixed selections

With several shapes selected, a field shows the common value or nothing when they differ;
editing it sets every selected shape to the new value. Panels that cannot apply — an icon for
a text node, for example — are not offered.

Style choices are sticky: the last committed style seeds the next shape you draw.

## Chart data

A chart's numbers are edited in the chart data panel, not by dragging bars: cells write the
diagram's DSL source and regenerate the same chart with the new value. See the
[chart family](/diagram-chart/) for the data format.

## What it cannot do

- **No per-property keyframes or effects.** Style is static; motion comes from the
  [`animate` block](/animated-export/).
- **No reusable named styles.** Copy style (`⌘Alt + C` / `⌘Alt + V`) moves a style between
  shapes; there is no style library.
- **No design-token binding.** Palette colours are the app's; custom colours are values, not
  tokens.
- **No arrowheads on ink.** Marker ends exist for connectors only.

## Where to go next

- [Theming](/theming/) — palettes, light/dark and the app's own look.
- [Canvas basics](/canvas-basics/) — the manipulation side of the same selection.
