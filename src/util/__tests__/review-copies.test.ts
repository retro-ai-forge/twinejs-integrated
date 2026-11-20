import {
	checkedProblems,
	clearReviewProblems,
	forgetReviewCopy,
	markReviewCopy,
	resetReviewCopies,
	reviewCopyIds,
	reviewCopyOf
} from '../review-copies';
import {imagePublicUrl, rewriteImgMacros, setOwnerWallet} from '../twine-images';

const BUCKET = 'https://storage.googleapis.com/thewudlands.firebasestorage.app';

describe('review copies', () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetReviewCopies();
	});

	it('remembers a copy across reloads', () => {
		markReviewCopy('local-1', {owner: '5Owner', storyId: 'story-1', problems: []});
		resetReviewCopies();

		expect(reviewCopyOf('local-1')).toEqual({owner: '5Owner', storyId: 'story-1', problems: []});
		expect(reviewCopyIds('5Owner', 'story-1')).toEqual(['local-1']);
		expect(reviewCopyOf('own-story')).toBeNull();
	});

	it('forgets a copy', () => {
		markReviewCopy('local-1', {owner: '5Owner', storyId: 'story-1', problems: []});
		forgetReviewCopy('local-1');
		resetReviewCopies();

		expect(reviewCopyOf('local-1')).toBeNull();
		expect(reviewCopyIds('5Owner', 'story-1')).toEqual([]);
	});

	it('starts empty when storage holds junk', () => {
		window.localStorage.setItem('wudlands-review-copies', '{not json');
		expect(reviewCopyOf('local-1')).toBeNull();

		resetReviewCopies();
		window.localStorage.setItem(
			'wudlands-review-copies',
			JSON.stringify({a: {owner: 5}, b: {owner: '5Owner', storyId: 's'}})
		);
		expect(reviewCopyOf('a')).toBeNull();
		// A record without problems (kept before they were) counts as unchecked.
		expect(reviewCopyOf('b')).toEqual({
			owner: '5Owner',
			storyId: 's',
			problems: checkedProblems(undefined)
		});
		expect(reviewCopyOf('b')!.problems).toHaveLength(1);
	});

	it('keeps the problems of today\'s check until a Save review clears them', () => {
		markReviewCopy('local-1', {
			owner: '5Owner',
			storyId: 'story-1',
			problems: ["Passage 'Start', line 1: <<run>> isn't accepted"]
		});
		resetReviewCopies();
		expect(reviewCopyOf('local-1')!.problems).toEqual([
			"Passage 'Start', line 1: <<run>> isn't accepted"
		]);

		clearReviewProblems('local-1');
		resetReviewCopies();
		expect(reviewCopyOf('local-1')!.problems).toEqual([]);
	});

	it('counts an answer without the check as unchecked', () => {
		expect(checkedProblems(undefined)).toHaveLength(1);
		expect(checkedProblems(null)).toHaveLength(1);
		expect(checkedProblems([1])).toHaveLength(1);
		expect(checkedProblems('x')).toHaveLength(1);
		expect(checkedProblems([])).toEqual([]);
		expect(checkedProblems(['a'])).toEqual(['a']);
	});

	it("shows a copy with the owner's review-stage images", () => {
		setOwnerWallet('5Reviewer');
		markReviewCopy('local-1', {owner: '5Owner', storyId: 'story-1', problems: []});

		expect(imagePublicUrl('local-1', 'gate.jpg')).toBe(
			`${BUCKET}/twine-images/5Owner/review/story-1/gate.jpg`
		);
		expect(imagePublicUrl('local-1', 'gate.jpg', true)).toBe(
			`${BUCKET}/twine-images/5Owner/review/story-1/thumbs/gate.jpg`
		);
		expect(rewriteImgMacros('[img[gate.jpg]]', 'local-1')).toBe(
			`[img[${BUCKET}/twine-images/5Owner/review/story-1/gate.jpg]]`
		);
		// The reviewer's own stories keep their create stage.
		expect(imagePublicUrl('own-story', 'gate.jpg')).toBe(
			`${BUCKET}/twine-images/5Reviewer/create/own-story/gate.jpg`
		);
	});
});
