import test from "node:test";
import assert from "node:assert/strict";
import { renderMindmap } from "../lib/render.mjs";
import { BROWSER_LIBS } from "../lib/browser-libs.mjs";

const base = {
	schema_version: 1,
	source_name: "Test Doc",
	generation_date: "2026-09-10",
};

function embeddedMarkdown(html) {
	const start = html.indexOf("const markdown = `\n") + "const markdown = `\n".length;
	return html.slice(start, html.indexOf("\n`;", start));
}

test("the rendered file loads no script from the network", () => {
	const html = renderMindmap({ ...base, markdown: "# Title\n## Pillar\n- detail\n" });
	assert.equal(/<script[^>]*\ssrc=/i.test(html), false, "a <script src> survived in the output");
	assert.equal(html.includes("cdn.jsdelivr.net/npm/d3"), false);
	assert.equal(html.includes("cdn.jsdelivr.net/npm/markmap-"), false);
	for (const lib of BROWSER_LIBS) {
		assert.ok(html.includes(`/* ${lib.pkg}@${lib.version} (${lib.license}), inlined by markmap-forge`), `${lib.pkg} is not inlined`);
	}
});

test("the libraries are inlined before the page script that uses them", () => {
	const html = renderMindmap({ ...base, markdown: "# Title\n" });
	const positions = BROWSER_LIBS.map((lib) => html.indexOf(`/* ${lib.pkg}@`));
	assert.deepEqual([...positions].sort((a, b) => a - b), positions, "libraries are not in dependency order");
	assert.ok(positions.at(-1) < html.indexOf("const markdown = `"), "a library comes after the page script");
});

test("KaTeX and highlight.js stay disabled, since both fetch from a CDN at view time", () => {
	const html = renderMindmap({ ...base, markdown: "# Title\n" });
	assert.ok(html.includes("builtInPlugins.filter((p) => p.name !== 'katex' && p.name !== 'hljs')"));
});

test("dollar sequences in the content are kept verbatim", () => {
	const markdown = "# Budget\n## Costs\n- **R&D**: $'000 and $& and $` and $$ and $1\n";
	const html = renderMindmap({ ...base, markdown });
	assert.equal(embeddedMarkdown(html), markdown.replace(/`/g, "\\`"));
});

test("every template placeholder is substituted", () => {
	const html = renderMindmap({ ...base, markdown: "# Title\n" });
	assert.equal(html.includes("[INSERT"), false);
});
