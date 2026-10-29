import * as React from 'react';
import useThunkReducer from 'react-hook-thunk-reducer';
import {usePersistence} from '../persistence/use-persistence';
import {useCloudSync} from '../persistence/cloud-sync';
import {reducer} from './reducer';
import {storyWithId, storyWithName} from './getters';
import {
	StoriesContextProps,
	StoriesAction,
	StoriesState
} from './stories.types';
import {useStoryFormatsContext} from '../story-formats';
import {useStoreErrorReporter} from '../use-store-error-reporter';

export const StoriesContext = React.createContext<StoriesContextProps>({
	dispatch: () => {},
	stories: []
});

StoriesContext.displayName = 'Stories';

export const useStoriesContext = () => React.useContext(StoriesContext);

function getAffectedStory(
	state: StoriesState,
	action: StoriesAction
): {story?: any; deleted?: string} {
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

export const StoriesContextProvider: React.FC = props => {
	const {stories: storiesPersistence} = usePersistence();
	const {formats} = useStoryFormatsContext();
	const {reportError} = useStoreErrorReporter();
	const {queueSave, queueDelete} = useCloudSync();
	const persistedReducer: React.Reducer<
		StoriesState,
		StoriesAction
	> = React.useMemo(
		() => (state, action) => {
			const newState = reducer(state, action);

			try {
				storiesPersistence.saveMiddleware(newState, action, formats);
			} catch (error) {
				reportError(error as Error, 'store.errors.cantPersistStories');
			}

			const {story, deleted} = getAffectedStory(newState, action);
			if (story) {
				queueSave(story);
			} else if (deleted) {
				queueDelete(deleted);
			}

			return newState;
		},
		[formats, reportError, storiesPersistence, queueSave, queueDelete]
	);
	const [stories, dispatch] = useThunkReducer(persistedReducer, []);

	return (
		<StoriesContext.Provider value={{dispatch, stories}}>
			{props.children}
		</StoriesContext.Provider>
	);
};
