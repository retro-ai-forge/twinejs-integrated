// Small stories and parties for the engine tests.

const {buildPage} = require('../src/page');
const {play} = require('../src/play');

let storyCount = 0;

/** A story from {name: text}; the first scene after StoryInit starts it. */
function story(scenes, {stylesheet = '', name} = {}) {
	storyCount += 1;
	const passages = Object.entries(scenes).map(([sceneName, text], i) => ({
		id: `p${i}`,
		name: sceneName,
		text,
		tags: []
	}));
	const start = passages.find(p => p.name !== 'StoryInit');
	return {
		name: name || `Test story ${storyCount}`,
		storyData: {startPassage: start.id, ifid: '33333333-3333-4333-8333-333333333333', stylesheet},
		passages
	};
}

function withTags(storyDoc, sceneName, tags) {
	storyDoc.passages.find(p => p.name === sceneName).tags = tags;
	return storyDoc;
}

const ALRIK = {id: 'c1', name: 'Alrik', might: 7, mercy: 10, courage: 0};
const BRENA = {id: 'c2', name: 'Brena', might: 5, mercy: 0, courage: 4};

function party(list = [ALRIK, BRENA], leadId = 'c1', pickedId) {
	return {now: list, shown: list, leadId, pickedId};
}

/** Plays a story through the core, step by step, keeping the frame. */
class Player {
	constructor(storyDoc, partyData = party()) {
		this.html = buildPage(storyDoc);
		this.party = partyData;
		this.state = null;
	}

	remember(answer) {
		if (answer.status === 'ok') {
			this.state = answer.state;
		}
		return answer;
	}

	async start(keep) {
		return this.remember(await play('start', this.html, {party: this.party, keep}));
	}

	async click(label, picks, extra = {}) {
		const choice = /^h\d+$/.test(label) ? {handle: label} : {label};
		return this.remember(
			await play('step', this.html, {
				frame: {state: this.state, engineVersion: '1'},
				party: this.party,
				choice,
				picks,
				...extra
			})
		);
	}

	async move(to) {
		return this.remember(
			await play('move', this.html, {frame: {state: this.state, engineVersion: '1'}, party: this.party, move: {to}})
		);
	}
}

function text(answer) {
	return answer.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {story, withTags, party, Player, text, ALRIK, BRENA};
