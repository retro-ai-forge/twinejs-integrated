// Reads a drawn scene: its choices (links and buttons by their text, hotspots
// and image links by a neutral handle), its inputs (radio groups, checkboxes,
// drop-downs, cycles), and the cleaned HTML the player gets
// (APP_INTEGRATION_HEADLESS.md "Cleaning the output" and "The engine's API").
//
// The player sees the visible text and labels, nothing behind them: no link
// targets, setters, scene names (SugarCube's passage id, data-passage, the
// hotspots' title and aria-label), variable names or stored values. Each
// clickable element carries data-choice with its place in `choices`, each input
// data-input with its place in `inputs`.

const DROPPED = new Set([
	'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE',
	'FORM', 'TEXTAREA', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'SVG', 'MATH', 'PICTURE'
]);

const ATTRIBUTES = {
	'*': ['class'],
	IMG: ['src', 'alt'],
	INPUT: ['type', 'checked'],
	OPTION: ['selected']
};

const PERCENT = /^\d{1,3}(\.\d+)?%$/;

function normalize(text) {
	return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/** How texts are compared: like the story check, case and spaces don't count. */
function key(text) {
	return normalize(text).toLowerCase();
}

function labelOf(input) {
	const label = input.closest('label');
	return label ? normalize(label.textContent) : '';
}

/**
 * The live elements of a scene and what they stand for. `choices[i]` belongs
 * to `clickables[i]`; `inputs[i]` to `inputGroups[i]`.
 */
function read(passage) {
	const choices = [];
	const clickables = [];
	let handles = 0;

	for (const el of passage.querySelectorAll('a, button')) {
		if (el.closest('.error-view') || el.classList.contains('macro-cycle')) {
			continue;
		}
		const text = normalize(el.textContent);
		if (!text || el.classList.contains('wud-hotspot')) {
			handles += 1;
			choices.push({handle: `h${handles}`});
		} else {
			choices.push({label: text});
		}
		clickables.push(el);
	}

	const inputs = [];
	const inputGroups = [];
	const radioGroups = new Map();

	for (const el of passage.querySelectorAll('input, select, a.macro-cycle')) {
		if (el.tagName === 'INPUT' && el.type === 'radio') {
			const name = el.name || `radio-${inputs.length}`;
			let group = radioGroups.get(name);
			if (!group) {
				group = {kind: 'radio', elements: []};
				radioGroups.set(name, group);
				inputGroups.push(group);
				inputs.push(null);
			}
			group.elements.push(el);
		} else if (el.tagName === 'INPUT' && el.type === 'checkbox') {
			inputGroups.push({kind: 'checkbox', elements: [el]});
			inputs.push(null);
		} else if (el.tagName === 'SELECT') {
			inputGroups.push({kind: 'listbox', elements: [el]});
			inputs.push(null);
		} else if (el.tagName === 'A') {
			inputGroups.push({kind: 'cycle', elements: [el], options: null});
			inputs.push(null);
		}
	}

	inputGroups.forEach((group, i) => {
		inputs[i] = describe(group);
	});
	return {choices, clickables, inputs, inputGroups};
}

function describe(group) {
	const [first] = group.elements;
	switch (group.kind) {
		case 'radio': {
			const picked = group.elements.find(el => el.checked);
			return {
				kind: 'radio',
				labels: group.elements.map(labelOf),
				picked: picked ? labelOf(picked) : null
			};
		}
		case 'checkbox':
			return {kind: 'checkbox', label: labelOf(first), checked: !!first.checked};
		case 'listbox': {
			const options = [...first.options];
			const picked = options.find(o => o.selected);
			return {
				kind: 'listbox',
				options: options.map(o => normalize(o.textContent)),
				picked: picked ? normalize(picked.textContent) : null
			};
		}
		default:
			return {
				kind: 'cycle',
				options: group.options || [normalize(first.textContent)],
				picked: normalize(first.textContent)
			};
	}
}

function hotspotStyle(el) {
	const style = el.style;
	if (el.classList.contains('wud-hotspots')) {
		return 'position:relative;display:inline-block;line-height:0';
	}
	const parts = ['position:absolute', 'box-sizing:border-box'];
	for (const side of ['left', 'top', 'width', 'height']) {
		if (PERCENT.test(style[side])) {
			parts.push(`${side}:${style[side]}`);
		}
	}
	return parts.join(';');
}

/** The cleaned HTML of a scene read by read(). */
function cleanHtml(passage, sceneRead) {
	// Mark the live elements, then work on a copy.
	sceneRead.clickables.forEach((el, i) => el.setAttribute('data-choice', String(i)));
	sceneRead.inputGroups.forEach((group, i) => {
		for (const el of group.elements) {
			el.setAttribute('data-input', String(i));
			if (el.tagName === 'INPUT') {
				el.toggleAttribute('checked', !!el.checked);
			}
			if (el.tagName === 'SELECT') {
				for (const option of el.options) {
					option.toggleAttribute('selected', !!option.selected);
				}
			}
		}
	});

	const copy = passage.cloneNode(true);

	sceneRead.clickables.forEach(el => el.removeAttribute('data-choice'));
	sceneRead.inputGroups.forEach(group => group.elements.forEach(el => el.removeAttribute('data-input')));

	for (const el of [...copy.querySelectorAll('*')]) {
		if (DROPPED.has(el.tagName.toUpperCase()) || el.closest('.error-view')) {
			el.remove();
		}
	}

	for (const el of [copy, ...copy.querySelectorAll('*')]) {
		const allowed = new Set([...ATTRIBUTES['*'], ...(ATTRIBUTES[el.tagName] || []), 'data-choice', 'data-input']);
		const hotspot = el.classList.contains('wud-hotspot') || el.classList.contains('wud-hotspots');
		const style = hotspot ? hotspotStyle(el) : null;

		for (const attr of [...el.attributes]) {
			if (!allowed.has(attr.name)) {
				el.removeAttribute(attr.name);
			}
		}
		if (el.tagName === 'INPUT' && !['radio', 'checkbox'].includes(el.getAttribute('type'))) {
			el.remove();
			continue;
		}
		if (style) {
			el.setAttribute('style', style);
		}
	}
	return copy.outerHTML;
}

module.exports = {read, cleanHtml, describe, normalize, key, labelOf};
