// The engine's own lines in the story page, placed where the Story JavaScript
// goes (before the platform runtime). A story's own Story JavaScript is never
// played: the story check requires it to be empty, and the engine replaces it.
//
// They tell SugarCube to keep a single history step (the saved state stays a
// few hundred bytes; visited() keeps counting through SugarCube's list of
// expired scenes) and hand two scene events to the engine (window.__wud, set
// before SugarCube starts, see play.js):
//   :passageinit - a scene is about to be drawn: the engine puts the party in
//                  ($char, $lead, $picked) and counts what the click changed
//   :passageend  - the scene is drawn: the engine reads the result
exports.ENGINE_HOOKS = `
;(function () {
	if (typeof Config === 'undefined' || typeof $ === 'undefined') {
		return;
	}
	Config.history.maxStates = 1;
	Config.history.controls = false;
	Config.debug = false;

	function nameOf(ev) {
		return ev && ev.passage ? ev.passage.name || ev.passage.title : '';
	}

	$(document).on(':passageinit', function (ev) {
		if (window.__wud) {
			window.__wud.passageInit(nameOf(ev));
		}
	});
	$(document).on(':passageend', function (ev) {
		if (window.__wud) {
			window.__wud.passageEnd(nameOf(ev));
		}
	});
})();
`;
