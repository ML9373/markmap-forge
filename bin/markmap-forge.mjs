#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { validateMindmap } from "../lib/validate.mjs";
import { renderMindmap, deriveOutputName } from "../lib/render.mjs";

function sha256(buf) {
	return createHash("sha256").update(buf).digest("hex");
}

function loadJson(inputPath) {
	return JSON.parse(readFileSync(inputPath, "utf8"));
}

function printJson(obj) {
	process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function cmdValidate(inputPath, opts) {
	const data = loadJson(inputPath);
	const result = validateMindmap(data);
	if (opts.json) {
		printJson({ schemaVersion: 1, ok: result.ok, command: "validate", input: inputPath, diagnostics: result.diagnostics });
	} else {
		for (const d of result.diagnostics) {
			console.log(`[${d.severity}] ${d.code}: ${d.message}`);
		}
		console.log(result.ok ? "PASS" : "FAIL");
	}
	process.exit(result.ok ? 0 : 1);
}

function cmdRender(inputPath, outputArg, opts) {
	const data = loadJson(inputPath);
	const result = validateMindmap(data);
	if (!result.ok) {
		if (opts.json) {
			printJson({ schemaVersion: 1, ok: false, command: "render", input: inputPath, diagnostics: result.diagnostics });
		} else {
			for (const d of result.diagnostics) console.log(`[${d.severity}] ${d.code}: ${d.message}`);
			console.log("FAIL: fix validation errors before rendering.");
		}
		process.exit(1);
	}
	const outputPath = outputArg || deriveOutputName(data);
	const html = renderMindmap(data);
	writeFileSync(outputPath, html, "utf8");
	if (opts.json) {
		printJson({ schemaVersion: 1, ok: true, command: "render", input: inputPath, output: outputPath, bytes: Buffer.byteLength(html) });
	} else {
		console.log(`Rendered ${outputPath} (${Buffer.byteLength(html)} bytes)`);
	}
}

function cmdDeliver(inputPath, outputArg, opts) {
	const data = loadJson(inputPath);
	const result = validateMindmap(data);
	if (!result.ok) {
		if (opts.json) {
			printJson({ schemaVersion: 1, ok: false, command: "deliver", input: inputPath, diagnostics: result.diagnostics });
		} else {
			for (const d of result.diagnostics) console.log(`[${d.severity}] ${d.code}: ${d.message}`);
			console.log("FAIL: fix validation errors before delivering.");
		}
		process.exit(1);
	}
	const outputPath = outputArg || deriveOutputName(data);
	const html = renderMindmap(data);
	const specBytes = readFileSync(inputPath);
	writeFileSync(outputPath, html, "utf8");
	const receipt = {
		schemaVersion: 1,
		ok: true,
		command: "deliver",
		input: inputPath,
		output: outputPath,
		specification: { sha256: sha256(specBytes), bytes: specBytes.length },
		artifact: { sha256: sha256(Buffer.from(html, "utf8")), bytes: Buffer.byteLength(html) },
	};
	if (opts.json) {
		printJson(receipt);
	} else {
		console.log(`Delivered ${outputPath}`);
		console.log(`  spec sha256:     ${receipt.specification.sha256}`);
		console.log(`  artifact sha256: ${receipt.artifact.sha256}`);
	}
}

function parseArgs(argv) {
	const opts = { json: argv.includes("--json") };
	const positional = argv.filter((a) => a !== "--json");
	return { positional, opts };
}

function main() {
	const [, , command, ...rest] = process.argv;
	const { positional, opts } = parseArgs(rest);

	switch (command) {
		case "validate": {
			const [inputPath] = positional;
			if (!inputPath) return usageError("validate <input.json> [--json]");
			return cmdValidate(inputPath, opts);
		}
		case "render": {
			const [inputPath, outputPath] = positional;
			if (!inputPath) return usageError("render <input.json> [output.html] [--json]");
			return cmdRender(inputPath, outputPath, opts);
		}
		case "deliver": {
			const [inputPath, outputPath] = positional;
			if (!inputPath) return usageError("deliver <input.json> [output.html] [--json]");
			return cmdDeliver(inputPath, outputPath, opts);
		}
		default:
			return usageError();
	}
}

function usageError(specific) {
	console.error("Usage: markmap-forge <validate|render|deliver> <input.json> [output.html] [--json]");
	if (specific) console.error(`  markmap-forge ${specific}`);
	process.exit(2);
}

main();
