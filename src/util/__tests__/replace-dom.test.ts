import {
	MEMORY_STORAGE_SHIM,
	replaceDom,
	SEALED_FRAME_SANDBOX,
	withMemoryStorage
} from '../replace-dom';

describe('replaceDom', () => {
	const story =
		'<html><head><title>Desert &amp; Dunes</title></head><body><p>test</p></body></html>';

	it('replaces the page with a single frame holding the story', () => {
		document.body.innerHTML = '<p>This should be overwritten</p>';
		replaceDom(story);

		const frames = document.querySelectorAll('iframe');

		expect(frames).toHaveLength(1);
		expect(frames[0].getAttribute('srcdoc')).toBe(withMemoryStorage(story));
		expect(document.body.textContent).not.toContain(
			'This should be overwritten'
		);
	});

	it('seals the frame: scripts run, but never with the page’s origin', () => {
		replaceDom(story);

		const sandbox = document.querySelector('iframe')!.getAttribute('sandbox')!;

		expect(sandbox).toBe(SEALED_FRAME_SANDBOX);
		expect(sandbox.split(' ')).toContain('allow-scripts');
		expect(sandbox).not.toContain('allow-same-origin');
		expect(sandbox).not.toContain('allow-top-navigation');
		expect(sandbox).not.toContain('allow-popups');
	});

	it('names the tab after the story', () => {
		replaceDom(story);
		expect(document.title).toBe('Desert & Dunes');
		expect(document.querySelector('iframe')!.getAttribute('title')).toBe(
			'Desert & Dunes'
		);
	});
});

describe('withMemoryStorage', () => {
	it('installs the in-memory storage before anything else in the page runs', () => {
		const page = withMemoryStorage(
			'<html><head lang="en"><script>sugarcube()</script></head></html>'
		);

		expect(page.indexOf(MEMORY_STORAGE_SHIM)).toBeGreaterThan(-1);
		expect(page.indexOf(MEMORY_STORAGE_SHIM)).toBeLessThan(
			page.indexOf('sugarcube()')
		);
		expect(page.startsWith('<html><head lang="en">')).toBe(true);
	});

	it('still installs it in a page without a head', () => {
		expect(withMemoryStorage('<p>x</p>')).toBe(
			MEMORY_STORAGE_SHIM + '<p>x</p>'
		);
	});

	it('gives a working store where the frame has none', () => {
		const sealed = {} as any;

		Object.defineProperty(sealed, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('SecurityError');
			}
		});
		new Function('window', MEMORY_STORAGE_SHIM.replace(/<\/?script>/g, ''))(
			sealed
		);
		sealed.localStorage.setItem('a', 1);
		expect(sealed.localStorage.getItem('a')).toBe('1');
		expect(sealed.localStorage.length).toBe(1);
		expect(sealed.localStorage.key(0)).toBe('a');
		sealed.localStorage.removeItem('a');
		expect(sealed.localStorage.getItem('a')).toBeNull();
	});
});
