import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
	readFileSync(path.join(__dirname, "..", "schemas", "mindmap.schema.json"), "utf8")
);

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

const STRAY_GLYPHS = ["↓", "->", "=>", "⇒", "→", "↔", "|"];
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function diag(code, severity, message) {
	return { code, severity, message };
}

function checkHeadingHierarchy(lines) {
	const diagnostics = [];
	let prevLevel = 0;
	let sawTitle = false;
	for (const [i, line] of lines.entries()) {
		const m = /^(#{1,6})\s+\S/.exec(line);
		if (!m) continue;
		const level = m[1].length;
		if (level === 1) {
			if (sawTitle) {
				diagnostics.push(
					diag("markdown/multiple-h1", "error", `line ${i + 1}: a second '#' title was found — exactly one H1 title is expected.`)
				);
			}
			sawTitle = true;
		}
		if (prevLevel > 0 && level > prevLevel + 1) {
			diagnostics.push(
				diag(
					"markdown/heading-skip",
					"error",
					`line ${i + 1}: heading level ${level} follows level ${prevLevel} directly — no heading-level skips allowed (fill the intermediate level or use a nested bullet instead).`
				)
			);
		}
		prevLevel = level;
	}
	if (!sawTitle) {
		diagnostics.push(diag("markdown/missing-title", "error", "no '#' (H1) title line found."));
	}
	return diagnostics;
}

function checkTables(lines) {
	const diagnostics = [];
	for (const [i, line] of lines.entries()) {
		if (TABLE_SEPARATOR_RE.test(line)) {
			diagnostics.push(
				diag("markdown/table", "error", `line ${i + 1}: looks like a Markdown table separator row — convert tables to nested bullets.`)
			);
		}
	}
	return diagnostics;
}

function checkStrayGlyphs(markdown) {
	const diagnostics = [];
	for (const glyph of STRAY_GLYPHS) {
		if (markdown.includes(glyph)) {
			const label = glyph === "|" ? "'|' (pipe)" : `'${glyph}'`;
			diagnostics.push(
				diag("markdown/stray-glyph", "error", `stray glyph ${label} found — arrows and pipes are not allowed outside this tool's own template; rewrite as prose or nested bullets.`)
			);
		}
	}
	return diagnostics;
}

function checkTemplateLiteralSafety(markdown) {
	const diagnostics = [];
	if (markdown.includes("`")) {
		diagnostics.push(
			diag("markdown/backtick", "warning", "backtick found in markdown — the renderer auto-escapes it, but consider rephrasing for readability.")
		);
	}
	if (markdown.includes("${")) {
		diagnostics.push(
			diag("markdown/template-interpolation", "warning", "'${' sequence found in markdown — the renderer auto-escapes it, but consider rephrasing for readability.")
		);
	}
	return diagnostics;
}

export function validateMindmap(data) {
	const diagnostics = [];

	const schemaOk = validateSchema(data);
	if (!schemaOk) {
		for (const err of validateSchema.errors ?? []) {
			diagnostics.push(diag("schema", "error", `${err.instancePath || "/"} ${err.message}`));
		}
		return { ok: false, diagnostics };
	}

	const lines = data.markdown.split(/\r?\n/);
	diagnostics.push(...checkHeadingHierarchy(lines));
	diagnostics.push(...checkTables(lines));
	diagnostics.push(...checkStrayGlyphs(data.markdown));
	diagnostics.push(...checkTemplateLiteralSafety(data.markdown));

	const errorCount = diagnostics.filter((d) => d.severity === "error").length;
	return { ok: errorCount === 0, diagnostics };
}
