// Rebuild vendor/browser/ from the pinned versions in lib/browser-libs.mjs.
// Maintainer-only: needs network access to registry.npmjs.org and npx (for esbuild).
// Each tarball is checked against the registry's sha512 integrity before anything is extracted.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { BROWSER_LIBS, BROWSER_VENDOR_DIR } from "../lib/browser-libs.mjs";

const ESBUILD = "esbuild@0.23.1";

// Minimal ustar reader: npm tarballs are plain ustar, every file under "package/".
function untar(buf) {
	const files = new Map();
	for (let off = 0; off + 512 <= buf.length; ) {
		const header = buf.subarray(off, off + 512);
		if (header.every((b) => b === 0)) break;
		const field = (start, len) => header.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "");
		const name = (field(345, 155) ? field(345, 155) + "/" : "") + field(0, 100);
		const size = parseInt(field(124, 12).trim() || "0", 8);
		const type = field(156, 1);
		if (type === "0" || type === "") files.set(name, buf.subarray(off + 512, off + 512 + size));
		off += 512 + Math.ceil(size / 512) * 512;
	}
	return files;
}

// On Windows npx is a .cmd shim, which Node only runs through a shell; the command line is then
// assembled as one string, so each argument is quoted by hand.
function runNpx(args) {
	if (process.platform !== "win32") return execFileSync("npx", args, { stdio: "inherit" });
	const cmd = ["npx", ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(" ");
	return execSync(cmd, { stdio: "inherit" });
}

mkdirSync(BROWSER_VENDOR_DIR, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), "markmap-forge-vendor-"));
try {
	for (const lib of BROWSER_LIBS) {
		const meta = await (await fetch(`https://registry.npmjs.org/${lib.pkg}/${lib.version}`)).json();
		const tgz = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
		const [algo, expected] = meta.dist.integrity.split("-");
		const actual = createHash(algo).update(tgz).digest("base64");
		if (actual !== expected) throw new Error(`${lib.pkg}@${lib.version}: tarball integrity mismatch`);

		const files = untar(gunzipSync(tgz));
		const entry = files.get(`package/${lib.entry}`);
		if (!entry) throw new Error(`${lib.pkg}@${lib.version}: ${lib.entry} not found in tarball`);
		const licenseName = [...files.keys()].find((n) => /^package\/licen[cs]e(\.md|\.txt)?$/i.test(n));
		if (!licenseName) throw new Error(`${lib.pkg}@${lib.version}: no LICENSE file in tarball`);

		const outPath = path.join(BROWSER_VENDOR_DIR, lib.file);
		if (lib.minify) {
			const src = path.join(work, `${lib.pkg}.js`);
			writeFileSync(src, entry);
			runNpx(["-y", ESBUILD, src, "--minify", "--legal-comments=inline", `--outfile=${outPath}`]);
		} else {
			writeFileSync(outPath, entry);
		}
		writeFileSync(path.join(BROWSER_VENDOR_DIR, `${lib.pkg}.LICENSE`), files.get(licenseName));
		const sha = createHash("sha256").update(readFileSync(outPath)).digest("hex");
		console.log(`${lib.pkg}@${lib.version} -> vendor/browser/${lib.file} (${readFileSync(outPath).length} bytes, sha256 ${sha})`);
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}
