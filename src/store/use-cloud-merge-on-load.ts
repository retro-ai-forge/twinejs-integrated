import * as React from 'react';
import {useCloudSync} from './persistence/cloud-sync';
import {useStoriesContext} from './stories';

// Once stories have loaded and been repaired, merge any cloud-stored copies into
// local state exactly once. Extracted from state-loader.tsx so that upstream
// file stays a near-pristine mount point. Lives alongside StateLoader (not in
// the cloud-sync module) so it can read the stories context without creating an
// import cycle.
export function useCloudMergeOnLoad(storiesRepaired: boolean) {
	const {dispatch: storiesDispatch, stories: storiesState} =
		useStoriesContext();
	const {mergeFromCloud} = useCloudSync();
	const [cloudMerged, setCloudMerged] = React.useState(false);

	React.useEffect(() => {
		if (storiesRepaired && !cloudMerged) {
			setCloudMerged(true);
			mergeFromCloud(storiesState, storiesDispatch).catch(err =>
				console.warn('[cloud-sync] merge failed:', err)
			);
		}
	}, [
		storiesRepaired,
		cloudMerged,
		mergeFromCloud,
		storiesState,
		storiesDispatch
	]);
}
