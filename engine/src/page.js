// Builds a story's page with the editor's own publish code and the built-in
// SugarCube 2.37.3 format (build/, see build.js), so the server plays the page
// the author tested. Pages are cached per snapshot id by the server; building
// one never runs story code.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {publishStoryWithFormat} = require('../build/publish');
const {ENGINE_HOOKS} = require('./hooks');
const {ENGINE_VERSION} = require('./version');

let formatSource = null;

function sugarCubeSource() {
	if (formatSource === null) {
		// format.js is a JSONP-style call: window.storyFormat({..., source}).
		let format = null;
		vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'build', 'format.js'), 'utf8'), {
			window: {storyFormat: value => (format = value)}
		});
		if (!format || format.name !== 'SugarCube' || format.version !== '2.37.3') {
			throw new Error('build/format.js is not SugarCube 2.37.3 - run node build.js');
		}
		formatSource = format.source;
	}
	return formatSource;
}

function text(value, fallback = '') {
	return typeof value === 'string' ? value : fallback;
}

/**
 * The story in the shape the editor's publishStory expects, from a pinned
 * story ({name, storyData, passages}, as story_snapshots and twine_review
 * hold it). The story's own Story JavaScript is replaced by the engine's
 * hooks; its stylesheet is kept (the story check has checked it).
 */
function editorStory(story) {
	const data = story.storyData || {};
	const storyId = text(data.id, 'story');

	return {
		id: storyId,
		name: text(story.name, text(data.name, 'Story')),
		startPassage: text(data.startPassage),
		storyFormat: 'SugarCube',
		storyFormatVersion: '2.37.3',
		ifid: text(data.ifid, '00000000-0000-4000-8000-000000000000'),
		tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
		tagColors: {},
		zoom: 1,
		stylesheet: text(data.stylesheet),
		script: ENGINE_HOOKS,
		passages: (story.passages || []).map(p => ({
			id: text(p.id),
			name: text(p.name),
			text: text(p.text),
			tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
			left: 0,
			top: 0,
			width: 100,
			height: 100,
			story: storyId
		}))
	};
}

/** The complete HTML page SugarCube plays. */
function buildPage(story) {
	const editor = editorStory(story);

	if (!editor.passages.some(p => p.id === editor.startPassage)) {
		throw new Error('the story has no start scene');
	}
	return publishStoryWithFormat(editor, sugarCubeSource(), {
		name: 'Wudlands engine',
		version: ENGINE_VERSION
	});
}

module.exports = {buildPage, editorStory};
