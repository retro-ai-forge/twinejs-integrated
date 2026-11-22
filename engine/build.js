// Takes the editor's own files the engine needs, so a story page on the server
// is built exactly like the one the author tested in the editor:
//
//   src/util/publish.ts            -> build/publish.js   (the <tw-storydata> the editor publishes)
//   src/util/wudlands-runtime.ts   -> build/wudlands-runtime.js   (<<area>>, the platform's CSS layers)
//   public/story-formats/sugarcube-2.37.3/format.js -> build/format.js
//
// TypeScript only translates (no type check). publish.ts imports two editor
// modules the engine must not take over: i18n (only for archive file names) and
// twine-images (rewrites image names to bucket URLs, which on the server the
// control layer does in the finished HTML, for the story's stage). Both are
// replaced by stand-ins in build/stubs.

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'build');

function write(relative, text) {
	const file = path.join(OUT, relative);
	fs.mkdirSync(path.dirname(file), {recursive: true});
	fs.writeFileSync(file, text);
}

function translate(source, target, replacements = []) {
	let text = fs.readFileSync(path.join(ROOT, source), 'utf8');

	for (const [from, to] of replacements) {
		if (!text.includes(from)) {
			throw new Error(`${source}: expected to find ${from} - did the editor file change?`);
		}
		text = text.split(from).join(to);
	}

	const {outputText} = ts.transpileModule(text, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
			esModuleInterop: true
		},
		fileName: path.basename(source)
	});

	write(target, `// Built from ${source} by engine/build.js - do not edit.\n${outputText}`);
}

fs.rmSync(OUT, {recursive: true, force: true});

translate('src/util/wudlands-runtime.ts', 'wudlands-runtime.js');
translate('src/util/publish.ts', 'publish.js', [
	["from './i18n'", "from './stubs/i18n'"],
	["from './twine-images'", "from './stubs/twine-images'"]
]);

write(
	'stubs/i18n.js',
	"// Stand-in for src/util/i18n.ts: only publishArchive's file name uses it.\nexports.i18n = {t: key => key};\n"
);
write(
	'stubs/twine-images.js',
	'// Stand-in for src/util/twine-images.ts: on the server image names stay as\n' +
		'// written; the control layer rewrites them in the finished HTML.\n' +
		'exports.rewriteImgMacros = text => text;\n'
);

fs.copyFileSync(
	path.join(ROOT, 'public/story-formats/sugarcube-2.37.3/format.js'),
	path.join(OUT, 'format.js')
);

console.log('engine build: publish.js, wudlands-runtime.js, format.js');
