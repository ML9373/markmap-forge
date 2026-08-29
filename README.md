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
  "variant": "exhaustive",
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
- Minimap with click-to-pan
- SVG export
- Pitch Mode (fullscreen focus-and-zoom on click)

Rendering is powered by [markmap](https://markmap.js.org) + d3, loaded from a CDN inside the generated HTML.

## Test

```bash
npm test
```

## Example

```bash
npm run render:example
```

Renders [`examples/example.mindmap.json`](./examples/example.mindmap.json) (a mind map describing this tool itself) to `examples/example.html`.
