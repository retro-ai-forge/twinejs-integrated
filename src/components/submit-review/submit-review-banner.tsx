import * as React from 'react';
import {IconSend, IconCheck, IconX, IconAlertTriangle} from '@tabler/icons';
import {Story} from '../../store/stories';
import {
	cloudSaveStory,
	reviewSaveStory,
	ReviewSaveResult
} from '../../store/persistence/cloud-sync/cloud-api';
import {reviewCopyOf} from '../../util/review-copies';
import './submit-review-banner.css';

export interface SubmitReviewBannerProps {
	story: Story;
}

type SubmitState =
	| 'idle'
	| 'saving'
	| 'submitting'
	| 'submitted'
	| 'warnings'
	| 'rejected'
	| 'error';

interface SubmitResult {
	errors?: string[];
	warnings?: string[];
	errorMessage?: string;
}

// Rough time the server spends copying images into the review stage, so the
// progress bar feels proportional. Freezing is sequential in the backend at
// very roughly this per-image, e.g. 20 images ≈ 10s, 40 ≈ 20s. The bar only
// ever *completes* when the real request resolves — this just paces it.
const MS_PER_IMAGE = 500;
const MIN_ESTIMATE_MS = 2000;

// Distinct bucket-stored images referenced in the story, used only to size the
// progress estimate. External URLs and data: URIs aren't frozen, so skip them.
function countStoryImages(story: Story): number {
	const re = /\[img\[([^[\]]+?)\]/g;
	const seen = new Set<string>();

	for (const passage of story.passages) {
		re.lastIndex = 0;

		let match: RegExpExecArray | null;

		while ((match = re.exec(passage.text)) !== null) {
			const src = match[1].split('|').pop()!.trim();

			if (src && !/^(https?:)?\/\//i.test(src) && !src.startsWith('data:')) {
				seen.add(src);
			}
		}
	}

	return seen.size;
}

function shortWallet(wallet: string): string {
	return wallet.length > 14 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

/**
 * The submit bar, or for a reviewer's copy of a submission (opened through
 * /review/...) the review bar: the copy is never synced or submitted, but
 * "Save review" stores the reviewer's edits in the submission.
 */
export const SubmitReviewBanner: React.FC<SubmitReviewBannerProps> = props => {
	const review = reviewCopyOf(props.story.id);

	if (review) {
		return (
			<ReviewSaveBanner
				story={props.story}
				owner={review.owner}
				storyId={review.storyId}
			/>
		);
	}

	return <SubmitBanner {...props} />;
};

type ReviewSaveState =
	| 'idle'
	| 'saving'
	| 'saved'
	| 'warnings'
	| 'rejected'
	| 'error';

/**
 * A reviewer's bar on a review copy. "Save review" sends the copy, with the
 * reviewer's login, to PUT /twine-reviews/{owner}/{storyId}: the server checks
 * it like a submit and stores it in the submission, which Approve then
 * publishes. Only the editor makes this request - the story's own code runs in
 * a sealed frame without the login (util/replace-dom.ts).
 */
const ReviewSaveBanner: React.FC<{
	story: Story;
	owner: string;
	storyId: string;
}> = ({story, owner, storyId}) => {
	const [state, setState] = React.useState<ReviewSaveState>('idle');
	const [result, setResult] = React.useState<ReviewSaveResult>({
		ok: false,
		status: 0
	});

	async function handleSave() {
		setState('saving');

		const saved = await reviewSaveStory(owner, storyId, story);

		setResult(saved);

		if (saved.ok) {
			setState(saved.warnings && saved.warnings.length > 0 ? 'warnings' : 'saved');
		} else if (saved.status === 200) {
			setState('rejected');
		} else {
			setState('error');
		}
	}

	const details = (result.errors || [])
		.concat((result.warnings || []).map(w => `⚠ ${w}`))
		.join('\n');
	const count = (items?: string[]) => (items ? items.length : 0);
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	const bannerClass =
		state === 'saved'
			? 'submit-review-banner submit-review-submitted'
			: state === 'rejected' || state === 'error'
			? 'submit-review-banner submit-review-error'
			: 'submit-review-banner submit-review-warn';

	return (
		<div className={bannerClass}>
			{state === 'saved' ? (
				<IconCheck size={16} />
			) : state === 'rejected' || state === 'error' ? (
				<IconX size={16} />
			) : (
				<IconAlertTriangle size={16} />
			)}
			<span>
				{state === 'saved'
					? 'Review saved - Approve publishes this version'
					: state === 'warnings'
					? `Review saved with ${plural(count(result.warnings), 'warning')}`
					: state === 'rejected'
					? `Not saved - ${plural(count(result.errors), 'error')}`
					: state === 'error'
					? result.status === 0
						? 'Not saved - network error'
						: `Not saved - ${result.detail || `error ${result.status}`}`
					: `Review copy of a submission by ${shortWallet(owner)}. Never synced; Save review stores your edits in the submission.`}
			</span>
			{(state === 'warnings' || state === 'rejected') && (
				<button
					className="submit-review-btn submit-review-btn-details"
					onClick={() => alert(details)}
				>
					Details
				</button>
			)}
			<button
				className="submit-review-btn"
				onClick={handleSave}
				disabled={state === 'saving'}
			>
				{state === 'saving' ? 'Saving…' : 'Save review'}
			</button>
		</div>
	);
};

const SubmitBanner: React.FC<SubmitReviewBannerProps> = ({story}) => {
	const [state, setState] = React.useState<SubmitState>('idle');
	const [result, setResult] = React.useState<SubmitResult>({});
	const [freezing, setFreezing] = React.useState(false);
	const [progress, setProgress] = React.useState(0);
	const [imageCount, setImageCount] = React.useState(0);
	const rampRef = React.useRef<number>();

	const isSugarCube = story.storyFormat.toLowerCase().includes('sugarcube');

	React.useEffect(
		() => () => {
			if (rampRef.current) {
				cancelAnimationFrame(rampRef.current);
			}
		},
		[]
	);

	// Blocking overlay: ramp the bar to 95% over the estimate, then hold until
	// the real request finishes (finishProgress takes it to 100% and hides it).
	function startProgress(count: number) {
		setImageCount(count);
		setProgress(0);
		setFreezing(true);

		const estimate = Math.max(MIN_ESTIMATE_MS, count * MS_PER_IMAGE);
		const start = performance.now();

		const tick = () => {
			const pct = Math.min(95, ((performance.now() - start) / estimate) * 95);

			setProgress(pct);

			if (pct < 95) {
				rampRef.current = requestAnimationFrame(tick);
			}
		};

		rampRef.current = requestAnimationFrame(tick);
	}

	function finishProgress() {
		if (rampRef.current) {
			cancelAnimationFrame(rampRef.current);
		}

		setProgress(100);
		window.setTimeout(() => setFreezing(false), 400);
	}

	async function handleSubmit() {
		if (!isSugarCube) {
			setResult({errorMessage: 'Only SugarCube stories can be submitted'});
			setState('error');
			return;
		}

		setResult({});
		startProgress(countStoryImages(story));

		try {
			setState('saving');

			const saveResult = await cloudSaveStory(story);

			if (!saveResult) {
				setResult({errorMessage: 'Cloud save failed — login with wallet'});
				setState('error');
				return;
			}

			setState('submitting');

			const res = await fetch(
				`/api/auth/me/twine-stories/${story.id}/submit`,
				{
					method: 'POST',
					credentials: 'include',
					headers: {'Content-Type': 'application/json'}
				}
			);
			const data = await res.json().catch(() => ({}));

			if (data.ok === false) {
				setResult({
					errors: data.errors || [],
					warnings: data.warnings || []
				});
				setState('rejected');
			} else if (data.ok) {
				const warnings: string[] = data.warnings || [];
				if (warnings.length > 0) {
					setResult({warnings});
					setState('warnings');
				} else {
					setState('submitted');
				}
			} else if (res.status === 401) {
				setResult({errorMessage: 'Connect wallet first'});
				setState('error');
			} else {
				setResult({errorMessage: data.detail || 'Submit failed'});
				setState('error');
			}
		} catch {
			setResult({errorMessage: 'Network error'});
			setState('error');
		} finally {
			finishProgress();
		}
	}

	const bannerClass =
		state === 'submitted'
			? 'submit-review-banner submit-review-submitted'
			: state === 'warnings'
			? 'submit-review-banner submit-review-warn'
			: state === 'rejected' || state === 'error'
			? 'submit-review-banner submit-review-error'
			: 'submit-review-banner';

	const isWorking = state === 'saving' || state === 'submitting';

	return (
		<div className={bannerClass}>
			{state === 'submitted' ? (
				<>
					<IconCheck size={16} />
					<span>Submitted for review</span>
				</>
			) : state === 'warnings' ? (
				<>
					<IconAlertTriangle size={16} />
					<span>
						Submitted with {result.warnings?.length} warning
						{result.warnings && result.warnings.length !== 1 ? 's' : ''}
					</span>
					<button
						className="submit-review-btn submit-review-btn-details"
						onClick={() => alert((result.warnings || []).join('\n'))}
					>
						Details
					</button>
				</>
			) : state === 'rejected' ? (
				<>
					<IconX size={16} />
					<span>
						Rejected — {result.errors?.length} error
						{result.errors && result.errors.length !== 1 ? 's' : ''}
					</span>
					<button
						className="submit-review-btn submit-review-btn-details"
						onClick={() =>
							alert(
								(result.errors || [])
									.concat(
										(result.warnings || []).map(w => `⚠ ${w}`)
									)
									.join('\n')
							)
						}
					>
						Details
					</button>
					<button
						className="submit-review-btn"
						onClick={() => setState('idle')}
					>
						Retry
					</button>
				</>
			) : state === 'error' ? (
				<>
					<IconX size={16} />
					<span>{result.errorMessage || 'Submit failed'}</span>
					<button
						className="submit-review-btn"
						onClick={() => setState('idle')}
					>
						Retry
					</button>
				</>
			) : freezing ? (
				<>
					<IconSend size={16} />
					<span>
						{imageCount > 0
							? `Freezing ${imageCount} image${
									imageCount === 1 ? '' : 's'
							  }…`
							: 'Submitting…'}
					</span>
					<span className="submit-freeze-barmini">
						<span
							className="submit-freeze-fillmini"
							style={{width: `${progress}%`}}
						/>
					</span>
					<span className="submit-freeze-pctmini">
						{Math.round(progress)}%
					</span>
				</>
			) : (
				<>
					<IconSend size={16} />
					<span>{story.name}</span>
					{!isSugarCube && (
						<span className="submit-review-format-note">
							(SugarCube only)
						</span>
					)}
					<button
						className="submit-review-btn"
						onClick={handleSubmit}
						disabled={isWorking}
					>
						{state === 'saving'
							? 'Saving…'
							: state === 'submitting'
							? 'Submitting…'
							: 'Submit for review'}
					</button>
				</>
			)}
		</div>
	);
};
