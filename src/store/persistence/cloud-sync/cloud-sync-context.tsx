import * as React from 'react';
import {Story} from '../../stories/stories.types';
import {
	cloudDeleteStory,
	cloudGetStory,
	cloudListStories,
	cloudSaveStory,
	cloudStoryToLocal
} from './cloud-api';

export type SyncStatus = 'idle' | 'synced' | 'syncing' | 'error';

export interface CloudSyncContextProps {
	syncStatuses: Record<string, SyncStatus>;
	queueSave: (story: Story) => void;
	queueDelete: (storyId: string) => void;
	mergeFromCloud: (
		localStories: Story[],
		dispatch: (action: any) => void
	) => Promise<void>;
}

export const CloudSyncContext = React.createContext<CloudSyncContextProps>({
	syncStatuses: {},
	queueSave: () => {},
	queueDelete: () => {},
	mergeFromCloud: async () => {}
});

CloudSyncContext.displayName = 'CloudSync';

export const useCloudSync = () => React.useContext(CloudSyncContext);

const DEBOUNCE_MS = 10000;

export const CloudSyncProvider: React.FC = ({children}) => {
	const [syncStatuses, setSyncStatuses] = React.useState<
		Record<string, SyncStatus>
	>({});
	const timersRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>(
		{}
	);
	const lastHashRef = React.useRef<Record<string, string>>({});

	const setStatus = React.useCallback(
		(storyId: string, status: SyncStatus) => {
			setSyncStatuses(prev => ({...prev, [storyId]: status}));
		},
		[]
	);

	const doSave = React.useCallback(
		async (story: Story) => {
			const hash = JSON.stringify({
				name: story.name,
				lastUpdate: story.lastUpdate?.toISOString(),
				passageCount: story.passages.length,
				passageIds: story.passages.map(p => p.id).sort().join(',')
			});
			if (lastHashRef.current[story.id] === hash) {
				setStatus(story.id, 'synced');
				return;
			}

			setStatus(story.id, 'syncing');
			const result = await cloudSaveStory(story);
			if (result?.ok) {
				lastHashRef.current[story.id] = hash;
				setStatus(story.id, 'synced');
			} else {
				setStatus(story.id, 'error');
			}
		},
		[setStatus]
	);

	const queueSave = React.useCallback(
		(story: Story) => {
			if (timersRef.current[story.id]) {
				clearTimeout(timersRef.current[story.id]);
			}
			setStatus(story.id, 'syncing');
			timersRef.current[story.id] = setTimeout(() => {
				delete timersRef.current[story.id];
				doSave(story);
			}, DEBOUNCE_MS);
		},
		[doSave, setStatus]
	);

	const queueDelete = React.useCallback(
		(storyId: string) => {
			if (timersRef.current[storyId]) {
				clearTimeout(timersRef.current[storyId]);
				delete timersRef.current[storyId];
			}
			delete lastHashRef.current[storyId];
			setSyncStatuses(prev => {
				const next = {...prev};
				delete next[storyId];
				return next;
			});
			cloudDeleteStory(storyId);
		},
		[]
	);

	const mergeFromCloud = React.useCallback(
		async (
			localStories: Story[],
			dispatch: (action: any) => void
		) => {
			const cloudMetas = await cloudListStories();
			if (!cloudMetas) return;

			const localById = new Map(localStories.map(s => [s.id, s]));

			for (const meta of cloudMetas) {
				const local = localById.get(meta.storyId);

				if (!local) {
					const full = await cloudGetStory(meta.storyId);
					if (full) {
						const story = cloudStoryToLocal(full);
						dispatch({type: 'createStory', props: story});
						setStatus(meta.storyId, 'synced');
					}
				} else {
					const cloudDate = new Date(meta.lastUpdate);
					const localDate = local.lastUpdate || new Date(0);
					if (cloudDate > localDate) {
						const full = await cloudGetStory(meta.storyId);
						if (full) {
							const story = cloudStoryToLocal(full);
							dispatch({
								type: 'updateStory',
								storyId: story.id,
								props: {
									name: story.name,
									storyFormat: story.storyFormat,
									storyFormatVersion: story.storyFormatVersion,
									startPassage: story.startPassage,
									stylesheet: story.stylesheet,
									script: story.script,
									tags: story.tags,
									tagColors: story.tagColors,
									snapToGrid: story.snapToGrid,
									zoom: story.zoom,
									passages: story.passages
								}
							});
							setStatus(meta.storyId, 'synced');
						}
					} else {
						setStatus(meta.storyId, 'synced');
						if (localDate > cloudDate) {
							queueSave(local);
						}
					}
				}
			}

			for (const local of localStories) {
				if (!cloudMetas.find(m => m.storyId === local.id)) {
					queueSave(local);
				}
			}
		},
		[queueSave, setStatus]
	);

	React.useEffect(() => {
		return () => {
			Object.values(timersRef.current).forEach(clearTimeout);
		};
	}, []);

	const value = React.useMemo(
		() => ({syncStatuses, queueSave, queueDelete, mergeFromCloud}),
		[syncStatuses, queueSave, queueDelete, mergeFromCloud]
	);

	return (
		<CloudSyncContext.Provider value={value}>
			{children}
		</CloudSyncContext.Provider>
	);
};
