// Twine story image references.
//
// Images live in a public Firebase Storage / GCS bucket, keyed by story id.
// They are world-readable, so played games, reviewers and players load them
// straight from the bucket URL. Uploads/deletes go through the backend API,
// which authorises owner-or-admin.
//
// In passage text, authors reference images by bare filename, e.g.
// `[img[desert_dune.jpg]]`. At publish time the filename is rewritten to the
// full public URL (see rewriteImgMacros), so the stored text stays clean.

const IMAGE_BUCKET = 'thewudlands.firebasestorage.app';

// The editor only ever deals with the author's own working images, stored under
// the "create" stage keyed by their wallet: twine-images/{wallet}/create/{id}/.
// (review/served copies are made server-side on submit/deploy.)
const STAGE_CREATE = 'create';

// The owner's wallet, cached once from /api/auth/me. Read URLs need it because
// the bucket path is wallet-scoped; uploads/deletes don't (the backend derives
// the wallet from the session), so this only gates what the canvas can display.
let ownerWallet = '';
let walletPromise: Promise<string> | null = null;

export function getOwnerWallet(): string {
	return ownerWallet;
}

export function setOwnerWallet(wallet: string): void {
	ownerWallet = wallet || '';
}

/** Fetches and caches the authenticated wallet once. Empty string if signed out. */
export function loadOwnerWallet(): Promise<string> {
	if (!walletPromise) {
		walletPromise = fetch('/api/auth/me', {credentials: 'include'})
			.then(res => (res.ok ? res.json() : null))
			.then(data => {
				ownerWallet = (data && data.address) || '';
				return ownerWallet;
			})
			.catch(() => {
				ownerWallet = '';
				return '';
			});
	}

	return walletPromise;
}

/** Public URL for a create-stage story image (or its thumbnail). */
export function imagePublicUrl(
	storyId: string,
	filename: string,
	thumb = false
): string {
	const dir = `twine-images/${ownerWallet}/${STAGE_CREATE}/${storyId}`;
	const path = thumb ? `${dir}/thumbs/${filename}` : `${dir}/${filename}`;

	return `https://storage.googleapis.com/${IMAGE_BUCKET}/${encodeURI(path)}`;
}

/** Backend endpoint for managing a story's images (list/upload/delete). */
export function imagesApiBase(storyId: string): string {
	return `/api/auth/me/twine-stories/${encodeURIComponent(storyId)}/images`;
}

// Matches the opening of a Twee image macro up to its first `]`, capturing the
// source segment. Handles `[img[src]]`, `[img[src][link]]` and `[img[title|src]]`
// variants by matching only `[img[ ... ]` and leaving any trailing `[...]` and
// the closing `]` untouched.
const IMG_MACRO_OPEN = /\[img\[([^[\]]+?)\]/g;

function sourceFromSegment(segment: string): string {
	// For `title|src`, the source is the last pipe-delimited part.
	const parts = segment.split('|');
	return parts[parts.length - 1].trim();
}

function isExternal(src: string): boolean {
	return /^(https?:)?\/\//i.test(src) || src.startsWith('data:');
}

/**
 * Rewrites bare image filenames in passage text to full public bucket URLs.
 * Already-absolute URLs (http(s):// or data:) are left as-is.
 */
export function rewriteImgMacros(text: string, storyId: string): string {
	return text.replace(IMG_MACRO_OPEN, (whole, segment: string) => {
		const src = sourceFromSegment(segment);

		if (isExternal(src)) {
			return whole;
		}

		const parts = segment.split('|');
		parts[parts.length - 1] = imagePublicUrl(storyId, src);
		return `[img[${parts.join('|')}]`;
	});
}

/**
 * Returns the filename of the first bucket-stored image referenced in the text,
 * or null if there is none (external URLs are ignored - they have no thumbnail).
 */
export function firstImageName(text: string): string | null {
	IMG_MACRO_OPEN.lastIndex = 0;
	const match = IMG_MACRO_OPEN.exec(text);

	if (!match) {
		return null;
	}

	const src = sourceFromSegment(match[1]);
	return isExternal(src) ? null : src;
}
