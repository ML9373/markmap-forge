// Real-runtime smoke test: renders examples/example.mindmap.json, loads the artifact in a
// live headless Chrome via raw CDP (no puppeteer dependency — Node's built-in fetch/WebSocket
// talk to Chrome's debugging protocol directly), and asserts the interactive JS actually works.
// Not part of `npm test` (needs a local Chrome install) — run explicitly via `npm run test:live`.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const EXAMPLE_HTML = path.join(REPO_ROOT, "examples", "example.html");

const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium-browser",
	"/usr/bin/chromium",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

// Web fonts are the one network fetch the page may make: every font stack has a local
// fallback, so a blocked request changes the typeface, never whether the map renders.
const ALLOWED_REMOTE_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

function findChrome() {
	return CHROME_CANDIDATES.find((p) => existsSync(p));
}

class CdpSession {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		this.consoleMessages = [];
		this.requests = [];
		ws.onmessage = (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id && this.pending.has(msg.id)) {
				this.pending.get(msg.id)(msg);
				this.pending.delete(msg.id);
			} else if (msg.method === "Network.requestWillBeSent") {
				this.requests.push(msg.params.request.url);
			} else if (msg.method === "Runtime.consoleAPICalled") {
				const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
				this.consoleMessages.push(`[${msg.params.type}] ${args}`);
			} else if (msg.method === "Runtime.exceptionThrown") {
				const d = msg.params.exceptionDetails;
				this.consoleMessages.push(`[exception] ${d.text} ${d.exception?.description ?? ""}`);
			}
		};
	}
	send(method, params = {}) {
		return new Promise((resolve) => {
			const thisId = ++this.id;
			this.pending.set(thisId, resolve);
			this.ws.send(JSON.stringify({ id: thisId, method, params }));
		});
	}
	async evalJs(expression) {
		const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (res.result?.exceptionDetails) throw new Error("page eval threw: " + res.result.exceptionDetails.text);
		return res.result?.result?.value;
	}
}

/**
 * On a CI runner Chrome cannot use its sandbox (no user namespaces in the container) and
 * exits immediately, which used to surface only as `ECONNREFUSED` on the debugging port.
 * Local runs keep the sandbox on.
 */
function chromeSandboxFlags() {
	return process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
}

/**
 * Poll the CDP endpoint until Chrome is up instead of assuming a fixed startup delay: a cold
 * CI runner is routinely slower than any hardcoded sleep, and a single fetch turns that into
 * a hard failure.
 */
async function waitForPageTarget(port, chrome, getStderr, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	let lastErr;
	while (Date.now() < deadline) {
		if (chrome.exitCode !== null) {
			throw new Error(
				`Chrome exited with code ${chrome.exitCode} before the debugging port opened.\n` +
				`stderr:\n${getStderr() || "(empty)"}`
			);
		}
		try {
			const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
			const page = list.find((t) => t.type === "page");
			if (page) return page;
		} catch (e) {
			lastErr = e;
		}
		await sleep(250);
	}
	throw new Error(
		`Chrome debugging port ${port} never became available within ${timeoutMs} ms ` +
		`(last error: ${lastErr?.message ?? "none"}).\nstderr:\n${getStderr() || "(empty)"}`
	);
}

