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

export interface ReviewCopy {
	owner: string;
	storyId: string;
}

const STORAGE_KEY = 'wudlands-review-copies';

let copies: Record<string, ReviewCopy> | null = null;

function isReviewCopy(value: unknown): value is ReviewCopy {
	const copy = value as ReviewCopy;

	return (
		!!copy && typeof copy.owner === 'string' && typeof copy.storyId === 'string'
	);
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
						copies[localId] = {owner: value.owner, storyId: value.storyId};
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
	all()[localId] = {owner: copy.owner, storyId: copy.storyId};
	store();
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
