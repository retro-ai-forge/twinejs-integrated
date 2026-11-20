import {baseUrl} from '../../util/base-url';

/**
 * The story format the platform runs, in the editor and on the server (the
 * backend accepts only this one: backend/story_rules.py FORMAT_NAME and
 * FORMAT_VERSION). Review copies always use it.
 */
export const platformStoryFormat = {name: 'SugarCube', version: '2.37.3'};

export const builtins = () => {
	// Resolve format URLs against the app's base (e.g. '/twine/' when embedded in
	// the Wudlands app, './' for Electron). Keeping them absolute to the base
	// avoids relative-URL resolution breaking when the editor is opened at /twine
	// (no trailing slash) or behind a proxy — which otherwise makes the JSONP
	// loader fetch the wrong path and time out.
	const base = baseUrl();

	return [
		// Proofing format — required by the default proofing preference.
		{
			name: 'Paperthin',
			url: `${base}story-formats/paperthin-1.0.0/format.js`,
			version: '1.0.0'
		},
		// The only story format offered in the GUI.
		{
			name: platformStoryFormat.name,
			url: `${base}story-formats/sugarcube-${platformStoryFormat.version}/format.js`,
			version: platformStoryFormat.version
		}
	];
};
