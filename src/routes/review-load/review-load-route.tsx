import * as React from 'react';
import {Link, useHistory, useParams} from 'react-router-dom';
import {v4 as uuid} from '@lukeed/uuid';
import {useStoriesContext} from '../../store/stories';
import {reviewGetStory} from '../../store/persistence/cloud-sync/cloud-api';
import {
	forgetReviewCopy,
	markReviewCopy,
	reviewCopyIds
} from '../../util/review-copies';
import {reviewCopyStory} from './review-copy-story';

function refusal(status: number): string {
	switch (status) {
		case 401:
			return 'Connect your wallet first.';
		case 403:
			return 'Only reviewers can open submitted stories.';
		case 404:
			return 'This submission no longer exists. It may have been rejected meanwhile.';
		default:
			return status
				? `Could not load the submission (error ${status}).`
				: 'Could not reach the server.';
	}
}

/**
 * /review/:owner/:storyId - opens a submitted story for a reviewer: loads its
 * frozen review copy, keeps it as a local review copy (util/review-copies.ts)
 * and opens it in the story editor, where Test and Play work as usual.
 * Opening the same submission again replaces the older copy.
 */
export const ReviewLoadRoute: React.FC = () => {
	const {owner, storyId} = useParams<{owner: string; storyId: string}>();
	const {dispatch, stories} = useStoriesContext();
	const history = useHistory();
	const [error, setError] = React.useState<string>();
	const started = React.useRef(false);

	React.useEffect(() => {
		if (started.current) {
			return;
		}

		started.current = true;

		(async () => {
			const result = await reviewGetStory(owner, storyId);

			if (!result.ok) {
				setError(refusal(result.status));
				return;
			}

			const older = reviewCopyIds(owner, storyId);

			for (const oldId of older) {
				if (stories.some(story => story.id === oldId)) {
					dispatch({type: 'deleteStory', storyId: oldId});
				}
				forgetReviewCopy(oldId);
			}

			const localId = uuid();
			const story = reviewCopyStory(
				result.story,
				localId,
				stories.filter(s => !older.includes(s.id)).map(s => s.name)
			);

			// Marked before it is created, so cloud sync never picks it up.
			markReviewCopy(localId, {owner, storyId});
			dispatch({type: 'createStory', props: story});
			history.replace(`/stories/${localId}`);
		})();
	}, [dispatch, history, owner, stories, storyId]);

	return (
		<div style={{padding: '2rem', fontFamily: 'sans-serif'}}>
			{error ? (
				<>
					<p>{error}</p>
					<p>
						<Link to="/">Back to the library</Link>
					</p>
				</>
			) : (
				<p>Loading the submission…</p>
			)}
		</div>
	);
};
