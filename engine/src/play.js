// One engine call in a fresh page: /start, /step or /move
// (APP_INTEGRATION_HEADLESS.md "One click" and "The engine's API").
//
// The saved state has two parts:
//   session - SugarCube's own saved state (its session storage), which holds
//             the scene as it began; SugarCube restores it like a browser reload
//   active  - the story variables as they are now, which also holds what a
//             click that stayed in the scene changed (SugarCube saves only when
//             the story moves to a new scene)
// A step restores the session, lets SugarCube show the scene again, then puts
// the active variables back in place (the same objects, so references such as
// a loop's _c stay valid). The click then acts on exactly the values the player
// had, also a number rolled in the scene's text.
//
// Legend changes are counted once: those the click wrote (from the restored
// values to the moment the next scene begins) plus those the new scene's own
// text wrote (from the fresh party data to the end of the scene). The re-shown
// scene's changes were counted when it was first shown.

const {JSDOM, VirtualConsole} = require('jsdom');
const shims = require('./shims');
const clean = require('./clean');
const {LEGEND_NAMES} = require('./legend-names');
const {ENGINE_VERSION} = require('./version');

const LIMITS = {stateBytes: 64 * 1024, htmlBytes: 256 * 1024};
// SugarCube starts a <<goto>> after Engine.minDomActionDelay (40 ms); a click
// that moves on has begun the next scene well within this.
const NAVIGATION_WAIT_MS = 150;
const SCENE_WAIT_MS = 1500;
const PAGE_ADDRESS = 'http://engine.invalid/';

