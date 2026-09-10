import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BROWSER_VENDOR_DIR = path.join(__dirname, "..", "vendor", "browser");

/**
 * The three browser libraries every delivered map needs, pinned and shipped inside the package.
 *
 * They used to be loaded at view time from cdn.jsdelivr.net, unpinned. Corporate web filters
 * block that CDN (Cisco Umbrella does on at least one enterprise network the maps are used on),
 * and a blocked script arrives as an HTML "Site Blocked" page: markmap never defines
 * `Transformer`, the page throws, and the map renders empty with no visible error. Inlining
 * them makes a delivered file work offline and behind any proxy.
 *
 * Order matters: markmap-view reads the `d3` global, markmap-lib and markmap-view both attach
 * to `window.markmap`. Regenerate the files with `npm run vendor:browser` after bumping a version.
 */
export const BROWSER_LIBS = [
	{ pkg: "d3", version: "7.9.0", entry: "dist/d3.min.js", file: "d3.min.js", minify: false, license: "ISC" },
	{ pkg: "markmap-lib", version: "0.18.12", entry: "dist/browser/index.iife.js", file: "markmap-lib.min.js", minify: true, license: "MIT" },
	{ pkg: "markmap-view", version: "0.18.12", entry: "dist/browser/index.js", file: "markmap-view.min.js", minify: true, license: "MIT" },
];

export function readBrowserLib(lib) {
	const code = readFileSync(path.join(BROWSER_VENDOR_DIR, lib.file), "utf8");
	// An inline script ends at the first "</script", wherever it appears, string literals included.
	if (/<\/script/i.test(code)) {
		throw new Error(`vendor/browser/${lib.file} contains "</script" and cannot be inlined safely.`);
	}
	return code;
}

export function inlineBrowserLibs() {
	return BROWSER_LIBS.map((lib) =>
		`<script>/* ${lib.pkg}@${lib.version} (${lib.license}), inlined by markmap-forge: no CDN at view time */\n${readBrowserLib(lib)}\n</script>`
	).join("\n");
}
