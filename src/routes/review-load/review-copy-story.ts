import {v4 as uuid} from '@lukeed/uuid';
import {Story} from '../../store/stories/stories.types';
import {
	CloudStoryFull,
	cloudStoryToLocal
} from '../../store/persistence/cloud-sync/cloud-api';
import {unusedName} from '../../util/unused-name';

/**
 * A submission as a new local story: its own id, fresh passage ids (the
 * browser stores passages under their ids, so a reviewer who is also the
 * author keeps their working copy intact) and a "Review:" name.
 */
export function reviewCopyStory(
	cloud: CloudStoryFull,
	localId: string,
	takenNames: string[]
): Story {
	const story = cloudStoryToLocal(cloud);
	const passageIds = new Map(story.passages.map(p => [p.id, uuid()]));

	return {
		...story,
		id: localId,
		ifid: uuid().toUpperCase(),
		name: unusedName(`Review: ${story.name}`, takenNames),
		lastUpdate: new Date(),
		startPassage: passageIds.get(story.startPassage) ?? '',
		passages: story.passages.map(passage => ({
			...passage,
			id: passageIds.get(passage.id)!,
			story: localId
		}))
	};
}
