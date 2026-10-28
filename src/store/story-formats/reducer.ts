import {v4 as uuid} from '@lukeed/uuid';
import {builtins} from './defaults';
import {
	StoryFormat,
	StoryFormatsAction,
	StoryFormatsState
} from './story-formats.types';

export const reducer: React.Reducer<StoryFormatsState, StoryFormatsAction> = (
	state,
	action
) => {
	switch (action.type) {
		case 'init':
			return [...action.state];

		case 'repair': {
			const builtinFormats = builtins();

			// Filter out any outdated builtins.

			const result = state.filter(format => {
				const keep =
					format.userAdded ||
					builtinFormats.some(
						f => f.name === format.name && f.version === format.version
					);

				if (!keep) {
					console.info(
						`Repairing story formats by removing ${format.name} ${format.version} ` +
							`(outdated version of built-in format)`
					);
				}

				return keep;
			});

			// Refresh the URL of built-in formats whose definition changed (e.g. when
			// the app's base path changes). Matching is by name + version, so a
			// persisted record can keep a stale URL; update it and force a reload.
			for (let i = 0; i < result.length; i++) {
				const format = result[i];

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
					result[i] = {
						id: format.id,
						name: format.name,
						version: format.version,
						userAdded: format.userAdded,
						url: builtinFormat.url,
						loadState: 'unloaded'
					};
				}
			}

			// Add any builtins not present.

			for (const builtinFormat of builtinFormats) {
				if (
					!result.some(
						f =>
							f.name === builtinFormat.name &&
							f.version === builtinFormat.version
					)
				) {
					console.info(
						`Repairing story formats by adding built-in ${builtinFormat.name} ${builtinFormat.version}`
					);
					result.push({
						...builtinFormat,
						id: uuid(),
						loadState: 'unloaded',
						userAdded: false
					});
				}
			}

			return result;
		}

		case 'create':
			if (
				state.some(
					format =>
						format.name === action.props.name &&
						format.version === action.props.version
				)
			) {
				return state;
			}

			return [...state, {...action.props, id: uuid(), loadState: 'unloaded'}];

		case 'delete':
			return state.filter(f => f.id !== action.id);

		case 'update':
			if (
				state.some(
					format =>
						format.id !== action.id &&
						format.name === action.props.name &&
						format.version === action.props.version
				)
			) {
				return state;
			}

			return state.map(format => {
				if (format.id !== action.id) {
					return format;
				}

				return {...format, ...action.props} as StoryFormat;
			});
	}

	return state;
};
