# Google Cloud Icons Source Metadata

- Provider: Google (Google Cloud product icons)
- Source page: https://cloud.google.com/icons
- Downloads (2026-10-11):
  - Core products: https://services.google.com/fh/files/misc/core-products-icons.zip
  - Category icons: https://services.google.com/fh/files/misc/category-icons.zip
  - Guide: https://services.google.com/fh/files/misc/google-cloud-product-icons.pdf ("Updated: May 2026")
- Not imported: the legacy console icon zip. The guide: "these icons should not be used as of 2026".
- Licence: neither the page nor the guide states one. Imported at the owner's request (2026-10-11), on the
  same footing as AWS and Azure: vendor-published icons, used to name the product in architecture diagrams.
  Marks are unmodified apart from size; no endorsement by Google is implied.
- Last verified: 2026-10-11

## What ships in `processed/`

- `Core/` — 19 official 4-colour unique icons, the guide's core products: `ai-hypercomputer`, `alloydb`,
  `anthos`, `apigee`, `bigquery`, `cloud-run`, `cloud-spanner` (the guide now says "Spanner"), `cloud-sql`,
  `cloud-storage`, `compute-engine`, `gke`, `google-distributed-cloud`, `hyperdisk`, `looker`, `mandiant`,
  `security-command-center`, `security-operations`, `threat-intelligence`, `vertex-ai`.
- `Core/` also keeps 14 one-colour [Simple Icons](https://simpleicons.org) glyphs (CC0-1.0 path data, marks
  still Google's) for products Google's zips have no icon for, so ids diagrams already use keep resolving:
  `analytics`, `cloud-composer`, `colab`, `dataflow`, `dataproc`, `docs`, `drive`, `gemini`, `google-ads`,
  `google-cloud`, `maps`, `pubsub`, `sheets`, `slides`. Before this import `bigquery`, `cloud-spanner`,
  `cloud-storage` and `looker` were Simple Icons glyphs too; the same ids now draw Google's art.
  Each glyph is filled with its Simple Icons brand hex (checked against simple-icons.json, 2026-10-11),
  except Pub/Sub, Dataflow and Dataproc: Simple Icons lists `#AECBFA`, too pale on a light plate, so they
  use Google Blue `#4285F4`.
- `General/` — 26 official 2-colour category icons (the guide calls them "general product category icons"):
  `ai-applications-agents`, `ai-machine-learning`, `business-intelligence`, `collaboration`, `compute`,
  `containers`, `data-analytics`, `databases`, `developer-tools`, `devops`, `hybrid-multicloud`,
  `integration-services`, `management-tools`, `maps-geospatial`, `marketplace`, `media-services`, `migration`,
  `mixed-reality`, `networking`, `observability`, `operations`, `security-identity`, `serverless-computing`,
  `storage`, `web-mobile`, `web3`. The folder is `General`, not `Category`, so it sorts after `Core` and a
  short id such as `gcp/analytics` keeps matching the core glyph before `general-data-analytics`.
- The guide's product → category list is `src/dsl/gcpProducts.ts`: searching "cloud functions" finds
  `general-serverless-computing`, and `[gcp/cloud-functions]` resolves to it.

## Labels

File names stay lowercase (ids are derived from them, and a case-only rename does not survive git on
macOS), so `labels.json` gives each icon Google's name: "GKE", "Cloud SQL", "Pub/Sub", "AI & Machine
Learning". `scripts/gen-icon-manifest.mjs` and `mcp-server/scripts/build-icon-manifest.mjs` read it; a key
with no SVG fails the editor's generator.

## Raw and processing

- `raw/google-cloud-icons-svg-2026-10-11.zip`: every SVG from both zips, unmodified, in Google's folder layout
  (`Unique Icons/<Product>/SVG/…`, `Category Icons/<Category>/SVG/…`). PNGs, `.DS_Store` files and one `.ai`
  file were left out.
- Processing: SVGO 4.1 with `preset-default` (`inlineStyles` with `onlyMatchedOnce: false`; `mergePaths` and
  `convertPathData` off, because both moved edge pixels), `convertStyleToAttrs`, `removeScripts`,
  `removeXlink`, the Illustrator 512×512 `bounding_box` element removed, and the root `id`/`version` dropped.
  The result is paths and circles with `fill` attributes, no `<style>`, scripts or external references, and
  the original `viewBox="0 0 512 512"`. Every output was rendered at 128px in Chromium next to its original:
  the largest channel difference was 2/255. 93 KB of originals → 75 KB.
- Don't run `scripts/tighten-svg-viewboxes.mjs` on this pack: Google's padding is part of the design.
- After adding or removing an SVG, or editing `labels.json`: `node scripts/gen-icon-manifest.mjs`, then
  `npm --prefix mcp-server run build:icons`.
