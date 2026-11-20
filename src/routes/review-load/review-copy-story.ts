import {v4 as uuid} from '@lukeed/uuid';
import {Passage, Story} from '../../store/stories/stories.types';
import {
	cloudStoryToLocal,
	ReviewStory
} from '../../store/persistence/cloud-sync/cloud-api';
import {platformStoryFormat} from '../../store/story-formats/defaults';
import {unusedName} from '../../util/unused-name';

/** The scene that holds the test party (docs/STORY-RULES.md "Test characters"). */
export const TEST_CHARACTERS_PASSAGE = 'TestCharacters';

/**
 * The stored test party as the TestCharacters scene's text: a JSON list, one
 * character per line.
 */
export function testCharactersText(party: Record<string, unknown>[]): string {
	return `[\n${party.map(c => `  ${JSON.stringify(c)}`).join(',\n')}\n]`;
}

/**
 * A submission as a new local story: its own id, fresh passage ids (the
 * browser stores passages under their ids, so a reviewer who is also the
 * author keeps their working copy intact) and a "Review:" name. It always uses
 * the platform's SugarCube, whatever format the submission names. The test
 * party, stored apart from the scenes on submit, comes back as a
 * TestCharacters scene, so Test can use it and Save review stores it again.
 */
export function reviewCopyStory(
	cloud: ReviewStory,
	localId: string,
	takenNames: string[]
): Story {
	const story = cloudStoryToLocal(cloud);
	const passageIds = new Map(story.passages.map(p => [p.id, uuid()]));
	const passages: Passage[] = story.passages.map(passage => ({
		...passage,
		id: passageIds.get(passage.id)!,
		story: localId
	}));
	const party = cloud.testCharacters;

	if (
		Array.isArray(party) &&
		party.length > 0 &&
		!passages.some(p => p.name === TEST_CHARACTERS_PASSAGE)
	) {
		const right = Math.max(0, ...passages.map(p => p.left + p.width));
		const top = passages.length ? Math.min(...passages.map(p => p.top)) : 0;

		passages.push({
			id: uuid(),
			story: localId,
			name: TEST_CHARACTERS_PASSAGE,
			text: testCharactersText(party),
			tags: [],
			left: right + 50,
			top,
			width: 100,
			height: 100,
			highlighted: false,
			selected: false
		});
	}

	return {
		...story,
		id: localId,
		ifid: uuid().toUpperCase(),
		name: unusedName(`Review: ${story.name}`, takenNames),
		lastUpdate: new Date(),
		storyFormat: platformStoryFormat.name,
		storyFormatVersion: platformStoryFormat.version,
		startPassage: passageIds.get(story.startPassage) ?? '',
		passages
	};
}
