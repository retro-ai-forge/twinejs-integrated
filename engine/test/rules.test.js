// The story check and the real SugarCube agree: every "Accepted" example of
// the app's docs/STORY-RULES.md (the same blocks tests/test_story_rules.py
// checks pass the story check) plays in SugarCube 2.37.3 without an error.
// Skipped when the engine isn't inside the app's checkout.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {story, Player} = require('./helpers');
const {LEGEND_PAIRS} = require('../src/legend-names');

const RULES = path.join(__dirname, '..', '..', '..', 'docs', 'STORY-RULES.md');

function acceptedBlocks(doc) {
	const blocks = [];
	const pattern = /^(#{2,4} [^\n]*)$|^```[^\n]*\n([\s\S]*?)^```$/gm;
	let heading = null;
	let match;
	while ((match = pattern.exec(doc))) {
		if (match[1]) {
			heading = match[1];
			continue;
		}
		const before = doc.slice(0, match.index).trimEnd().split('\n').pop();
		if (before === 'Not accepted:' || heading === '### Test characters') {
			continue;
		}
		blocks.push({heading, block: match[2], storyInit: heading === '### StoryInit'});
	}
	return blocks;
}

// Scenes the examples link to, so SugarCube finds them.
function scenesNamedIn(block) {
	const names = new Set();
	for (const [, body] of block.matchAll(/\[\[(.+?)\]\]/g)) {
		const target = body.split('][')[0];
		names.add(
			target.includes('->') ? target.split('->')[1] : target.includes('<-') ? target.split('<-')[0] : target.includes('|') ? target.split('|')[1] : target
		);
	}
	for (const [, name] of block.matchAll(/<<goto "([^"]+)">>/g)) {
		names.add(name);
	}
	for (const [, name] of block.matchAll(/visited\("([^"]+)"\)/g)) {
		names.add(name);
	}
	return [...names].map(n => n.trim()).filter(Boolean);
}

// Characters with every value the rules document lists ("Characters").
function character(id, firstName, lastName, values) {
	const legend = Object.fromEntries(LEGEND_PAIRS.flat().map(name => [name, 0]));
	return {
		id, firstName, lastName, name: `${firstName} ${lastName}`,
		race: 'human', gender: 'female', birthsign: 'the_wanderer',
		class1: 'warrior', class2: 'none', prof1: 'blacksmith', prof2: 'none', prof3: 'none',
		might: 7, agility: 5, endurance: 6, precision: 4, will: 5, insight: 3, lore: 2, presence: 4,
		classLvl1: 1, classLvl2: 0, profLvl1: 2, profLvl2: 0, profLvl3: 0,
		equipment: ['rope_1', 'candle_1', 'candle_2'],
		...legend,
		...values
	};
}

const FULL_PARTY = {
	now: [character('c1', 'Alrik', 'Stone', {fame: 35}), character('c2', 'Brena', 'Vale', {mercy: 12})],
	leadId: 'c1'
};

const doc = fs.existsSync(RULES) ? fs.readFileSync(RULES, 'utf8') : null;

test('every Accepted example of the story rules plays in SugarCube without an error', {skip: !doc && 'docs/STORY-RULES.md not found'}, async () => {
	const blocks = acceptedBlocks(doc);
	assert.ok(blocks.length > 10, `only ${blocks.length} blocks found`);
	// The document's own StoryInit example sets up the scene examples.
	const initBlock = blocks.find(b => b.storyInit).block;
	const failures = [];
	for (const {heading, block, storyInit} of blocks) {
		const scenes = storyInit
			? {StoryInit: block, Start: 'Started.<<set $isEnding to true>>'}
			: {StoryInit: initBlock, Start: block};
		for (const name of scenesNamedIn(block)) {
			if (!(name in scenes)) {
				scenes[name] = 'Elsewhere.<<set $isEnding to true>>';
			}
		}
		const answer = await new Player(story(scenes), FULL_PARTY).start();
		if (answer.status !== 'ok') {
			failures.push(`${heading}: ${block.split('\n')[0].slice(0, 60)}... -> ${answer.status}: ${answer.message}`);
		}
	}
	assert.deepEqual(failures, []);
});
