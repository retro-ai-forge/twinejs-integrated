// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {refuseUncheckedReviewCopy, usePublishing} from '../use-publishing';
import {
	clearReviewProblems,
	markReviewCopy,
	resetReviewCopies
} from '../../util/review-copies';

describe('usePublishing', () => {
	describe('publishStory function', () => {
		it.todo(
			'calls publishStoryWithFormat() with the story and format requested'
		);

		it.todo('loads the format if needed');
	});
});

describe('refuseUncheckedReviewCopy', () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetReviewCopies();
	});

	it('lets ordinary stories and checked review copies run', () => {
		markReviewCopy('checked', {owner: '5Owner', storyId: 's', problems: []});
		expect(() => refuseUncheckedReviewCopy('own-story')).not.toThrow();
		expect(() => refuseUncheckedReviewCopy('checked')).not.toThrow();
	});

	it('refuses a review copy whose submission fails today’s check', () => {
		markReviewCopy('flagged', {
			owner: '5Owner',
			storyId: 's',
			problems: ['first problem', 'second problem']
		});
		expect(() => refuseUncheckedReviewCopy('flagged')).toThrow(
			/fails today's story check.*first problem \(and 1 more\)/
		);

		clearReviewProblems('flagged');
		expect(() => refuseUncheckedReviewCopy('flagged')).not.toThrow();
	});
});
