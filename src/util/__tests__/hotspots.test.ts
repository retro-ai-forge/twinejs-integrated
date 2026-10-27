import {
	parseHotspots,
	parseLinkBody,
	serializeLink,
	writeHotspots
} from '../hotspots';

describe('parseLinkBody', () => {
	it('handles every SugarCube link form', () => {
		expect(parseLinkBody('Target')).toEqual({label: 'Target', target: 'Target'});
		expect(parseLinkBody('Display|Target')).toEqual({
			label: 'Display',
			target: 'Target'
		});
		expect(parseLinkBody('Display->Target')).toEqual({
			label: 'Display',
			target: 'Target'
		});
		expect(parseLinkBody('Target<-Display')).toEqual({
			label: 'Display',
			target: 'Target'
		});
		expect(parseLinkBody('Display|Target][$x to 1')).toEqual({
			label: 'Display',
			target: 'Target'
		});
	});
});

describe('serializeLink', () => {
	it('labels a link only when the label adds information', () => {
		expect(serializeLink('Cellar', 'Cellar')).toBe('[[Cellar]]');
		expect(serializeLink('', 'Cellar')).toBe('[[Cellar]]');
		expect(serializeLink('Go down', 'Cellar')).toBe('[[Go down->Cellar]]');
	});
});

describe('parseHotspots', () => {
	it('reads coordinates and link out of <<area>> macros', () => {
		const text =
			'[img[gate.webp]]\n' +
			'<<area 0.00 0.20 0.45 0.80 [[The left door->LeftDoor]]>>\n' +
			'<<area 0.55 0.2 0.45 0.8 [[WallTop]]>>';
		const spots = parseHotspots(text);

		expect(spots).toHaveLength(2);
		expect(spots[0]).toEqual({
			x: 0,
			y: 0.2,
			width: 0.45,
			height: 0.8,
			label: 'The left door',
			target: 'LeftDoor'
		});
		expect(spots[1].target).toBe('WallTop');
	});

	it('returns nothing when there are no hotspots', () => {
		expect(parseHotspots('Just [img[x.webp]] and [[a link->Next]]')).toEqual([]);
	});
});

describe('writeHotspots', () => {
	it('round-trips labelled hotspots through parse unchanged', () => {
		const text = '[img[gate.webp]]\nYou face a gate.';
		const spots = [
			{x: 0, y: 0.2, width: 0.45, height: 0.8, label: 'Left', target: 'A'},
			{x: 0.55, y: 0.2, width: 0.45, height: 0.8, label: 'Right', target: 'B'}
		];
		const written = writeHotspots(text, spots);

		expect(parseHotspots(written)).toEqual(spots);
		// Narrative and image are preserved.
		expect(written).toContain('[img[gate.webp]]');
		expect(written).toContain('You face a gate.');
	});

	it('writes an unlabelled hotspot as a bare link (label falls back to target)', () => {
		const written = writeHotspots('[img[g.webp]]', [
			{x: 0, y: 0, width: 0.5, height: 1, label: '', target: 'B'}
		]);

		expect(written).toContain('[[B]]');
		// A bare [[B]] reads back with label === target, SugarCube's own meaning.
		expect(parseHotspots(written)[0]).toMatchObject({label: 'B', target: 'B'});
	});

	it('replaces an existing hotspot block instead of appending', () => {
		const once = writeHotspots('[img[g.webp]]\ntext', [
			{x: 0, y: 0, width: 0.5, height: 1, label: 'L', target: 'A'}
		]);
		const twice = writeHotspots(once, [
			{x: 0.5, y: 0, width: 0.5, height: 1, label: 'R', target: 'B'}
		]);

		expect(parseHotspots(twice)).toHaveLength(1);
		expect(parseHotspots(twice)[0].target).toBe('B');
	});

	it('removes all hotspots when given an empty set', () => {
		const text =
			'[img[g.webp]]\n<<area 0 0 1 1 [[All->Next]]>>\nThe rest.';

		expect(writeHotspots(text, [])).not.toContain('<<area');
		expect(writeHotspots(text, [])).toContain('The rest.');
	});
});
