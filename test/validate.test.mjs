import test from "node:test";
import assert from "node:assert/strict";
import { validateMindmap } from "../lib/validate.mjs";

const base = {
	schema_version: 1,
	source_name: "Test Doc",
	generation_date: "2026-08-29",
};

test("valid document passes", () => {
	const result = validateMindmap({ ...base, markdown: "# Title\n## Pillar\n### Entity\n- detail\n" });
	assert.equal(result.ok, true);
	assert.equal(result.diagnostics.length, 0);
});

test("heading level skip is rejected", () => {
	const result = validateMindmap({ ...base, markdown: "# Title\n#### Skipped\n" });
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some((d) => d.code === "markdown/heading-skip"));
});

test("markdown table is rejected", () => {
	const result = validateMindmap({ ...base, markdown: "# Title\n## Pillar\n|---|---|\n" });
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some((d) => d.code === "markdown/table"));
});

test("stray arrow glyph is rejected", () => {
	const result = validateMindmap({ ...base, markdown: "# Title\n## Pillar\n- a -> b\n" });
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some((d) => d.code === "markdown/stray-glyph"));
});

test("missing title is rejected", () => {
	const result = validateMindmap({ ...base, markdown: "## Pillar only\n" });
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some((d) => d.code === "markdown/missing-title"));
});

test("backtick triggers a warning, not a failure", () => {
	const result = validateMindmap({ ...base, markdown: "# Title\n## Pillar\n- code `snippet`\n" });
	assert.equal(result.ok, true);
	assert.ok(result.diagnostics.some((d) => d.code === "markdown/backtick" && d.severity === "warning"));
});

test("schema violation is rejected", () => {
	const result = validateMindmap({ ...base, schema_version: 2, markdown: "# Title\n" });
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some((d) => d.code === "schema"));
});

test("a views field is rejected (Tour Mode removed 2026-08-30, no longer part of the schema)", () => {
	const result = validateMindmap({
		...base,
		markdown: "# Title\n## Pillar\n- detail about widgets\n",
		views: [{ id: "v1", label: "Widgets", focus: ["widgets"], note: "n" }],
	});
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some((d) => d.code === "schema"));
});
