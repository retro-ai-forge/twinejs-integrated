import {IconColorSwatch} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../components/control/icon-button';
import {ColorPrefsDialog, useDialogsContext} from '../dialogs';

// Toolbar button that opens the Wudlands colour-preferences dialog. Kept in its
// own file so the upstream AppActions bar needs only a one-line mount.
export const ColorPrefsButton: React.FC = () => {
	const {dispatch} = useDialogsContext();

	return (
		<IconButton
			icon={<IconColorSwatch />}
			label="Colors"
			onClick={() => dispatch({type: 'addDialog', component: ColorPrefsDialog})}
		/>
	);
};
