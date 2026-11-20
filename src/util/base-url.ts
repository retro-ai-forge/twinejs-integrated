/**
 * The app's base path: '/twine/' in the Wudlands app, './' for Electron. In a
 * module of its own so tests can mock it (setupTests.ts): Jest can't read
 * import.meta.
 */
export function baseUrl(): string {
	return import.meta.env.BASE_URL;
}
