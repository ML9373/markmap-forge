# syd-markmap-forge

Deterministic renderer + validator for the Strategic Mind Map skill: a small typed JSON in, a standalone interactive Markmap HTML5 document out.

This replaces an earlier ad hoc workflow where an LLM was asked to hand-reproduce a ~500-line HTML/CSS/JS template verbatim on every run. Here the template is a static asset and a Node.js CLI does the substitution, validation, and escaping — so the output is byte-reproducible from its JSON source and immune to the LLM subtly corrupting the template.

See [`SKILL.md`](./SKILL.md) for the authoring contract (how an agent should use this).

## Install

```bash
npm install
```

## CLI

```bash
node bin/syd-markmap-forge.mjs validate <input.json> [--json]
node bin/syd-markmap-forge.mjs render <input.json> [output.html] [--json]
node bin/syd-markmap-forge.mjs deliver <input.json> [output.html] [--json]
```

`deliver` validates, renders, and prints a SHA-256 receipt for both the JSON source and the HTML artifact.

## Input shape

See [`schemas/mindmap.schema.json`](./schemas/mindmap.schema.json) and [`examples/example.mindmap.json`](./examples/example.mindmap.json):

```json
{
  "schema_version": 1,
  "source_name": "Human-readable original title or filename",
  "generation_date": "2026-08-29",
  "markdown": "# Title\n## Pillar\n### Entity\n- detail\n",
  "views": [
    { "id": "intro", "label": "Overview", "focus": ["Pillar"], "note": "Optional caption for this tour stop." }
  ]
}
```

`markdown` is a strict outline: `#` title (exactly one), `##` pillars, `###` entities, `-` nested bullets. No tables, no stray arrows/pipes, no heading-level skips — the validator enforces all three as hard errors.

`views` is optional. Each `focus` string must appear (case-insensitive) somewhere in `markdown` — the validator rejects a tour stop that points at content that doesn't exist.

## Output

One self-contained HTML file (no build step, no server) with:

- Live search with match count and Ctrl+F
- Expand/Collapse and one button per detected heading depth
- Dark/light theme with persisted state (localStorage)
- Minimap with click-to-pan, drawing the tree's actual links so it reads as a real thumbnail, not just a dot scatter
- SVG export
- **PNG export** — a full-resolution, high-DPI (2x) raster of the whole map's bounding box, distinct from the raw SVG export. Renders through a foreignObject-free clone of the SVG (Chrome taints canvas exports of SVGs containing `<foreignObject>` HTML, even same-origin) so the rasterization never fails on real content.
- **Pitch Mode** (fullscreen focus-and-zoom on click) — automatically engages AutoFit so expanded nodes are framed instantly, no manual "Fit Window" needed.
- **Guided tour** — optional, authored via the `views` field: an ordered set of stops, each selectively folding the tree to the focal node's ancestors and its descendants down to a relative depth of N+2 (collapsing unrelated branches), with a single bold-highlighted focal node, a caption, and Prev/Next/Esc. Only shown when the source JSON declares at least one view. Ported from archify's views/focus concept.
- **Decorative animated links** — a toggleable subtle flowing dash along branches. Purely visual: unlike archify's flow animation, a mind map's branches are hierarchy, not directional dataflow, so this is honestly decorative, not a flow indicator.
- **Overlap-safe fitting** — the floating menu panels and minimap are fixed overlays with no native collision avoidance against the tree; every "fit" pans the tree clear of them once the fit animation has actually settled, instead of letting a node render (and stay hidden) underneath a panel.

Rendering is powered by [markmap](https://markmap.js.org) + d3, loaded from a CDN inside the generated HTML.

## Test

```bash
npm test
```

Unit tests cover the validator only. `npm run test:live` additionally renders `examples/example.mindmap.json` and loads it in a real headless Chrome (via raw CDP — no puppeteer dependency) to assert the interactive JS actually works: no node renders underneath the fixed menu panels after a fit, the minimap draws real tree links, and Tour/dark-mode/PNG-export all run without console errors. Needs a local Chrome install; skips with a message if none is found.

## Example

```bash
npm run render:example
```

Renders [`examples/example.mindmap.json`](./examples/example.mindmap.json) (a mind map describing this tool itself) to `examples/example.html`.
