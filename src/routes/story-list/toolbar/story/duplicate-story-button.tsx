import {IconCopy} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {
	duplicateStory,
	Story,
	useStoriesContext
} from '../../../../store/stories';
import {copyStoryImages} from '../../../../util/twine-images';

export interface DuplicateStoryButtonProps {
	story?: Story;
}

export const DuplicateStoryButton: React.FC<DuplicateStoryButtonProps> = ({
	story
}) => {
	const {dispatch, stories} = useStoriesContext();
	const {t} = useTranslation();

	function handleClick() {
		if (!story) {
			throw new Error('No story set');
		}

		const action = duplicateStory(story, stories);

		dispatch(action);

		// The copy has a new id and so an empty image folder: copy the
		// original's working images into it, or its pictures would be missing.
		if (action.props.id) {
			copyStoryImages(story.id, action.props.id).then(ok => {
				if (!ok) {
					console.warn(`The images of "${story.name}" weren't copied to its duplicate.`);
				}
			});
		}
	}

	return (
		<IconButton
			disabled={!story}
			icon={<IconCopy />}
			label={t('common.duplicate')}
			onClick={handleClick}
		/>
	);
};
