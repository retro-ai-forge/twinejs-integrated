import * as React from 'react';
import {usePrefsContext} from './prefs';

function gridSvgDataUrl(color: string): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
<line x1="25" y1="0" x2="25" y2="100" style="stroke:${color};stroke-width:1;opacity:0.5"/>
<line x1="50" y1="0" x2="50" y2="100" style="stroke:${color};stroke-width:1;opacity:0.5"/>
<line x1="75" y1="0" x2="75" y2="100" style="stroke:${color};stroke-width:1;opacity:0.5"/>
<line x1="0" y1="25" x2="100" y2="25" style="stroke:${color};stroke-width:1;opacity:0.5"/>
<line x1="0" y1="50" x2="100" y2="50" style="stroke:${color};stroke-width:1;opacity:0.5"/>
<line x1="0" y1="75" x2="100" y2="75" style="stroke:${color};stroke-width:1;opacity:0.5"/>
<line x1="0" y1="100" x2="100" y2="100" style="stroke:${color};stroke-width:2"/>
<line x1="100" y1="0" x2="100" y2="100" style="stroke:${color};stroke-width:2"/>
</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function ColorSettingsSetter() {
	const {prefs} = usePrefsContext();

	React.useEffect(() => {
		const style = document.documentElement.style;

		const vars: [string, string][] = [
			['--canvas-bg-color', prefs.canvasBackgroundColor],
			['--canvas-arrow-color', prefs.canvasArrowColor],
			['--node-bg-color', prefs.nodeBackgroundColor],
			['--node-text-color', prefs.nodeTextColor],
			['--node-active-color', prefs.nodeActiveColor],
			['--gui-bg-color', prefs.guiBackgroundColor],
			['--gui-text-color', prefs.guiTextColor],
			['--gui-inactive-text-color', prefs.guiInactiveTextColor],
			['--edit-bg-color', prefs.editBackgroundColor],
			['--edit-text-color', prefs.editTextColor],
		];

		for (const [prop, value] of vars) {
			if (value) {
				style.setProperty(prop, value);
			} else {
				style.removeProperty(prop);
			}
		}

		if (prefs.canvasGridColor) {
			style.setProperty('--canvas-grid-image', gridSvgDataUrl(prefs.canvasGridColor));
		} else {
			style.removeProperty('--canvas-grid-image');
		}
	}, [
		prefs.canvasBackgroundColor,
		prefs.canvasGridColor,
		prefs.canvasArrowColor,
		prefs.nodeBackgroundColor,
		prefs.nodeTextColor,
		prefs.nodeActiveColor,
		prefs.guiBackgroundColor,
		prefs.guiTextColor,
		prefs.guiInactiveTextColor,
		prefs.editBackgroundColor,
		prefs.editTextColor,
	]);

	return null;
}
