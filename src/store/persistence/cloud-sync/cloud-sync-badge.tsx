import * as React from 'react';
import {IconCloud, IconCloudOff, IconRefresh} from '@tabler/icons';
import {Story} from '../../stories';
import {useCloudSync} from './cloud-sync-context';

export interface CloudSyncBadgeProps {
	story: Story;
}

// Small cloud-sync status indicator shown on each story card. Kept in its own
// file (mounted with a single line in the upstream StoryCard) so story-card.tsx
// stays pristine against upstream Twine. Positioned by `.story-card .cloud-sync-badge`
// in styles/wudlands.css.
export const CloudSyncBadge: React.FC<CloudSyncBadgeProps> = ({story}) => {
	const {syncStatuses} = useCloudSync();
	const status = syncStatuses[story.id] || 'idle';

	switch (status) {
		case 'synced':
			return (
				<span className="cloud-sync-badge cloud-synced" title="Saved to cloud">
					<IconCloud size={16} />
				</span>
			);
		case 'syncing':
			return (
				<span className="cloud-sync-badge cloud-syncing" title="Syncing...">
					<IconRefresh size={16} />
				</span>
			);
		case 'error':
			return (
				<span
					className="cloud-sync-badge cloud-error"
					title="Sync error — will retry"
				>
					<IconCloudOff size={16} />
				</span>
			);
		case 'idle':
		default:
			return (
				<span
					className="cloud-sync-badge cloud-idle"
					title="Wallet not connected — local only"
				>
					<IconCloudOff size={16} />
				</span>
			);
	}
};
