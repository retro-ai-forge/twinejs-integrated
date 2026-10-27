import * as React from 'react';
import {setPref, usePrefsContext} from '../store/prefs';
import './color-prefs.css';

function ColorPicker({
	label,
	value,
	fallback,
	onChange,
	onReset,
}: {
	label: string;
	value: string;
	fallback: string;
	onChange: (v: string) => void;
	onReset: () => void;
}) {
	return (
		<label className="color-picker-label">
			{label}
			<span className="color-picker-control">
				<input
					type="color"
					value={value || fallback}
					onChange={e => onChange(e.target.value)}
				/>
				{value && (
					<button
						className="color-reset"
						onClick={onReset}
						title="Reset to default"
					>
						&times;
					</button>
				)}
			</span>
		</label>
	);
}

export function ColorPrefs() {
	const {dispatch, prefs} = usePrefsContext();

	return (
		<>
			<p className="color-section-label">Canvas Colors</p>
			<div className="color-picker-row">
				<ColorPicker
					label="Background"
					value={prefs.canvasBackgroundColor}
					fallback="#e6effc"
					onChange={v => dispatch(setPref('canvasBackgroundColor', v))}
					onReset={() => dispatch(setPref('canvasBackgroundColor', ''))}
				/>
				<ColorPicker
					label="Grid"
					value={prefs.canvasGridColor}
					fallback="#c8d0dd"
					onChange={v => dispatch(setPref('canvasGridColor', v))}
					onReset={() => dispatch(setPref('canvasGridColor', ''))}
				/>
			</div>
			<div className="color-picker-row">
				<ColorPicker
					label="Nodes"
					value={prefs.nodeBackgroundColor}
					fallback="#f8f8f8"
					onChange={v => dispatch(setPref('nodeBackgroundColor', v))}
					onReset={() => dispatch(setPref('nodeBackgroundColor', ''))}
				/>
				<ColorPicker
					label="Node Text"
					value={prefs.nodeTextColor}
					fallback="#555555"
					onChange={v => dispatch(setPref('nodeTextColor', v))}
					onReset={() => dispatch(setPref('nodeTextColor', ''))}
				/>
				<ColorPicker
					label="Node Active"
					value={prefs.nodeActiveColor}
					fallback="#d4dce8"
					onChange={v => dispatch(setPref('nodeActiveColor', v))}
					onReset={() => dispatch(setPref('nodeActiveColor', ''))}
				/>
			</div>
			<p className="color-section-label">Node Edit Colors</p>
			<div className="color-picker-row">
				<ColorPicker
					label="Background"
					value={prefs.editBackgroundColor}
					fallback="#f8f8f8"
					onChange={v => dispatch(setPref('editBackgroundColor', v))}
					onReset={() => dispatch(setPref('editBackgroundColor', ''))}
				/>
				<ColorPicker
					label="Text"
					value={prefs.editTextColor}
					fallback="#555555"
					onChange={v => dispatch(setPref('editTextColor', v))}
					onReset={() => dispatch(setPref('editTextColor', ''))}
				/>
			</div>
			<p className="color-section-label">GUI Colors</p>
			<div className="color-picker-row">
				<ColorPicker
					label="Background"
					value={prefs.guiBackgroundColor}
					fallback="#f8f8f8"
					onChange={v => dispatch(setPref('guiBackgroundColor', v))}
					onReset={() => dispatch(setPref('guiBackgroundColor', ''))}
				/>
				<ColorPicker
					label="Text"
					value={prefs.guiTextColor}
					fallback="#555555"
					onChange={v => dispatch(setPref('guiTextColor', v))}
					onReset={() => dispatch(setPref('guiTextColor', ''))}
				/>
				<ColorPicker
					label="Inactive Text"
					value={prefs.guiInactiveTextColor}
					fallback="#aeaeae"
					onChange={v => dispatch(setPref('guiInactiveTextColor', v))}
					onReset={() => dispatch(setPref('guiInactiveTextColor', ''))}
				/>
			</div>
			<button
				className="color-reset-all"
				onClick={() => {
					dispatch(setPref('canvasBackgroundColor', ''));
					dispatch(setPref('canvasGridColor', ''));
					dispatch(setPref('nodeBackgroundColor', ''));
					dispatch(setPref('nodeTextColor', ''));
					dispatch(setPref('nodeActiveColor', ''));
					dispatch(setPref('guiBackgroundColor', ''));
					dispatch(setPref('guiTextColor', ''));
					dispatch(setPref('guiInactiveTextColor', ''));
					dispatch(setPref('editBackgroundColor', ''));
					dispatch(setPref('editTextColor', ''));
				}}
			>
				Default Colors
			</button>
		</>
	);
}
