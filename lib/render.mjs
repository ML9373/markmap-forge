import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inlineBrowserLibs } from "./browser-libs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "templates", "strategic-map.template.html");

function escapeHtml(str) {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeForTemplateLiteral(markdown) {
	return markdown.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function slugify(sourceName) {
	return sourceName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 60) || "mindmap";
}

// Function replacers only: a string replacement would expand "$&", "$'" and "$`" found in the
// content (a markdown line such as "R&D $'000" was silently rewritten before this).
function substitute(html, placeholder, value) {
	return html.replace(placeholder, () => value);
}

export function deriveOutputName(data) {
	if (data.output) return data.output;
	return `${slugify(data.source_name)}.html`;
}

export function renderMindmap(data) {
	const template = readFileSync(TEMPLATE_PATH, "utf8");
	let html = template;
	html = substitute(html, "[INSERT SANITIZED MARKDOWN HIERARCHY HERE]", escapeForTemplateLiteral(data.markdown));
	html = substitute(html, "[INSERT_SOURCE_NAME]", escapeHtml(data.source_name));
	html = substitute(html, "[INSERT_GENERATION_DATE]", data.generation_date);

	// Checked before the libraries go in, so nothing inside their code can mask a missed placeholder.
	const withoutLibSlot = html.replace("[INSERT_BROWSER_LIBS]", "");
	if (withoutLibSlot.includes("[INSERT")) {
		throw new Error("Template placeholder was not fully substituted — template and renderer are out of sync.");
	}
	if (!html.includes("[INSERT_BROWSER_LIBS]")) {
		throw new Error("Template has no [INSERT_BROWSER_LIBS] slot — template and renderer are out of sync.");
	}
	return substitute(html, "[INSERT_BROWSER_LIBS]", inlineBrowserLibs());
}
