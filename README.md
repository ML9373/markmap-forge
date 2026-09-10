# markmap-forge

Deterministic renderer + validator for the Strategic Mind Map skill: a small typed JSON in, a standalone interactive Markmap HTML5 document out.

This replaces an earlier ad hoc workflow where an LLM was asked to hand-reproduce a ~500-line HTML/CSS/JS template verbatim on every run. Here the template is a static asset and a Node.js CLI does the substitution, validation, and escaping — so the output is byte-reproducible from its JSON source and immune to the LLM subtly corrupting the template.

![A rendered Markmap Forge strategic map, with its level, search, palette and export controls](https://raw.githubusercontent.com/ML9373/markmap-forge/main/docs/preview.png)

*The document above is `examples/example.html`, produced by the CLI from `examples/example.mindmap.json`. Regenerate the screenshot with `npm run capture:preview` so it never drifts from the template.*

Every output is a single self-contained HTML file: no build step, no script fetched at view time (it opens offline and behind corporate web filters), with search, level folding, pitch mode, dark mode, palette/font/size controls, an in-page markdown editor that regenerates the tree, and SVG/PNG export built in.

See [`SKILL.md`](./SKILL.md) for the authoring contract (how an agent should use this).

## Install

```bash
npm install
```

## CLI

```bash
node bin/markmap-forge.mjs validate <input.json> [--json]
node bin/markmap-forge.mjs render <input.json> [output.html] [--json]
node bin/markmap-forge.mjs deliver <input.json> [output.html] [--json]
```

`deliver` validates, renders, and prints a SHA-256 receipt for both the JSON source and the HTML artifact.

## Input shape

See [`schemas/mindmap.schema.json`](./schemas/mindmap.schema.json) and [`examples/example.mindmap.json`](./examples/example.mindmap.json):

```json
{
  "schema_version": 1,
  "source_name": "Human-readable original title or filename",
  "generation_date": "2026-08-29",
  "markdown": "# Title\n## Pillar\n### Entity\n- detail\n"
}
```

`markdown` is a strict outline: `#` title (exactly one), `##` pillars, `###` entities, `-` nested bullets. No tables, no stray arrows/pipes, no heading-level skips — the validator enforces all three as hard errors.

## Output

One self-contained HTML file (no build step, no server) with:

- Live search with match count and Ctrl+F
- Expand/Collapse and one button per detected heading depth
- Dark/light theme with persisted state (localStorage)
- SVG export
- **PNG export** — a full-resolution, high-DPI (2x) raster of the whole map's bounding box, distinct from the raw SVG export. Renders through a foreignObject-free clone of the SVG (Chrome taints canvas exports of SVGs containing `<foreignObject>` HTML, even same-origin) so the rasterization never fails on real content.
- **Pitch Mode** (fullscreen focus-and-zoom on click) — automatically engages AutoFit so expanded nodes are framed instantly, no manual "Fit Window" needed.
- **Decorative animated links** — a toggleable subtle flowing dash along branches. Purely visual: unlike archify's flow animation, a mind map's branches are hierarchy, not directional dataflow, so this is honestly decorative, not a flow indicator.
- **Overlap-safe fitting** — the floating menu panels are fixed overlays with no native collision avoidance against the tree; every "fit" pans the tree clear of them once the fit animation has actually settled, instead of letting a node render (and stay hidden) underneath a panel.

Rendering is powered by [markmap](https://markmap.js.org) + d3, **inlined** into the generated HTML from pinned copies in `vendor/browser/` (d3 7.9.0, markmap-lib and markmap-view 0.18.12, licences alongside). Up to 0.3.0 they were loaded from cdn.jsdelivr.net, which corporate web filters block: the map then rendered empty. Each file is now ~0.7 MB instead of ~40 KB, the price of working anywhere. The only remaining network request is Google Fonts, and every font stack has a local fallback.

markmap's KaTeX and highlight.js plugins are disabled for the same reason (they fetch scripts, styles and fonts from the CDN at view time): a formula shows as its source text, a code block as plain monospace.

After bumping a library version in `lib/browser-libs.mjs`, regenerate the vendored files with `npm run vendor:browser` (checks each npm tarball's integrity, minifies with esbuild, copies the licence).

**Removed, 2026-08-30**: Guided Tour and the minimap were both ported from archify, then iterated on across several sessions to fix real bugs — but never worked reliably enough to justify the ongoing maintenance cost, so they were cut rather than kept as a half-working feature. See the vault project note's Changelog for the full postmortem.

## Test

```bash
npm test
```

Unit tests cover the validator and the renderer (no `<script src>` in the output, libraries inlined in order, `$` sequences in content kept verbatim). `npm run test:live` additionally renders `examples/example.mindmap.json` and loads it in a real headless Chrome (via raw CDP — no puppeteer dependency) to assert the interactive JS actually works: no node renders underneath the fixed menu panels after a fit, Tour Mode and the minimap are confirmed absent (removed 2026-08-30), dark-mode/PNG-export both run without console errors, and the page makes no network request other than web fonts, even when the content holds a formula or a code block. Needs a local Chrome (macOS, Linux or Windows; Edge also works on Windows); skips with a message if none is found.

## Example

```bash
npm run render:example
```

Renders [`examples/example.mindmap.json`](./examples/example.mindmap.json) (a mind map describing this tool itself) to `examples/example.html`.
