import {STORY_IMAGES_BASE} from './twine-images';

// What a sealed frame may do: run scripts (SugarCube is one). Deliberately
// missing: allow-same-origin, so the frame gets its own empty origin, and
// allow-modals, so story code can't put up alert/confirm/prompt boxes over the
// app's address (a prompt for a wallet phrase would look like ours).
// SugarCube's own fatal errors use alert(); DIALOG_SHIM shows them in the page.
export const SEALED_FRAME_SANDBOX = 'allow-scripts';

// The frame's own content rules, the first thing in its head. The story needs
// nothing from outside but its images, so story code that slips past the story
// check still can't send anything anywhere: no fetch/XHR/beacon/WebSocket
// (connect-src), no forms, no fonts or styles from outside, images only from
// the story image bucket. Inline script and eval stay: SugarCube is inline and
// evaluates the story's expressions. (A frame can still navigate itself; CSP
// has no rule for that.)
export const SEALED_FRAME_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline' 'unsafe-eval'",
	"style-src 'unsafe-inline'",
	`img-src ${STORY_IMAGES_BASE} data:`,
	'font-src data:',
	"connect-src 'none'",
	"form-action 'none'",
	"base-uri 'none'"
].join('; ');

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${SEALED_FRAME_CSP}">`;

// Without allow-modals alert() does nothing, which would hide SugarCube's
// fatal errors. This shows each message in a box at the bottom of the story
// page instead (as text, never markup; a click closes it).
export const DIALOG_SHIM =
	'<script>(function () {' +
	'window.alert = function (message) {' +
	"var box = document.createElement('div'); var s = box.style;" +
	"box.setAttribute('role', 'alert');" +
	"s.position = 'fixed'; s.left = '0'; s.right = '0'; s.bottom = '0'; s.zIndex = '2147483647';" +
	"s.maxHeight = '50%'; s.overflow = 'auto'; s.padding = '0.75em 1em'; s.background = '#5a1010';" +
	"s.color = '#fff'; s.font = '14px/1.4 sans-serif'; s.whiteSpace = 'pre-wrap'; s.cursor = 'pointer';" +
	'box.textContent = String(message);' +
	"box.addEventListener('click', function () { box.remove(); });" +
	'(document.body || document.documentElement).appendChild(box); };' +
	'})();</script>';

// A sealed frame has no Web Storage (reading localStorage throws), and
// SugarCube refuses to start without it ("All usable storage APIs are
// missing"). This runs first inside the frame and puts in-memory stores in
// place, so the story's own saves and history last as long as the tab.
export const MEMORY_STORAGE_SHIM =
	'<script>(function () {' +
	'function MemoryStorage() { var d = Object.create(null); return {' +
	'get length() { return Object.keys(d).length; },' +
	'key: function (i) { var k = Object.keys(d); return i < k.length ? k[i] : null; },' +
	'getItem: function (k) { k = String(k); return k in d ? d[k] : null; },' +
	'setItem: function (k, v) { d[String(k)] = String(v); },' +
	'removeItem: function (k) { delete d[String(k)]; },' +
	'clear: function () { d = Object.create(null); } }; }' +
	"['localStorage', 'sessionStorage'].forEach(function (name) {" +
	'try { window[name].length; } catch (e) {' +
	'try { Object.defineProperty(window, name, {value: MemoryStorage(), configurable: true}); } catch (e2) {} } });' +
	'})();</script>';

/** What goes first in the frame's head: its content rules, then the shims. */
export const SEALED_FRAME_HEAD = CSP_META + DIALOG_SHIM + MEMORY_STORAGE_SHIM;

/**
 * The story page as the sealed frame gets it: the content rules and the
 * shims at the top of its head, before anything in the page runs or loads.
 */
export function sealedPage(html: string): string {
	return /<head[^>]*>/i.test(html)
		? html.replace(/<head[^>]*>/i, head => head + SEALED_FRAME_HEAD)
		: SEALED_FRAME_HEAD + html;
}

// Test, Run here, Play and Proof show a story by replacing this tab's page with
// it. The story's code (its Story JavaScript, and every <<set>>, <<run>>,
// link setter or image source SugarCube evaluates) must never run on the app's
// own address: there it would make requests with the viewer's login cookie
// and read the editor's stored stories. So the tab only holds a sealed frame
// (sandbox without allow-same-origin): the story runs in it with an empty
// origin of its own - no cookie, no API as the viewer, no localStorage, no
// access to this page - and its content rules let it reach nothing outside
// (SEALED_FRAME_CSP). The same for every story, the author's own included.
export function replaceDom(html: string) {
	// Blast JS globals.

	delete (window as any).CodeMirror;
	delete (window as any).SVG;
	delete (window as any).Store;
	delete (window as any).StoryFormat;
	delete (window as any).amdDefine;
	delete (window as any).app;
	delete (window as any).jQuery;

	// The tab's title is the story's. Read with DOMParser, which never runs
	// scripts or loads anything.
	const title = new DOMParser().parseFromString(html, 'text/html').title;

	// Rewrite the document: an empty page holding only the sealed frame.

	document.open();
	document.write(
		'<!doctype html><html><head><meta charset="utf-8">' +
			'<meta name="viewport" content="width=device-width, initial-scale=1">' +
			'<title></title>' +
			'<style>html,body{margin:0;height:100%;overflow:hidden;background:#111}' +
			'iframe{display:block;width:100%;height:100%;border:0}</style>' +
			'</head><body></body></html>'
	);
	document.close();
	document.title = title;

	const frame = document.createElement('iframe');

	frame.setAttribute('sandbox', SEALED_FRAME_SANDBOX);
	frame.setAttribute('title', title || 'Story');
	frame.setAttribute('srcdoc', sealedPage(html));
	document.body.appendChild(frame);
	frame.focus();
}
