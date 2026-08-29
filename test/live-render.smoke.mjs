// Real-runtime smoke test: renders examples/example.mindmap.json, loads the artifact in a
// live headless Chrome via raw CDP (no puppeteer dependency — Node's built-in fetch/WebSocket
// talk to Chrome's debugging protocol directly), and asserts the interactive JS actually works.
// Not part of `npm test` (needs a local Chrome install) — run explicitly via `npm run test:live`.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const EXAMPLE_HTML = path.join(REPO_ROOT, "examples", "example.html");

const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium-browser",
	"/usr/bin/chromium",
];

function findChrome() {
	return CHROME_CANDIDATES.find((p) => existsSync(p));
}

class CdpSession {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		this.consoleMessages = [];
		ws.onmessage = (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id && this.pending.has(msg.id)) {
				this.pending.get(msg.id)(msg);
				this.pending.delete(msg.id);
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

async function main() {
	const chromePath = findChrome();
	if (!chromePath) {
		console.log("SKIP live-render smoke test: no local Chrome install found (checked: " + CHROME_CANDIDATES.join(", ") + ")");
		return;
	}

	const profileDir = mkdtempSync(path.join(tmpdir(), "syd-markmap-forge-smoke-"));
	const port = 9222 + Math.floor(Math.random() * 1000);
	const chrome = spawn(chromePath, [
		"--headless=new",
		`--remote-debugging-port=${port}`,
		"--disable-gpu",
		"--window-size=1600,1000",
		`--user-data-dir=${profileDir}`,
		"--no-first-run",
		`file://${EXAMPLE_HTML}`,
	], { stdio: "ignore" });

	let session;
	try {
		await sleep(1200);
		const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
		const page = list.find((t) => t.type === "page");
		assert.ok(page, "no page target found in Chrome");
		const ws = new WebSocket(page.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
		session = new CdpSession(ws);
		await session.send("Runtime.enable");
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

		const errors = session.consoleMessages.filter((m) => m.startsWith("[error]") || m.startsWith("[exception]"));
		assert.equal(errors.length, 0, "console errors during interaction:\n" + errors.join("\n"));

		console.log("✔ live-render smoke test passed (page load, overlap-avoidance, tour/minimap absent, dark mode, PNG export — zero console errors)");
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
