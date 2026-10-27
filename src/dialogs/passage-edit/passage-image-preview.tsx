import * as React from 'react';
import {Passage, Story} from '../../store/stories';
import {firstImageName} from '../../util/twine-images';
import {HotspotPreview} from '../hotspot-editor';

export interface PassageImagePreviewProps {
	passage: Passage;
	story: Story;
}

// Shows the passage's first image (with hotspot overlays) above the editor, or
// nothing if the passage has no image. Kept in its own file so the upstream
// PassageEditContents needs only a one-line mount. Styled by
// `.passage-edit-image-preview` in styles/wudlands.css.
export const PassageImagePreview: React.FC<PassageImagePreviewProps> = ({
	passage,
	story
}) => {
	const imageName = firstImageName(passage.text);

	if (!imageName) {
		return null;
	}

	return (
		<div className="passage-edit-image-preview">
			<HotspotPreview
				imageName={imageName}
				storyId={story.id}
				text={passage.text}
			/>
		</div>
	);
};