function firstLine(text) {
	return String(text).split('\n')[0].slice(0, 300);
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function until(test, ms) {
	const deadline = Date.now() + ms;
	while (!test()) {
		if (Date.now() > deadline) {
			return false;
		}
		await sleep(2);
	}
	return true;
}

function legendNumbers(character) {
	const out = {};
	if (character && typeof character === 'object') {
		for (const [name, value] of Object.entries(character)) {
			if (LEGEND_NAMES.has(name) && typeof value === 'number' && Number.isFinite(value)) {
				out[name] = value;
			}
		}
	}
	return out;
}

function isPlain(value) {
	return ['number', 'string', 'boolean'].includes(typeof value) && !(typeof value === 'number' && !Number.isFinite(value));
}

class StoryError extends Error {}

class Run {
	constructor(call, html, request) {
		this.call = call;
		this.html = html;
		this.request = request;
		this.errors = [];
		this.inits = 0;
		this.ends = 0;
		this.onInit = null;
		this.window = null;
	}

	// -- the page --

	open(session) {
		const console = new VirtualConsole();
		console.on('jsdomError', error => {
			if (!/Not implemented/.test(error.message)) {
				this.errors.push(firstLine(error.message));
			}
		});
		this.dom = new JSDOM(this.html, {
			url: PAGE_ADDRESS,
			runScripts: 'dangerously',
			pretendToBeVisual: true,
			virtualConsole: console,
			beforeParse: window => {
				this.window = window;
				shims.install(window, {onError: message => this.errors.push(firstLine(message))});
				for (const [name, value] of Object.entries(session || {})) {
					window.sessionStorage.setItem(name, value);
				}
				window.__wud = {
					passageInit: name => {
						this.inits += 1;
						if (this.onInit) {
							this.onInit(name);
						}
					},
					passageEnd: () => {
						this.ends += 1;
					}
				};
			}
		});
	}

	close() {
		if (this.window) {
			this.window.close();
		}
	}

	get sugarCube() {
		return this.window.SugarCube;
	}

	get vars() {
		return this.sugarCube.State.variables;
	}

	/** A value made in the page's own world, so SugarCube treats it as its own. */
	pageValue(value) {
		return value === undefined ? undefined : this.window.JSON.parse(JSON.stringify(value));
	}

	passage() {
		return this.window.document.querySelector('#passages .passage');
	}

	checkErrors() {
		const passage = this.passage();
		if (passage) {
			for (const el of passage.querySelectorAll('.error-view .error, .error-view')) {
				this.errors.push(firstLine(el.textContent));
			}
		}
		if (this.errors.length) {
			throw new StoryError([...new Set(this.errors)].join(' | '));
		}
	}

	// -- party, Legend and $keep_ --

	putParty(list, leadId, pickedId) {
		const party = Array.isArray(list) ? list : [];
		const lead = party.find(c => c.id === leadId) || party[0];
		const picked = party.find(c => c.id === pickedId) || lead;
		const vars = this.vars;
		vars.char = this.pageValue(party);
		vars.lead = this.pageValue(lead);
		vars.picked = this.pageValue(picked);
	}

	legendSnapshot() {
		const vars = this.vars;
		const sources = {
			char: Array.isArray(vars.char) ? vars.char : [],
			lead: vars.lead ? [vars.lead] : [],
			picked: vars.picked ? [vars.picked] : []
		};
		const out = {};
		for (const [source, list] of Object.entries(sources)) {
			out[source] = list.map(c => ({id: c && typeof c.id === 'string' ? c.id : null, values: legendNumbers(c)}));
		}
		return out;
	}

	static addLegend(total, before, after) {
		for (const source of Object.keys(after)) {
			after[source].forEach((entry, i) => {
				const old = before[source] && before[source][i];
				if (!entry.id || !old || old.id !== entry.id) {
					return;
				}
				for (const [name, value] of Object.entries(entry.values)) {
					const delta = Math.round((value - (old.values[name] || 0)) * 1e6) / 1e6;
					if (delta) {
						const changes = (total[entry.id] = total[entry.id] || {});
						changes[name] = Math.round(((changes[name] || 0) + delta) * 1e6) / 1e6;
					}
				}
			});
		}
		return total;
	}

	keepValues() {
		const out = {};
		for (const [name, value] of Object.entries(this.vars)) {
			if (name.startsWith('keep_') && isPlain(value)) {
				out[name.slice(5)] = value;
			}
		}
		return out;
	}

	putKeep(keep) {
		for (const [name, value] of Object.entries(keep || {})) {
			if (isPlain(value)) {
				this.vars[`keep_${name}`] = value;
			}
		}
	}

	static keepChanges(before, after) {
		const out = {};
		for (const [name, value] of Object.entries(after)) {
			if (before[name] !== value) {
				out[name] = value;
			}
		}
		return out;
	}

	/** Puts saved values back into SugarCube's variables, keeping its objects. */
	putInPlace(target, source) {
		for (const name of Object.keys(target)) {
			if (!(name in source)) {
				delete target[name];
			}
		}
		for (const [name, value] of Object.entries(source)) {
			const current = target[name];
			if (
				value && typeof value === 'object' && current && typeof current === 'object' &&
				Array.isArray(value) === Array.isArray(current)
			) {
				if (Array.isArray(value)) {
					current.length = value.length;
				}
				this.putInPlace(current, value);
			} else {
				target[name] = value && typeof value === 'object' ? this.pageValue(value) : value;
			}
		}
	}

	// -- the calls --

	async waitForScene(endsBefore) {
		if (!(await until(() => this.ends > endsBefore, SCENE_WAIT_MS))) {
			this.checkErrors();
			throw new StoryError('the scene was never shown');
		}
		this.checkErrors();
	}

	async start() {
		const {party = {}, keep} = this.request;
		let base = null;
		let keepBase = {};
		this.onInit = () => {
			if (base) {
				return;
			}
			this.putParty(party.now, party.leadId, party.pickedId);
			this.putKeep(keep);
			base = this.legendSnapshot();
			keepBase = this.keepValues();
		};
		this.open(null);
		await this.waitForScene(0);
		return this.answer({
			legend: Run.addLegend({}, base, this.legendSnapshot()),
			keep: Run.keepChanges(keepBase, this.keepValues())
		});
	}

	/** Restores a saved frame and shows its scene again, as the player had it. */
	async restore() {
		const {frame = {}, party = {}} = this.request;
		let saved;
		try {
			saved = JSON.parse(frame.state);
		} catch (ex) {
			saved = null;
		}
		if (!saved || typeof saved !== 'object' || !saved.session || !saved.active) {
			throw new StoryError('the saved state is unreadable');
		}
		const active = saved.active;
		const shownLead = active.lead && active.lead.id;
		const shownPicked = active.picked && active.picked.id;
		this.onInit = () => this.putParty(party.shown, shownLead || party.leadId, shownPicked || party.leadId);
		this.open(saved.session);
		await this.waitForScene(0);
		this.onInit = null;
		this.putInPlace(this.vars, active);
		for (const [name, value] of Object.entries(this.request.results || {})) {
			this.vars[name] = this.pageValue(value);
		}
	}

	/** Moves on (a click, or Engine.play for /move) and reads the new scene. */
	async moveOn(act) {
		const {party = {}} = this.request;
		const before = this.legendSnapshot();
		const keepBefore = this.keepValues();
		let legend = {};
		let base = null;
		this.onInit = () => {
			if (base) {
				return;
			}
			legend = Run.addLegend({}, before, this.legendSnapshot());
			this.putParty(party.now, party.leadId, party.pickedId);
			base = this.legendSnapshot();
		};
		const initsBefore = this.inits;
		const endsBefore = this.ends;
		act();
		const moved = await until(() => this.inits > initsBefore, NAVIGATION_WAIT_MS);
		if (moved) {
			await this.waitForScene(endsBefore);
			Run.addLegend(legend, base, this.legendSnapshot());
		} else {
			// A click that stayed in the scene: what it changed is kept in the
			// active variables; the scene stays as the player sees it.
			this.checkErrors();
			legend = Run.addLegend({}, before, this.legendSnapshot());
		}
		return this.answer({legend, keep: Run.keepChanges(keepBefore, this.keepValues())});
	}

	async step() {
		await this.restore();
		const passage = this.passage();
		const scene = clean.read(passage);
		const {choice = {}, picks = []} = this.request;

		let index = -1;
		if (typeof choice.handle === 'string') {
			index = scene.choices.findIndex(c => c.handle === choice.handle);
		} else if (typeof choice.label === 'string') {
			index = scene.choices.findIndex(c => c.label && clean.key(c.label) === clean.key(choice.label));
		}
		if (index < 0) {
			return this.refused('label_gone');
		}
		if (!(await this.applyPicks(scene, picks))) {
			return this.refused('pick_gone');
		}
		const target = scene.clickables[index];
		return this.moveOn(() => target.click());
	}

	async move() {
		await this.restore();
		const to = this.request.move && this.request.move.to;
		if (typeof to !== 'string' || !this.sugarCube.Story.has(to)) {
			throw new StoryError(`there is no scene '${to}' to move to`);
		}
		return this.moveOn(() => this.sugarCube.Engine.play(to));
	}

	// -- picks --

	async cycleOptions(group) {
		const [link] = group.elements;
		const first = clean.normalize(link.textContent);
		const options = [first];
		for (let i = 0; i < 100; i++) {
			link.click();
			await sleep(0);
			const now = clean.normalize(this.liveCycle(group).textContent);
			if (now === first) {
				break;
			}
			options.push(now);
		}
		group.options = options;
		return options;
	}

	// SugarCube redraws a cycle's link on each click; find the current one.
	liveCycle(group) {
		const [link] = group.elements;
		if (link.isConnected) {
			return link;
		}
		const fresh = this.passage().querySelectorAll('a.macro-cycle')[group.cycleIndex || 0];
		group.elements = [fresh];
		return fresh;
	}

	/** Sets every pick the player sent; false when one isn't in the scene. */
	async applyPicks(scene, picks) {
		const wanted = new Map((Array.isArray(picks) ? picks : []).map(p => [clean.key(p), p]));
		const used = new Set();
		const cycles = scene.inputGroups.filter(g => g.kind === 'cycle');
		cycles.forEach((group, i) => (group.cycleIndex = i));

		for (const group of scene.inputGroups) {
			if (group.kind === 'radio') {
				for (const el of group.elements) {
					const k = clean.key(clean.labelOf(el));
					if (wanted.has(k)) {
						used.add(k);
						if (!el.checked) {
							el.click();
						}
					}
				}
			} else if (group.kind === 'checkbox') {
				const [el] = group.elements;
				const k = clean.key(clean.labelOf(el));
				const want = wanted.has(k);
				if (want) {
					used.add(k);
				}
				if (!!el.checked !== want) {
					el.click();
				}
			} else if (group.kind === 'listbox') {
				const [el] = group.elements;
				const option = [...el.options].find(o => wanted.has(clean.key(o.textContent)));
				if (option) {
					used.add(clean.key(option.textContent));
					el.value = option.value;
					el.dispatchEvent(new this.window.Event('change', {bubbles: true}));
				}
			} else if (group.kind === 'cycle') {
				const options = await this.cycleOptions(group);
				const pick = options.find(o => wanted.has(clean.key(o)));
				if (pick) {
					used.add(clean.key(pick));
					for (let i = 0; i < options.length; i++) {
						if (clean.normalize(this.liveCycle(group).textContent) === pick) {
							break;
						}
						this.liveCycle(group).click();
						await sleep(0);
					}
				}
			}
		}
		await sleep(0);
		return [...wanted.keys()].every(k => used.has(k));
	}

	// -- answers --

	sessionEntries() {
		const storage = this.window.sessionStorage;
		const out = {};
		for (let i = 0; i < storage.length; i++) {
			const name = storage.key(i);
			out[name] = storage.getItem(name);
		}
		return out;
	}

	async sceneAnswer() {
		const passage = this.passage();
		const scene = clean.read(passage);
		for (const group of scene.inputGroups.filter(g => g.kind === 'cycle')) {
			group.cycleIndex = scene.inputGroups.filter(g => g.kind === 'cycle').indexOf(group);
			await this.cycleOptions(group);
		}
		const fresh = clean.read(this.passage());
		fresh.inputGroups.forEach((group, i) => {
			if (group.kind === 'cycle') {
				group.options = scene.inputGroups[i].options;
			}
		});
		const name = this.sugarCube.State.passage;
		const story = this.sugarCube.Story.get(name);
		return {
			scene: {name, tags: story && Array.isArray(story.tags) ? [...story.tags] : []},
			html: clean.cleanHtml(this.passage(), fresh),
			choices: fresh.choices,
			inputs: fresh.inputGroups.map(clean.describe)
		};
	}

	async answer({legend, keep}) {
		const shown = await this.sceneAnswer();
		const vars = this.vars;
		const state = JSON.stringify({session: this.sessionEntries(), active: vars});
		if (state.length > LIMITS.stateBytes) {
			return {status: 'too_large', engineVersion: ENGINE_VERSION, message: `the saved state is ${state.length} bytes`};
		}
		if (shown.html.length > LIMITS.htmlBytes) {
			return {status: 'too_large', engineVersion: ENGINE_VERSION, message: `the scene is ${shown.html.length} bytes`};
		}
		return {
			status: 'ok',
			engineVersion: ENGINE_VERSION,
			...shown,
			state,
			// The ending's value ("success:dragon_slain", "failure"...), null when the
			// scene isn't one. The control layer checks it against the story's endings.
			ending: typeof vars.isEnding === 'string' ? vars.isEnding : null,
			allowRunAway: vars.meta_allowRunAway === true,
			legend,
			keep,
			requests: []
		};
	}

	async refused(reason) {
		const shown = await this.sceneAnswer();
		return {
			status: 'refused',
			reason,
			engineVersion: ENGINE_VERSION,
			...shown,
			state: this.request.frame.state
		};
	}
}

/** Plays one call; never throws for what a story does. */
async function play(call, html, request) {
	const run = new Run(call, html, request || {});
	try {
		if (call === 'start') {
			return await run.start();
		}
		if (call === 'step') {
			return await run.step();
		}
		if (call === 'move') {
			return await run.move();
		}
		return {status: 'bad_request', message: `unknown call ${call}`};
	} catch (error) {
		return {status: 'story_error', engineVersion: ENGINE_VERSION, message: firstLine(error.message)};
	} finally {
		run.close();
	}
}

module.exports = {play, LIMITS};