async function main() {
	const chromePath = findChrome();
	if (!chromePath) {
		console.log("SKIP live-render smoke test: no local Chrome install found (checked: " + CHROME_CANDIDATES.join(", ") + ")");
		return;
	}

	const profileDir = mkdtempSync(path.join(tmpdir(), "markmap-forge-smoke-"));
	const port = 9222 + Math.floor(Math.random() * 1000);
	const chrome = spawn(chromePath, [
		"--headless=new",
		`--remote-debugging-port=${port}`,
		"--disable-gpu",
		"--window-size=1600,1000",
		`--user-data-dir=${profileDir}`,
		"--no-first-run",
		...chromeSandboxFlags(),
		// Start blank and navigate once Network is enabled, so the page's own first requests
		// are recorded too.
		"about:blank",
	], { stdio: ["ignore", "ignore", "pipe"] });

	// Keep Chrome's stderr so a launch failure says why instead of surfacing as a bare
	// ECONNREFUSED on the debugging port.
	let chromeStderr = "";
	chrome.stderr?.on("data", (d) => { chromeStderr += d.toString(); });

	let session;
	try {
		const page = await waitForPageTarget(port, chrome, () => chromeStderr);
		assert.ok(page, "no page target found in Chrome");
		const ws = new WebSocket(page.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
		session = new CdpSession(ws);
		await session.send("Runtime.enable");
		await session.send("Network.enable");
		await session.send("Page.navigate", { url: pathToFileURL(EXAMPLE_HTML).href });
		await sleep(2000); // let markmap render + the overlap-safe fit settle

		// The page must load and render without throwing.
		const h1 = await session.evalJs("document.querySelector('.markmap-node')?.textContent");
		assert.ok(h1 && h1.length > 0, "root node did not render");

		// Regression guard: no node should render underneath the fixed menu panels
		// (this was a real bug — see the 2026-08-30 template fix).
		const overlap = await session.evalJs(`
			(function() {
				const menuLeft = document.querySelector('.menu-left').getBoundingClientRect();
				const menuRight = document.querySelector('.menu-right').getBoundingClientRect();
				const reservedTop = Math.max(menuLeft.bottom, menuRight.bottom) + 8;
				const rects = Array.from(document.querySelectorAll('#markmap g.markmap-node .markmap-foreign'))
					.map(el => el.getBoundingClientRect());
				return rects.some(r => r.top < reservedTop && r.bottom > 0 &&
					!(r.right < menuLeft.left && r.right < menuRight.left) &&
					(r.left < menuLeft.right || r.left < menuRight.right));
			})()
		`);
		assert.equal(overlap, false, "a node rendered underneath the fixed menu panels after fit");

		// Tour Mode and the minimap were removed 2026-08-30 (dead end, never worked reliably
		// despite repeated fixes) — assert they no longer exist rather than exercising them.
		const removed = await session.evalJs(`
			({
				tourFn: typeof window.toggleTour,
				minimapFn: typeof window.toggleMinimap,
				minimapEl: !!document.getElementById('minimap'),
				tourBarEl: !!document.getElementById('tour-bar'),
			})
		`);
		assert.equal(removed.tourFn, "undefined", "window.toggleTour still exists — Tour Mode was supposed to be fully removed");
		assert.equal(removed.minimapFn, "undefined", "window.toggleMinimap still exists — the minimap was supposed to be fully removed");
		assert.equal(removed.minimapEl, false, "#minimap element still exists in the template");
		assert.equal(removed.tourBarEl, false, "#tour-bar element still exists in the template");

		// Dark mode, search, and PNG export must all run without throwing.
		await session.evalJs("window.toggleTheme()");
		await sleep(150);
		const theme = await session.evalJs("document.body.getAttribute('data-theme')");
		assert.equal(theme, "dark", "dark mode did not toggle");

		const pngClicked = await session.evalJs(`
			new Promise((resolve) => {
				const orig = HTMLAnchorElement.prototype.click;
				let clicked = false;
				HTMLAnchorElement.prototype.click = function() { clicked = true; };
				try {
					window.exportPNG();
					setTimeout(() => { HTMLAnchorElement.prototype.click = orig; resolve(clicked); }, 600);
				} catch (e) { HTMLAnchorElement.prototype.click = orig; resolve('ERROR: ' + e.message); }
			})
		`);
		assert.equal(pngClicked, true, "PNG export did not trigger a download");

		// Violet palette: switching palette must repaint the branches AND move the
		// accent with it, otherwise the previous palette's accent stays on the root and the
		// bold text (the bug this pairing was written to prevent).
		await session.evalJs("window.changePalette('violet')");
		await sleep(1500); // d3 interpolates the stroke color over the transition — read only once it has settled
		const palette = await session.evalJs(`
			(function() {
				const toRgb = (hex) => {
					const n = parseInt(hex.slice(1), 16);
					return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
				};
				const violet = ['#6d28d9', '#9d5cf0', '#4f46e5', '#c026d3', '#7c3aed', '#a78bfa'].map(toRgb);
				const strokes = Array.from(document.querySelectorAll('#markmap path.markmap-link'))
					.map(el => el.getAttribute('stroke') || '');
				return {
					accent: getComputedStyle(document.body).getPropertyValue('--root-color').trim(),
					activeBtn: getComputedStyle(document.body).getPropertyValue('--btn-active-bg').trim(),
					count: strokes.length,
					strays: Array.from(new Set(strokes.filter(c => !violet.includes(c)))),
				};
			})()
		`);
		assert.equal(palette.accent.toLowerCase(), '#b18cf5', "the Violet palette did not move the dark-mode accent onto --root-color");
		assert.equal(palette.activeBtn.toLowerCase(), '#b18cf5', "the active-button fill did not follow the palette accent");
		assert.ok(palette.count > 0, "no branch links found to check the palette against");
		assert.deepEqual(palette.strays, [], "branches kept a non-Violet color after switching palette");

		// Source editor: editing the markdown must rebuild the tree from the same transformer
		// that produced the file, and a bad source must fail loudly instead of blanking the map.
		const opened = await session.evalJs(`
			(function() {
				window.toggleEditor();
				return {
					open: document.getElementById('editor-panel').classList.contains('open'),
					prefilled: document.getElementById('editor-text').value.length > 0,
				};
			})()
		`);
		assert.equal(opened.open, true, "the editor panel did not open");
		assert.equal(opened.prefilled, true, "the editor opened empty instead of prefilled with the current markdown");

		const EDITED = ['# Edited Root', '## Only Pillar', '- **Key**: value', ''].join('\n');
		await session.evalJs(`document.getElementById('editor-text').value = ${JSON.stringify(EDITED)}; window.applyEditor();`);
		await sleep(900);
		const edited = await session.evalJs(`({ labels: Array.from(document.querySelectorAll('#markmap g.markmap-node .markmap-foreign > div')).map(el => el.textContent), levels: document.querySelectorAll('#levels-container button').length })`);
		assert.ok(edited.labels.includes('Edited Root'), 'the edited markdown did not become the new root: ' + edited.labels.join(' | '));
		assert.equal(edited.levels, 2, 'the Level buttons did not follow the edited tree\u2019s depth');

		// A source with no heading must be refused, leaving the previous map on screen.
		await session.evalJs("document.getElementById('editor-text').value = 'no heading at all'; window.applyEditor();");
		await sleep(400);
		const refused = await session.evalJs(`({ labels: Array.from(document.querySelectorAll('#markmap g.markmap-node .markmap-foreign > div')).map(el => el.textContent), status: document.getElementById('editor-status').className })`);
		assert.ok(refused.labels.includes('Edited Root'), 'a source with no heading wiped the map instead of being refused');
		assert.equal(refused.status, 'error', 'a source with no heading did not report an error');

		await session.evalJs('window.revertEditor()');
		await sleep(900);
		const reverted = await session.evalJs(`Array.from(document.querySelectorAll('#markmap g.markmap-node .markmap-foreign > div')).map(el => el.textContent)`);
		assert.ok(reverted.length > edited.labels.length, 'Revert did not restore the original, larger tree');

		// A formula or a fenced code block used to make markmap pull KaTeX and highlight.js from
		// cdn.jsdelivr.net. Both plugins are disabled: the content must still show, as plain text.
		const FEATURES = ['# Features', '## Math', '- formula $E=mc^2$', '## Code', '```js', 'const a = 1;', '```', ''].join('\n');
		await session.evalJs(`document.getElementById('editor-text').value = ${JSON.stringify(FEATURES)}; window.applyEditor();`);
		await sleep(1500);
		const featureText = await session.evalJs(`document.getElementById('markmap').textContent`);
		assert.ok(featureText.includes('E=mc^2'), 'the formula disappeared instead of showing as text');
		assert.ok(featureText.includes('const a = 1;'), 'the code block disappeared');
		await session.evalJs('window.revertEditor()');
		await sleep(600);

		// The map must render without a single request to a CDN: a blocked host (corporate web
		// filters do block cdn.jsdelivr.net) would otherwise leave the page empty.
		const remote = session.requests
			.filter((u) => /^https?:/i.test(u))
			.filter((u) => !ALLOWED_REMOTE_HOSTS.has(new URL(u).hostname));
		assert.deepEqual(remote, [], "the page made network requests outside the web-font allowlist");
		assert.ok(session.requests.some((u) => u.startsWith("file:")), "request capture recorded nothing, so the check above proves nothing");

		const errors = session.consoleMessages.filter((m) => m.startsWith("[error]") || m.startsWith("[exception]"));
		assert.equal(errors.length, 0, "console errors during interaction:\n" + errors.join("\n"));

		console.log("✔ live-render smoke test passed (page load, overlap-avoidance, tour/minimap absent, dark mode, PNG export, Violet palette + accent, source editor apply/refuse/revert, math/code without CDN, no network beyond web fonts — zero console errors)");
	} finally {
		if (session) session.ws.close();
		chrome.kill();
		await sleep(300); // let Chrome fully release its profile-dir lock files before cleanup
		try {
			rmSync(profileDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup of a scratch temp dir; the OS reclaims /tmp regardless.
		}
	}
}

await main();
