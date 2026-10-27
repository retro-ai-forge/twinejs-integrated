// Wudlands runtime shim, injected into every published/previewed story (see
// publish.ts). The real Wudlands engine renders scenes itself, but the Twine
// editor's Test/Debug preview plays the story through stock SugarCube, which
// has no `<<area>>` macro and would throw "macro <<area>> does not exist".
//
// This defines `<<area X Y W H [[link]]>>` for SugarCube so the preview works
// and shows the hotspots the author drew: each one becomes a clickable region
// overlaid on the scene image, navigating to its target passage like a choice.
// It is self-contained, guards against double-registration, and never touches
// the author's own Story JavaScript.

export const WUDLANDS_RUNTIME = `
;(function () {
	// Collapse the Save/Restart UI bar to a floating toggle by default. Injected
	// here (with the matching WUDLANDS_STYLESHEET rules) so authors never add the
	// StoryScript/StoryStylesheet passages themselves.
	if (typeof Config !== 'undefined' && Config.ui) {
		Config.ui.stowBarInitially = true;
	}

	if (typeof Macro === 'undefined' || typeof $ === 'undefined') {
		return;
	}

	// Hotspots collected while a passage renders, drawn once it is on screen.
	var pending = [];

	if (!Macro.has('area')) {
		Macro.add('area', {
			handler: function () {
				try {
					var a = this.args;
					var link = a[4];
					var target = '';
					var label = '';

					if (link && typeof link === 'object') {
						target = link.link || link.passage || '';
						label = link.text || target;
					} else if (link != null) {
						target = String(link);
						label = target;
					}

					pending.push({
						x: Number(a[0]) || 0,
						y: Number(a[1]) || 0,
						w: Number(a[2]) || 0,
						h: Number(a[3]) || 0,
						target: target,
						label: label
					});
				} catch (ex) {
					/* A malformed hotspot should never break the passage. */
				}
			}
		});
	}

	$(document).on(':passagedisplay', function (ev) {
		var spots = pending;

		pending = [];

		if (!spots.length) {
			return;
		}

		var root = ev && ev.content ? ev.content : document.querySelector('.passage');

		if (!root) {
			return;
		}

		var img = root.querySelector('img');

		if (!img) {
			return;
		}

		// Only outline the regions when SugarCube is in debug mode (the editor's
		// Debug toggle publishes the story with options="debug"). In a real
		// playthrough the hotspots stay invisible but remain clickable.
		var debug = typeof Config !== 'undefined' && Config.debug;

		var wrap = document.createElement('span');

		wrap.className = 'wud-hotspots';
		wrap.style.position = 'relative';
		wrap.style.display = 'inline-block';
		wrap.style.lineHeight = '0';
		img.parentNode.insertBefore(wrap, img);
		wrap.appendChild(img);
		img.style.display = 'block';

		spots.forEach(function (s, i) {
			var el = document.createElement('a');

			el.className = 'wud-hotspot';
			el.title = s.label || s.target;
			el.style.position = 'absolute';
			el.style.left = s.x * 100 + '%';
			el.style.top = s.y * 100 + '%';
			el.style.width = s.w * 100 + '%';
			el.style.height = s.h * 100 + '%';
			el.style.boxSizing = 'border-box';
			el.style.cursor = 'pointer';

			if (debug) {
				el.style.outline = '2px solid rgba(255, 255, 255, 0.5)';
				el.style.background = 'rgba(255, 255, 255, 0.08)';
			}

			var target = s.target;

			$(el).ariaClick({label: s.label || 'Go to ' + target}, function () {
				if (target) {
					Engine.play(target);
				}
			});

			wrap.appendChild(el);
		});
	});
})();
`;

// Wudlands AUTHORITATIVE stylesheet — platform mechanics that must look the same
// in every story. Injected AFTER the author's stylesheet with !important (see
// publish.ts), so an author's own CSS can't break them: the Save/Restart UI bar
// collapses to a small floating toggle and the passage area uses the full width.
// WUDLANDS_RUNTIME sets the matching Config.ui.stowBarInitially = true.
export const WUDLANDS_STYLESHEET = `
/* --- Wudlands: collapse the UI bar to a floating toggle --- */
#ui-bar.stowed { left: -17.5em !important; }

#ui-bar.stowed #ui-bar-toggle {
	position: fixed;
	top: 0.5em;
	left: 0.5em;
	z-index: 100;
	width: 2em;
	height: 2em;
	padding: 0;
	background: transparent;
	border: 1px solid #444;
	border-radius: 4px;
	color: #eee;
	text-shadow: 0 0 3px #000;
}

/* Content always uses the full viewport; the (fixed, opaque) bar overlays it
   when open, so there is no open/closed layout difference. */
#story { margin: 0 !important; }
#passages { max-width: none !important; margin: 0 !important; padding: 0 !important; }

/* Drop the empty line SugarCube inserts for the newline right after an image
   (the image is a block, so that <br> is a redundant blank line below it).
   The .wud-hotspots case covers images wrapped for <<area>> hotspots. Normal
   line breaks elsewhere are untouched. */
.passage img + br,
.passage .wud-hotspots + br { display: none !important; }
`;

// Wudlands OVERRIDABLE defaults — presentation/taste, not mechanics. Injected
// BEFORE the author's stylesheet with no !important (see publish.ts), so a story
// can change any of it from its own StoryStylesheet (e.g. a wider text gutter or
// turning the image bleed off). This just gives a good-looking baseline: the
// passage text is inset a little from the edges, while a top image bleeds back
// out flush to them.
export const WUDLANDS_DEFAULT_STYLESHEET = `
/* --- Wudlands defaults (override these in your own StoryStylesheet) --- */
/* Images are their own block, filling the full content width. There is no text
   gutter by default — add your own if you want the text inset from the edges,
   e.g. .passage { padding: 0 1rem; } in your StoryStylesheet. */
.passage img {
	display: block;
	width: 100%;
	height: auto;
	margin: 0 0 8px 0;
}
`;

// Wrap the author's StoryStylesheet with the Wudlands layers: overridable
// presentation defaults first (no !important, so the author can change them),
// then the author's own CSS, then authoritative platform mechanics last (with
// !important, so they always win). Called from publishStory so publish.ts needs
// only a one-line hook.
export function wudlandsStylesheet(authorStylesheet: string): string {
	return (
		WUDLANDS_DEFAULT_STYLESHEET +
		'\n' +
		authorStylesheet +
		'\n' +
		WUDLANDS_STYLESHEET
	);
}

// Append the Wudlands runtime shim (the <<area>> hotspot macro, UI-bar collapse,
// etc.) after the author's Story JavaScript, so the published/previewed story
// has it without the author adding anything. Called from publishStory.
export function wudlandsScript(authorScript: string): string {
	return authorScript + '\n' + WUDLANDS_RUNTIME;
}
