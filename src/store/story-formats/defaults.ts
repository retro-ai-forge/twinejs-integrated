export const builtins = () => {
	// Resolve format URLs against the app's base (e.g. '/twine/' when embedded in
	// the Wudlands app, './' for Electron). Keeping them absolute to the base
	// avoids relative-URL resolution breaking when the editor is opened at /twine
	// (no trailing slash) or behind a proxy — which otherwise makes the JSONP
	// loader fetch the wrong path and time out.
	const base = import.meta.env.BASE_URL;

	return [
		// Proofing format — required by the default proofing preference.
		{
			name: 'Paperthin',
			url: `${base}story-formats/paperthin-1.0.0/format.js`,
			version: '1.0.0'
		},
		// The only story format offered in the GUI.
		{
			name: 'SugarCube',
			url: `${base}story-formats/sugarcube-2.37.3/format.js`,
			version: '2.37.3'
		}
	];
};
