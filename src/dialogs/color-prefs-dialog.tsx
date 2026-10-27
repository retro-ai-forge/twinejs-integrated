import * as React from 'react';
import {CardContent} from '../components/container/card';
import {DialogCard, DialogCardProps} from '../components/container/dialog-card';
import {ColorPrefs} from './color-prefs';

export const ColorPrefsDialog: React.FC<
	Omit<DialogCardProps, 'headerLabel'>
> = props => {
	return (
		<DialogCard
			{...props}
			className="color-prefs-dialog"
			fixedSize
			headerLabel="Colors"
		>
			<CardContent>
				<ColorPrefs />
			</CardContent>
		</DialogCard>
	);
};
