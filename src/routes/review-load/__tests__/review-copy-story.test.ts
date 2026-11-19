import {CloudStoryFull} from '../../../store/persistence/cloud-sync/cloud-api';
import {reviewCopyStory} from '../review-copy-story';

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

const submission: CloudStoryFull = {
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

	it('is named after the submission without clashing', () => {
		expect(reviewCopyStory(submission, 'l', []).name).toBe('Review: A Tale');
		expect(
			reviewCopyStory(submission, 'l', ['Review: A Tale']).name
		).not.toBe('Review: A Tale');
	});
});
