import * as React from 'react';
import {storyWithId, storyWithName} from '../../stories/getters';
import {
	StoriesAction,
	StoriesState,
	Story
} from '../../stories/stories.types';
import {useCloudSync} from './cloud-sync-context';

// Given the post-reducer state and the action that produced it, work out which
// story was created/changed (to queue a cloud save) or deleted (to queue a
// cloud delete). Kept out of stories-context.tsx so that upstream file only
// mounts the hook below. Returns {} when the action doesn't affect a story.
function getAffectedStory(
	state: StoriesState,
	action: StoriesAction
): {story?: Story; deleted?: string} {
	switch (action.type) {
		case 'createStory':
			if (action.props.name) {
				try {
					return {story: storyWithName(state, action.props.name)};
				} catch {
					return {};
				}
			}
			return {};
		case 'updateStory':
		case 'createPassage':
		case 'createPassages':
		case 'updatePassage':
		case 'updatePassages':
		case 'deletePassage':
		case 'deletePassages':
			try {
				return {story: storyWithId(state, action.storyId)};
			} catch {
				return {};
			}
		case 'deleteStory':
			return {deleted: action.storyId};
		default:
			return {};
	}
}

// Bridges the stories reducer to cloud sync: call the returned (stable) function
// with the new state and the action just applied, and it queues the matching
// cloud save/delete. The upstream StoriesContextProvider reducer calls this in
// one line, so stories-context.tsx stays a near-pristine mount point.
export function useQueueStorySync() {
	const {queueSave, queueDelete} = useCloudSync();

	return React.useCallback(
		(state: StoriesState, action: StoriesAction) => {
			const {story, deleted} = getAffectedStory(state, action);

			if (story) {
				queueSave(story);
			} else if (deleted) {
				queueDelete(deleted);
			}
		},
		[queueSave, queueDelete]
	);
}
