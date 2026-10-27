import {StoryFormat} from './story-formats.types';

// Refresh the URL of built-in formats whose definition changed (e.g. when the
// app's base path changes). Matching is by name + version, so a persisted
// record can keep a stale URL; update it in place and force a reload.
//
// Extracted from the story-formats reducer so that reducer.ts stays a
// near-pristine mount point against upstream Twine. Mutates `formats` in place.
export function repairBuiltinFormatUrls(
	formats: StoryFormat[],
	builtinFormats: {name: string; version: string; url: string}[]
) {
	for (let i = 0; i < formats.length; i++) {
		const format = formats[i];

		if (format.userAdded) {
			continue;
		}

		const builtinFormat = builtinFormats.find(
			f => f.name === format.name && f.version === format.version
		);

		if (builtinFormat && builtinFormat.url !== format.url) {
			console.info(
				`Repairing story format ${format.name} ${format.version} URL ` +
					`(was ${format.url}, now ${builtinFormat.url})`
			);
			formats[i] = {
				id: format.id,
				name: format.name,
				version: format.version,
				userAdded: format.userAdded,
				url: builtinFormat.url,
				loadState: 'unloaded'
			};
		}
	}
}
