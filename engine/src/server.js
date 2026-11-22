// The engine's internal HTTP API (APP_INTEGRATION_HEADLESS.md "The engine's
// API"): POST /start, /step and /move, GET /health. Called only by the main
// service: Cloud Run lets a request through only with a Google ID token of an
// account that holds run.invoker on this service (SETUP.md "Story engines").
//
// Settings (environment):
//   PORT            8080
//   WORKER_MODE     shared (engine-live) or single-use (engine-test)
//   WORKERS         workers at once (default: one per CPU)
//   TIME_LIMIT_MS   2000 per call
//   MEMORY_MB       256 per worker

const http = require('http');
const {buildPage} = require('./page');
const {EnginePool} = require('./pool');
const {ENGINE_VERSION} = require('./version');

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PAGE_CACHE_SIZE = 50;
const CALLS = new Set(['start', 'step', 'move']);

class PageCache {
	constructor(size) {
		this.size = size;
		this.pages = new Map();
	}

	get(id) {
		const page = this.pages.get(id);
		if (page !== undefined) {
			this.pages.delete(id);
			this.pages.set(id, page);
		}
		return page;
	}

	set(id, page) {
		this.pages.delete(id);
		this.pages.set(id, page);
		while (this.pages.size > this.size) {
			this.pages.delete(this.pages.keys().next().value);
		}
	}
}

function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function shortText(value, max = 200) {
	return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function plainValues(value) {
	return isObject(value) && Object.values(value).every(v => ['number', 'string', 'boolean'].includes(typeof v));
}

function partyProblem(list, name) {
	if (!Array.isArray(list) || list.length < 1 || list.length > 4) {
		return `party.${name} holds 1 to 4 characters`;
	}
	if (!list.every(c => isObject(c) && shortText(c.id, 100))) {
		return `every character in party.${name} has an id`;
	}
	return null;
}

/** What's wrong with a request, or null. */
function requestProblem(call, body) {
	if (!isObject(body)) {
		return 'the request is a JSON object';
	}
	const {snapshot, frame, party, choice, picks, move, keep, results} = body;
	if (!isObject(snapshot) || !shortText(snapshot.id, 300)) {
		return 'snapshot.id is missing';
	}
	if (snapshot.story != null && !(isObject(snapshot.story) && Array.isArray(snapshot.story.passages))) {
		return 'snapshot.story holds the story with its passages';
	}
	if (!isObject(party)) {
		return 'party is missing';
	}
	const nowProblem = partyProblem(party.now, 'now');
	if (nowProblem) {
		return nowProblem;
	}
	if (!party.now.some(c => c.id === party.leadId)) {
		return 'party.leadId names a character of party.now';
	}
	if (party.pickedId != null && !party.now.some(c => c.id === party.pickedId)) {
		return 'party.pickedId names a character of party.now';
	}
	if (keep != null && !plainValues(keep)) {
		return 'keep holds plain values only';
	}
	if (results != null && !plainValues(results)) {
		return 'results holds plain values only';
	}
	if (call === 'start') {
		return null;
	}
	if (!isObject(frame) || typeof frame.state !== 'string' || frame.state.length > 128 * 1024) {
		return 'frame.state is missing';
	}
	const shownProblem = partyProblem(party.shown, 'shown');
	if (shownProblem) {
		return shownProblem;
	}
	if (call === 'step') {
		const byLabel = isObject(choice) && shortText(choice.label);
		const byHandle = isObject(choice) && typeof choice.handle === 'string' && /^h\d{1,3}$/.test(choice.handle);
		if (!byLabel && !byHandle) {
			return 'choice holds a label or a handle';
		}
		if (picks != null && !(Array.isArray(picks) && picks.length <= 100 && picks.every(p => shortText(p)))) {
			return 'picks is a list of texts';
		}
	}
	if (call === 'move' && !(isObject(move) && shortText(move.to))) {
		return 'move.to names a scene';
	}
	return null;
}

function createEngine(options = {}) {
	const pool = new EnginePool(options);
	const pages = new PageCache(options.pageCacheSize || PAGE_CACHE_SIZE);

	async function handle(call, body) {
		const problem = requestProblem(call, body);
		if (problem) {
			return {code: 400, answer: {status: 'bad_request', message: problem}};
		}
		const {snapshot} = body;
		let page = pages.get(snapshot.id);
		if (page === undefined) {
			if (!snapshot.story) {
				return {code: 200, answer: {status: 'unknown_snapshot', engineVersion: ENGINE_VERSION}};
			}
			try {
				page = buildPage(snapshot.story);
			} catch (error) {
				return {code: 400, answer: {status: 'bad_request', message: `the story can't be built: ${error.message}`}};
			}
			pages.set(snapshot.id, page);
		}
		if (call !== 'start' && body.frame.engineVersion !== ENGINE_VERSION) {
			return {code: 200, answer: {status: 'version_mismatch', engineVersion: ENGINE_VERSION}};
		}
		const request = {...body, snapshot: {id: snapshot.id}};
		const started = Date.now();
		const answer = await pool.run(call, page, request);
		// One line per call for Cloud Run's logs: nothing about the story or the players.
		if (options.log !== false) {
			console.log(JSON.stringify({severity: 'INFO', engine: pool.mode, call, status: answer.status, ms: Date.now() - started}));
		}
		return {code: 200, answer};
	}

	const server = http.createServer((req, res) => {
		const send = (code, answer) => {
			const text = JSON.stringify(answer);
			res.writeHead(code, {'content-type': 'application/json', 'cache-control': 'no-store'});
			res.end(text);
		};
		const url = new URL(req.url, 'http://engine.invalid');
		const call = url.pathname.replace(/^\//, '');

		// Not /healthz: Cloud Run's front end reserves some paths ending in z and
		// answers them with 404 itself, before the request reaches the engine.
		if (req.method === 'GET' && url.pathname === '/health') {
			return send(200, {ok: true, engineVersion: ENGINE_VERSION, mode: pool.mode});
		}
		if (req.method !== 'POST' || !CALLS.has(call)) {
			return send(404, {status: 'not_found'});
		}

		let size = 0;
		const chunks = [];
		let tooLarge = false;
		req.on('data', chunk => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				tooLarge = true;
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', async () => {
			if (tooLarge) {
				return;
			}
			let body;
			try {
				body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			} catch (error) {
				return send(400, {status: 'bad_request', message: 'the request is not JSON'});
			}
			try {
				const {code, answer} = await handle(call, body);
				send(code, answer);
			} catch (error) {
				send(500, {status: 'engine_error', message: String(error && error.message).slice(0, 300)});
			}
		});
		req.on('close', () => {
			if (tooLarge && !res.headersSent) {
				send(413, {status: 'bad_request', message: 'the request is too large'});
			}
		});
	});

	return {
		server,
		handle,
		pool,
		async close() {
			await pool.close();
			await new Promise(resolve => server.close(resolve));
		}
	};
}

if (require.main === module) {
	const engine = createEngine({
		mode: process.env.WORKER_MODE || 'shared',
		workers: process.env.WORKERS ? Number(process.env.WORKERS) : undefined,
		timeLimitMs: Number(process.env.TIME_LIMIT_MS || 2000),
		memoryMb: Number(process.env.MEMORY_MB || 256)
	});
	const port = Number(process.env.PORT || 8080);
	engine.server.listen(port, () => {
		console.log(`engine ${ENGINE_VERSION} (${engine.pool.mode}) listening on ${port}`);
	});
	const stop = () => engine.close().then(() => process.exit(0));
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}

module.exports = {createEngine, requestProblem};
