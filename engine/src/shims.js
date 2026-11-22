// What jsdom lacks for SugarCube, and what a story page never needs. Installed
// on every page before SugarCube starts (jsdom's beforeParse).
//
// SugarCube waits for a window width above 0, needs Web Storage (jsdom has it
// only with a page address, see play.js), calls window.scroll after each scene
// and reports fatal errors with alert(). Found on 2026-11-19 and 2026-11-21.
//
// The network objects are removed as well. The hard barrier is the platform's
// network without a way out (SETUP.md "Story engines"); this is a second one.

const VIEWPORT = {width: 1024, height: 768};

function install(window, {onError}) {
	const html = window.HTMLHtmlElement.prototype;
	Object.defineProperty(html, 'clientWidth', {get: () => VIEWPORT.width, configurable: true});
	Object.defineProperty(html, 'clientHeight', {get: () => VIEWPORT.height, configurable: true});

	const nothing = () => {};
	window.scroll = window.scrollTo = window.scrollBy = nothing;
	window.alert = message => onError(String(message));
	window.confirm = () => false;
	window.prompt = () => null;
	window.open = () => null;
	window.print = nothing;
	window.matchMedia = () => ({
		matches: false,
		media: '',
		addListener: nothing,
		removeListener: nothing,
		addEventListener: nothing,
		removeEventListener: nothing
	});

	for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker']) {
		Object.defineProperty(window, name, {value: undefined, configurable: false, writable: false});
	}
	if (window.navigator) {
		Object.defineProperty(window.navigator, 'sendBeacon', {value: () => false, configurable: false});
	}
}

module.exports = {install, VIEWPORT};
