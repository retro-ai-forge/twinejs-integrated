import {
	DIALOG_SHIM,
	MEMORY_STORAGE_SHIM,
	replaceDom,
	SEALED_FRAME_CSP,
	SEALED_FRAME_HEAD,
	SEALED_FRAME_SANDBOX,
	sealedPage
} from '../replace-dom';

describe('replaceDom', () => {
	const story =
		'<html><head><title>Desert &amp; Dunes</title></head><body><p>test</p></body></html>';

	it('replaces the page with a single frame holding the story', () => {
		document.body.innerHTML = '<p>This should be overwritten</p>';
		replaceDom(story);

		const frames = document.querySelectorAll('iframe');

		expect(frames).toHaveLength(1);
		expect(frames[0].getAttribute('srcdoc')).toBe(sealedPage(story));
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
		// No alert/confirm/prompt over the app's address.
		expect(sandbox).not.toContain('allow-modals');
	});

	it('names the tab after the story', () => {
		replaceDom(story);
		expect(document.title).toBe('Desert & Dunes');
		expect(document.querySelector('iframe')!.getAttribute('title')).toBe(
			'Desert & Dunes'
		);
	});
});

describe('sealedPage', () => {
	it('puts the content rules first, then the shims, before anything in the page runs', () => {
		const page = sealedPage(
			'<html><head lang="en"><style>p{}</style><script>sugarcube()</script></head></html>'
		);

		expect(page.startsWith('<html><head lang="en"><meta http-equiv="Content-Security-Policy"')).toBe(true);
		expect(page.indexOf(DIALOG_SHIM)).toBeGreaterThan(-1);
		expect(page.indexOf(MEMORY_STORAGE_SHIM)).toBeGreaterThan(page.indexOf(DIALOG_SHIM));
		expect(page.indexOf(MEMORY_STORAGE_SHIM)).toBeLessThan(page.indexOf('<style>'));
		expect(page.indexOf(MEMORY_STORAGE_SHIM)).toBeLessThan(page.indexOf('sugarcube()'));
	});

	it('still installs them in a page without a head', () => {
		expect(sealedPage('<p>x</p>')).toBe(SEALED_FRAME_HEAD + '<p>x</p>');
	});

	it('lets the frame reach nothing outside but the story images', () => {
		const rules = Object.fromEntries(
			SEALED_FRAME_CSP.split('; ').map(rule => {
				const [name, ...values] = rule.split(' ');

				return [name, values];
			})
		);

		expect(rules['default-src']).toEqual(["'none'"]);
		expect(rules['connect-src']).toEqual(["'none'"]);
		expect(rules['form-action']).toEqual(["'none'"]);
		expect(rules['img-src']).toEqual([
			'https://storage.googleapis.com/thewudlands.firebasestorage.app/',
			'data:'
		]);
		expect(rules['font-src']).toEqual(['data:']);
		// The content attribute is double-quoted: no double quote inside.
		expect(SEALED_FRAME_CSP).not.toContain('"');
	});

	it('shows alert() messages in the page as text', () => {
		document.body.innerHTML = '';
		const frameWindow = {} as any;

		new Function('window', DIALOG_SHIM.replace(/<\/?script>/g, ''))(frameWindow);
		frameWindow.alert('Error: <b>bad</b>');

		const box = document.querySelector('[role="alert"]')!;

		expect(box.textContent).toBe('Error: <b>bad</b>');
		expect(box.querySelector('b')).toBeNull();
		(box as HTMLElement).click();
		expect(document.querySelector('[role="alert"]')).toBeNull();
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
