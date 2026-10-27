import {IconClick, IconPhoto} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';
import {CheckboxButton} from '../../components/control/checkbox-button';
import {Passage, Story} from '../../store/stories';
import {setPref, usePrefsContext} from '../../store/prefs';
import {useDialogsContext} from '../context/dialogs-context';
import {ImageManagerDialog} from '../image-manager';
import {HotspotEditorDialog} from '../hotspot-editor';

export interface WudlandsPassageButtonsProps {
	disabled?: boolean;
	passage: Passage;
	story: Story;
}

// Wudlands-only passage toolbar buttons (Images + Hotspot editors). Kept out of
// the upstream PassageToolbar so passage-toolbar.tsx stays a near-pristine mount
// point. Returns a fragment of buttons that drop straight into the ButtonBar.
export const WudlandsPassageButtons: React.FC<
	WudlandsPassageButtonsProps
> = ({disabled, passage, story}) => {
	const {dispatch: dialogsDispatch} = useDialogsContext();

	return (
		<>
			<IconButton
				disabled={disabled}
				icon={<IconPhoto />}
				label="Images"
				onClick={() =>
					dialogsDispatch({
						type: 'addDialog',
						component: ImageManagerDialog,
						props: {storyId: story.id}
					})
				}
			/>
			<IconButton
				disabled={disabled}
				icon={<IconClick />}
				label="Hotspot"
				onClick={() =>
					dialogsDispatch({
						type: 'addDialog',
						component: HotspotEditorDialog,
						props: {passageId: passage.id, storyId: story.id}
					})
				}
			/>
		</>
	);
};

// Wudlands-only Test/Debug preview toggle, stored in the `testDebug` pref.
export const DebugToggleButton: React.FC = () => {
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();

	return (
		<CheckboxButton
			label="Debug"
			onChange={value => prefsDispatch(setPref('testDebug', value))}
			value={prefs.testDebug}
		/>
	);
};
