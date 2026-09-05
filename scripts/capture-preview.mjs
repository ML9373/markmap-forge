#!/usr/bin/env node
/**
 * Regenerates docs/preview.png from examples/example.html, so the README screenshot is a
 * real render of the current template rather than a stale hand-taken capture.
 *
 * Uses the same raw-CDP approach and the same window size as test/live-render.smoke.mjs,
 * and the same 2s settle wait: the template's overlap-safe fit runs on requestAnimationFrame,
 * so a plain `chrome --screenshot --virtual-time-budget` capture fast-forwards past it and
 * writes an unfitted, near-empty map.
 *
 * Run: npm run capture:preview   (needs a local Chrome install; skips cleanly without one)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");
const EXAMPLE_HTML = path.join(REPO_ROOT, "examples", "example.html");
const OUT = path.join(REPO_ROOT, "docs", "preview.png");

const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium-browser",
	"/usr/bin/chromium",
];

const findChrome = () => CHROME_CANDIDATES.find((p) => existsSync(p));

class CdpSession {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		ws.onmessage = (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id && this.pending.has(msg.id)) {
				this.pending.get(msg.id)(msg);
				this.pending.delete(msg.id);
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
}

async function main() {
	const chromePath = findChrome();
	if (!chromePath) {
		console.log("SKIP capture: no local Chrome install found.");
		return;
	}
	if (!existsSync(EXAMPLE_HTML)) {
		console.error("Missing examples/example.html. Run `npm run render:example` first.");
		process.exit(1);
	}

	const profileDir = mkdtempSync(path.join(tmpdir(), "markmap-forge-capture-"));
	const port = 9222 + Math.floor(Math.random() * 1000);
	const chrome = spawn(chromePath, [
		"--headless=new",
		`--remote-debugging-port=${port}`,
		"--disable-gpu",
		"--hide-scrollbars",
		"--window-size=1600,1000",
		`--user-data-dir=${profileDir}`,
		"--no-first-run",
		`file://${EXAMPLE_HTML}`,
	], { stdio: "ignore" });

	try {
		await sleep(1200);
		const list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
		const page = list.find((t) => t.type === "page");
		if (!page) throw new Error("no page target found in Chrome");
		const ws = new WebSocket(page.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
		const session = new CdpSession(ws);
		await session.send("Page.enable");
		// Same settle window as the smoke test: let markmap render and the overlap-safe fit finish.
		await sleep(2000);

		const shot = await session.send("Page.captureScreenshot", { format: "png" });
		const data = shot.result?.data;
		if (!data) throw new Error("captureScreenshot returned no data");
		mkdirSync(path.dirname(OUT), { recursive: true });
		writeFileSync(OUT, Buffer.from(data, "base64"));
		console.log(`wrote ${path.relative(REPO_ROOT, OUT)}`);
		ws.close();
	} finally {
		chrome.kill();
		// Chrome can still hold files in the temp profile for a moment after kill(); a failed
		// cleanup of a temp dir must never fail the capture that already succeeded.
		await sleep(300);
		try {
			rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		} catch {
			// best effort - the OS reclaims tmpdir anyway
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
