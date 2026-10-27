import * as React from 'react';
import {Passage} from '../../store/stories';
import {firstImageName, imagePublicUrl} from '../../util/twine-images';

export interface PassageThumbnailProps {
	passage: Passage;
}

// Renders the passage's first referenced image as a card thumbnail, or nothing
// if the passage has no image. Kept in its own file so the upstream PassageCard
// needs only a one-line mount. Styled by `.passage-card-thumb` in
// styles/wudlands.css.
export const PassageThumbnail: React.FC<PassageThumbnailProps> = ({passage}) => {
	const thumbName = React.useMemo(
		() => firstImageName(passage.text),
		[passage.text]
	);

	if (!thumbName) {
		return null;
	}

	return (
		<img
			alt=""
			className="passage-card-thumb"
			draggable={false}
			src={imagePublicUrl(passage.story, thumbName, true)}
			onError={event => {
				(event.target as HTMLImageElement).style.display = 'none';
			}}
		/>
	);
};
