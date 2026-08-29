import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

export function deriveOutputName(data) {
	if (data.output) return data.output;
	return `${slugify(data.source_name)}.html`;
}

function safeJsonForScript(value) {
	return JSON.stringify(value ?? []).replace(/</g, "\\u003c");
}

export function renderMindmap(data) {
	const template = readFileSync(TEMPLATE_PATH, "utf8");
	const escapedMarkdown = escapeForTemplateLiteral(data.markdown);
	const html = template
		.replace("[INSERT SANITIZED MARKDOWN HIERARCHY HERE]", escapedMarkdown)
		.replace("[INSERT_SOURCE_NAME]", escapeHtml(data.source_name))
		.replace("[INSERT_GENERATION_DATE]", data.generation_date)
		.replace("[INSERT_VIEWS_JSON]", safeJsonForScript(data.views));

	if (html.includes("[INSERT")) {
		throw new Error("Template placeholder was not fully substituted — template and renderer are out of sync.");
	}
	return html;
}
