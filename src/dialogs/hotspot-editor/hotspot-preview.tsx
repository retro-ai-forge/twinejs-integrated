import * as React from 'react';
import {imagePublicUrl} from '../../util/twine-images';
import {parseHotspots} from '../../util/hotspots';
import {HOTSPOT_COLORS} from './hotspot-editor';
import './hotspot-editor.css';

export interface HotspotPreviewProps {
	imageName: string;
	storyId: string;
	text: string;
}

/**
 * Read-only image preview with the passage's hotspots drawn over it as labelled
 * boxes. Shown in the passage editor so a writer can see where every image link
 * sits without opening the hotspot editor.
 */
export const HotspotPreview: React.FC<HotspotPreviewProps> = ({
	imageName,
	storyId,
	text
}) => {
	const hotspots = React.useMemo(() => parseHotspots(text), [text]);

	return (
		<div className="hotspot-preview">
			<img
				alt={imageName}
				src={imagePublicUrl(storyId, imageName)}
				onError={event => {
					(event.target as HTMLImageElement).style.display = 'none';
				}}
			/>
			{hotspots.map((h, i) => {
				const color = HOTSPOT_COLORS[i % HOTSPOT_COLORS.length];

				return (
					<div
						className="hotspot-preview-box"
						key={i}
						style={{
							borderColor: color,
							background: `${color}26`,
							left: `${h.x * 100}%`,
							top: `${h.y * 100}%`,
							width: `${h.width * 100}%`,
							height: `${h.height * 100}%`
						}}
						title={h.label || h.target}
					>
						<span style={{background: color}}>{i + 1}</span>
					</div>
				);
			})}
		</div>
	);
};
