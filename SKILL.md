---
name: syd-markmap-forge
description: Convert a technical document (specs, slides, PDFs, markdown) into ONE standalone interactive HTML5 Strategic Mind Map — a complete knowledge model of the source. Use when the user wants a document turned into an explorable mind map with search, dark mode, minimap, pitch mode, and SVG export instead of a slide deck.
license: MIT
metadata:
  version: "0.2"
  author: Mouiz Lanikpekoun
  origin: private evolution of the ad hoc "Project HTML Converter" prompt pipeline (SYDRVAULT)
---

# Syd Markmap Forge

Turn a source document into a small typed JSON object; a deterministic renderer compiles it into the standalone interactive HTML. The agent never hand-writes HTML, CSS, or JS for the output — only the JSON.

## Why this exists

The prior approach asked an LLM to reproduce a ~500-line HTML/CSS/JS template verbatim on every run, with only a markdown string and two metadata fields actually varying. That put template fidelity at the mercy of one-shot generation, and left the "no stray backtick or `${...}`" rule as an unenforced, easy-to-miss instruction. Here the template is a static asset (`templates/strategic-map.template.html`); the renderer injects content and escapes it correctly every time.

## Fast authoring path

1. Read the source document (raw or already-sanitized markdown in the vault).
2. Produce a sanitized Markdown hierarchy: `#` title (exactly one), `##` pillars, `###` entities/topics, `-` nested detail bullets. MECE, strictly source-based. No tables (use nested bullets instead), no stray arrows/glyphs (`↓ -> => |`), no heading-level skips. Mark true gaps as `**Unknown / Not specified**: <what's missing>` and inferred structure as `**Assumption**`. Never invent content.
3. Write the candidate JSON matching `schemas/mindmap.schema.json`. The map is always exhaustive: every definition, dependency, association, constraint, warning, and value list present in the source.
   ```json
   {
     "schema_version": 1,
     "source_name": "Human-readable original title or filename",
     "generation_date": "YYYY-MM-DD",
     "markdown": "# Title\n## Pillar\n### Entity\n- detail\n"
   }
   ```
   Optionally add `views` — an authored guided tour (ported from archify's views/focus concept), an ordered array of `{ id, label, focus: [string, ...], note }`. Only add a view when the user wants a scripted walkthrough (e.g. for a live pitch); most documents don't need one. Every `focus` string must be a substring that genuinely appears in `markdown` — never invent a tour stop pointing at content that isn't there, the validator rejects it anyway.
4. Validate:
   ```bash
   node bin/syd-markmap-forge.mjs validate candidate.mindmap.json --json
   ```
   Fix only the diagnosed lines; errors block delivery, warnings (backtick / `${` sequences) are auto-escaped by the renderer but worth a readability pass.
5. Deliver once validation passes:
   ```bash
   node bin/syd-markmap-forge.mjs deliver candidate.mindmap.json output.html --json
   ```
   This re-validates, renders, and reports a SHA-256 receipt for both the JSON source and the HTML artifact. A non-zero exit is never success.
6. Open the delivered HTML and sanity-check it (see `examples/example.html` for a working reference) before handing it back.

## What's fixed vs. authored

Fixed by the template (never author these): the CSS theme variables, the menu layout, the markmap/d3 CDN includes, and all interaction JS (search, dark mode, minimap, pitch mode, SVG export, per-depth expand buttons, localStorage state).

Authored per document: `source_name`, `generation_date`, and the sanitized `markdown` outline (plus optional `views`). That's the entire surface area — resist the temptation to touch `templates/strategic-map.template.html` for a one-off document; if the template itself needs a new feature, that's a renderer change, reviewed and tested once, not a per-document improvisation.

## Multiple documents, one theme

For a set of related documents (e.g. one per industry vertical, or one per subsystem), render each to its own `<title>.html` — do not try to merge unrelated sources into one mind map; that breaks the "strictly source-based" and MECE rules from step 2.
