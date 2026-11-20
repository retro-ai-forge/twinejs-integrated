import {ReviewStory} from '../../../store/persistence/cloud-sync/cloud-api';
import {
	reviewCopyStory,
	TEST_CHARACTERS_PASSAGE,
	testCharactersText
} from '../review-copy-story';

function passage(id: string, name: string, text: string) {
	return {
		id,
		name,
		text,
		tags: [],
		left: 0,
		top: 0,
		width: 100,
		height: 100,
		story: 'story-1',
		highlighted: false,
		selected: false
	};
}

const submission: ReviewStory = {
	storyId: 'story-1',
	ifid: 'IFID-1',
	name: 'A Tale',
	lastUpdate: '2026-11-19T10:00:00Z',
	storyData: {
		storyFormat: 'SugarCube',
		storyFormatVersion: '2.37.3',
		startPassage: 'p2'
	},
	passages: [passage('p1', 'StoryInit', ''), passage('p2', 'Start', 'Hello')]
};

describe('reviewCopyStory', () => {
	it('gives the copy its own story and passage ids', () => {
		const story = reviewCopyStory(submission, 'local-1', []);

		expect(story.id).toBe('local-1');
		expect(story.ifid).not.toBe('IFID-1');
		expect(story.passages.map(p => p.id)).not.toContain('p1');
		expect(story.passages.map(p => p.id)).not.toContain('p2');
		expect(new Set(story.passages.map(p => p.id)).size).toBe(2);
		expect(story.passages.every(p => p.story === 'local-1')).toBe(true);
		expect(story.passages.find(p => p.id === story.startPassage)?.name).toBe(
			'Start'
		);
		expect(story.storyFormat).toBe('SugarCube');
	});

	it('always uses the platform\'s SugarCube, whatever the submission names', () => {
		const story = reviewCopyStory(
			{
				...submission,
				storyData: {
					...submission.storyData,
					storyFormat: 'SugarCube',
					storyFormatVersion: '2.99.0'
				}
			},
			'l',
			[]
		);

		expect(story.storyFormat).toBe('SugarCube');
		expect(story.storyFormatVersion).toBe('2.37.3');
	});

	it('puts the stored test party back as a TestCharacters scene', () => {
		const party = [
			{firstName: 'Grimjaw', lastName: 'Ironfoot', might: 18},
			{firstName: 'Elara', lastName: 'Moonwhisper', might: 6}
		];
		const story = reviewCopyStory(
			{...submission, testCharacters: party},
			'local-1',
			[]
		);
		const scene = story.passages.find(
			p => p.name === TEST_CHARACTERS_PASSAGE
		);

		expect(scene?.story).toBe('local-1');
		expect(scene?.text).toBe(testCharactersText(party));
		expect(JSON.parse(scene!.text)).toEqual(party);
		expect(scene!.text.split('\n')).toHaveLength(4);
		expect(new Set(story.passages.map(p => p.id)).size).toBe(3);
	});

	it('adds no TestCharacters scene without a stored party', () => {
		for (const testCharacters of [undefined, null, []]) {
			const story = reviewCopyStory({...submission, testCharacters}, 'l', []);

			expect(story.passages.map(p => p.name)).toEqual(['StoryInit', 'Start']);
		}
	});

	it('is named after the submission without clashing', () => {
		expect(reviewCopyStory(submission, 'l', []).name).toBe('Review: A Tale');
		expect(
			reviewCopyStory(submission, 'l', ['Review: A Tale']).name
		).not.toBe('Review: A Tale');
	});
});
