import * as React from 'react';
import {IconSend, IconCheck, IconX, IconAlertTriangle} from '@tabler/icons';
import {Story} from '../../store/stories';
import {cloudSaveStory} from '../../store/persistence/cloud-sync/cloud-api';
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

export const SubmitReviewBanner: React.FC<SubmitReviewBannerProps> = ({
	story
}) => {
	const [state, setState] = React.useState<SubmitState>('idle');
	const [result, setResult] = React.useState<SubmitResult>({});

	const isSugarCube = story.storyFormat.toLowerCase().includes('sugarcube');

	async function handleSubmit() {
		if (!isSugarCube) {
			setResult({errorMessage: 'Only SugarCube stories can be submitted'});
			setState('error');
			return;
		}

		setResult({});

		setState('saving');
		const saveResult = await cloudSaveStory(story);
		if (!saveResult) {
			setResult({errorMessage: 'Cloud save failed — connect wallet first'});
			setState('error');
			return;
		}

		setState('submitting');
		try {
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
