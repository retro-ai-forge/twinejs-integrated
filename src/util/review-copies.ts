// Review copies: a submitted story that a reviewer opened in the editor to
// test-play it (route /review/:owner/:storyId, see routes/review-load).
//
// Each copy gets its own local id, and fresh passage ids, so a reviewer who is
// also the author never overwrites their working copy in this browser. This
// module remembers which local stories are review copies, with the author's
// wallet and the original story id: their images then come from the author's
// frozen review stage, and they are never synced to the cloud or submitted.
//
// Kept in memory for the session and in localStorage across reloads; storage
// that can't be read or written only loses the record after a reload.
//
// A copy also keeps the problems today's story check found in the submission
// when it was opened (backend get_twine_review_story "checkProblems"): it was
// stored as submitted, possibly before a rule existed, so its code may be
// anything. While there are problems the copy isn't published to run - Test,
// Play and Publish to File refuse it (store/use-publishing.ts) - until a Save
// review passes the check on the server and clears them.

export interface ReviewCopy {
	owner: string;
	storyId: string;
	problems: string[];
}

const STORAGE_KEY = 'wudlands-review-copies';

let copies: Record<string, ReviewCopy> | null = null;

function isReviewCopy(value: unknown): value is ReviewCopy {
	const copy = value as ReviewCopy;

	return (
		!!copy && typeof copy.owner === 'string' && typeof copy.storyId === 'string'
	);
}

/**
 * The problems as stored or sent. Anything that isn't a list of texts - a
 * record from before problems were kept, or an answer without the check -
 * counts as unchecked, so the copy stays blocked.
 */
export function checkedProblems(value: unknown): string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
		? value
		: ['This copy has not been checked against today\'s story rules - open it again from the review page.'];
}

function all(): Record<string, ReviewCopy> {
	if (!copies) {
		copies = {};

		try {
			const stored = JSON.parse(
				window.localStorage.getItem(STORAGE_KEY) || '{}'
			);

			if (stored && typeof stored === 'object') {
				for (const [localId, value] of Object.entries(stored)) {
					if (isReviewCopy(value)) {
						copies[localId] = {
							owner: value.owner,
							storyId: value.storyId,
							problems: checkedProblems(value.problems)
						};
					}
				}
			}
		} catch {
			// Unreadable storage: start empty.
		}
	}

	return copies;
}

function store(): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all()));
	} catch {
		// Kept in memory for this session.
	}
}

/** The review copy behind a local story id, or null for an ordinary story. */
export function reviewCopyOf(localId: string): ReviewCopy | null {
	return all()[localId] ?? null;
}

export function markReviewCopy(localId: string, copy: ReviewCopy): void {
	all()[localId] = {
		owner: copy.owner,
		storyId: copy.storyId,
		problems: checkedProblems(copy.problems)
	};
	store();
}

/** A Save review passed the server's check: the copy may run again. */
export function clearReviewProblems(localId: string): void {
	const copy = all()[localId];

	if (copy && copy.problems.length > 0) {
		copy.problems = [];
		store();
	}
}

export function forgetReviewCopy(localId: string): void {
	if (all()[localId]) {
		delete all()[localId];
		store();
	}
}

/** Local ids of the copies already opened from one submission. */
export function reviewCopyIds(owner: string, storyId: string): string[] {
	return Object.entries(all())
		.filter(([, copy]) => copy.owner === owner && copy.storyId === storyId)
		.map(([localId]) => localId);
}

/** Tests only: read localStorage again on next use. */
export function resetReviewCopies(): void {
	copies = null;
}
