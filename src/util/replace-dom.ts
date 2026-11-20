// What a sealed frame may do: run scripts (SugarCube is one) and show dialogs
// (SugarCube reports fatal errors with alert()). Deliberately missing:
// allow-same-origin, so the frame gets its own empty origin.
export const SEALED_FRAME_SANDBOX = 'allow-scripts allow-modals';

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

/** The story page with the in-memory storage installed before anything else runs. */
export function withMemoryStorage(html: string): string {
	return /<head[^>]*>/i.test(html)
		? html.replace(/<head[^>]*>/i, head => head + MEMORY_STORAGE_SHIM)
		: MEMORY_STORAGE_SHIM + html;
}

// Test, Run here, Play and Proof show a story by replacing this tab's page with
// it. The story's code (its Story JavaScript, and every <<set>>, <<run>>,
// link setter or image source SugarCube evaluates) must never run on the app's
// own address: there it would make requests with the viewer's login cookie
// and read the editor's stored stories. So the tab only holds a sealed frame
// (sandbox without allow-same-origin): the story runs in it with an empty
// origin of its own - no cookie, no API as the viewer, no localStorage, no
// access to this page. The same for every story, the author's own included.
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
	frame.setAttribute('srcdoc', withMemoryStorage(html));
	document.body.appendChild(frame);
	frame.focus();
}
