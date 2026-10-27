// Image hotspots: clickable regions drawn over a passage's image that jump to
// another passage, exactly like a `[[link]]` choice.
//
// In passage text a hotspot is written as a `<<area>>` macro placed under the
// `[img[...]]` it belongs to:
//
//     [img[ruined-gate.webp]]
//     <<area 0.00 0.20 0.45 0.80 [[The left door->leftDoor]]>>
//     <<area 0.55 0.20 0.45 0.80 [[Climb the wall->wallTop]]>>
//
// The four numbers are x, y, width and height as fractions (0-1) of the image,
// so a region is resolution-independent (the same model the character portrait
// editor uses). The destination stays in ordinary `[[...]]` link grammar, so
// the backend validator resolves and counts it like any other choice — this
// module never has to know about target existence.

export interface Hotspot {
	/** Left edge, fraction of image width (0-1). */
	x: number;
	/** Top edge, fraction of image height (0-1). */
	y: number;
	/** Width, fraction of image width (0-1). */
	width: number;
	/** Height, fraction of image height (0-1). */
	height: number;
	/** Display text, doubling as the player's fallback button label. May be ''. */
	label: string;
	/** Destination passage name. May be '' while the author is still choosing. */
	target: string;
}

// One `<<area X Y W H [[link]]>>` macro. The coordinates are matched loosely
// (\S+) so malformed numbers still parse here and surface in the editor rather
// than silently vanishing; the link body is captured non-greedily.
const AREA_RE = /<<area\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\[\[([\s\S]+?)\]\]\s*>>/g;

/** Resolve {label, target} from the body of a `[[...]]` link, any SugarCube form. */
export function parseLinkBody(body: string): {label: string; target: string} {
	let b = body;

	// Drop a setter component: [[Text|Target][$x to 1]] -> "Text|Target".
	const setter = b.indexOf('][');

	if (setter !== -1) {
		b = b.slice(0, setter);
	}

	const arrow = b.indexOf('->');

	if (arrow !== -1) {
		return {label: b.slice(0, arrow).trim(), target: b.slice(arrow + 2).trim()};
	}

	const backArrow = b.indexOf('<-');

	if (backArrow !== -1) {
		return {
			label: b.slice(backArrow + 2).trim(),
			target: b.slice(0, backArrow).trim()
		};
	}

	const pipe = b.indexOf('|');

	if (pipe !== -1) {
		return {label: b.slice(0, pipe).trim(), target: b.slice(pipe + 1).trim()};
	}

	const t = b.trim();

	return {label: t, target: t};
}

/** The `[[...]]` form for a hotspot: labelled when the label adds information. */
export function serializeLink(label: string, target: string): string {
	if (label && label !== target) {
		return `[[${label}->${target}]]`;
	}

	return `[[${target}]]`;
}

function toFraction(raw: string): number {
	const n = Number.parseFloat(raw);

	return Number.isFinite(n) ? n : 0;
}

/** Parse every `<<area>>` macro in passage text into Hotspot objects. */
export function parseHotspots(text: string): Hotspot[] {
	const out: Hotspot[] = [];

	AREA_RE.lastIndex = 0;

	let match: RegExpExecArray | null;

	while ((match = AREA_RE.exec(text)) !== null) {
		const {label, target} = parseLinkBody(match[5]);

		out.push({
			x: toFraction(match[1]),
			y: toFraction(match[2]),
			width: toFraction(match[3]),
			height: toFraction(match[4]),
			label,
			target
		});
	}

	return out;
}

function round(n: number): string {
	// Two decimals keep the macro readable and are precise enough for regions.
	return (Math.round(n * 100) / 100).toFixed(2);
}

/** One `<<area>>` line for a hotspot. */
export function serializeHotspot(h: Hotspot): string {
	return `<<area ${round(h.x)} ${round(h.y)} ${round(h.width)} ${round(
		h.height
	)} ${serializeLink(h.label.trim(), h.target.trim())}>>`;
}

/**
 * Replace the hotspots in passage text with the given set, leaving the rest of
 * the text (narrative, image macro, other links) untouched. The `<<area>>`
 * block is written on its own lines directly after the first `[img[...]]`
 * macro, or at the top if the passage has no image.
 */
export function writeHotspots(text: string, hotspots: Hotspot[]): string {
	// Strip existing area macros and tidy the blank lines they leave behind.
	const stripped = text
		.replace(AREA_RE, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n');

	if (hotspots.length === 0) {
		return stripped.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
	}

	const block = hotspots.map(serializeHotspot).join('\n');
	const lines = stripped.split('\n');
	const imageLine = lines.findIndex(line => /\[img\[/.test(line));

	if (imageLine === -1) {
		return `${block}\n${stripped.replace(/^\n+/, '')}`;
	}

	lines.splice(imageLine + 1, 0, block);

	return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
