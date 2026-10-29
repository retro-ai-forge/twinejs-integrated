import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconCloud, IconCloudOff, IconRefresh} from '@tabler/icons';
import {Story} from '../../store/stories';
import {useCloudSync} from '../../store/persistence/cloud-sync';
import {Color} from '../../util/color';
import {CardContent, CardProps} from '../container/card';
import {SelectableCard} from '../container/card/selectable-card';
import {TagButton} from '../tag';
import './story-card.css';
import {StoryPreview} from './story-preview';

const dateFormatter = new Intl.DateTimeFormat([]);

export interface StoryCardProps extends CardProps {
	onChangeTagColor: (name: string, color: Color) => void;
	onRemoveTag: (name: string) => void;
	onEdit: () => void;
	onSelect: () => void;
	story: Story;
	storyTagColors: Record<string, Color>;
}

export const StoryCard: React.FC<StoryCardProps> = props => {
	const {
		onChangeTagColor,
		onEdit,
		onRemoveTag,
		onSelect,
		story,
		storyTagColors,
		...otherProps
	} = props;
	const {t} = useTranslation();
	const {syncStatuses} = useCloudSync();
	const status = syncStatuses[story.id] || 'idle';

	return (
		<div className="story-card">
			<SelectableCard
				{...otherProps}
				label={story.name}
				onDoubleClick={onEdit}
				onSelect={onSelect}
				selected={story.selected}
			>
				<CardContent>
					<div className="story-card-summary">
						<div className="story-card-summary-preview">
							<StoryPreview story={story} />
						</div>
						<div className="story-card-summary-text">
							<h2>{story.name}</h2>
							<p>
								{t('components.storyCard.lastUpdated', {
									date: dateFormatter.format(story.lastUpdate)
								})}
								<br />
								{t('components.storyCard.passageCount', {
									count: story.passages.length
								})}
							</p>
						</div>
					</div>
					<div className="story-card-footer">
						{story.tags && (
							<div className="tags">
								{story.tags.map(tag => (
									<TagButton
										color={storyTagColors[tag]}
										key={tag}
										name={tag}
										onChangeColor={color => onChangeTagColor(tag, color)}
										onRemove={() => onRemoveTag(tag)}
									/>
								))}
							</div>
						)}
						{status === 'idle' && (
							<span className="cloud-sync-badge cloud-idle" title="Wallet not connected — local only">
								<IconCloudOff size={16} />
							</span>
						)}
						{status === 'synced' && (
							<span className="cloud-sync-badge cloud-synced" title="Saved to cloud">
								<IconCloud size={16} />
							</span>
						)}
						{status === 'syncing' && (
							<span className="cloud-sync-badge cloud-syncing" title="Syncing...">
								<IconRefresh size={16} />
							</span>
						)}
						{status === 'error' && (
							<span className="cloud-sync-badge cloud-error" title="Sync error — will retry">
								<IconCloudOff size={16} />
							</span>
						)}
					</div>
				</CardContent>
			</SelectableCard>
		</div>
	);
};
