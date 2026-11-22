// The HTTP API (src/server.js), and the engine under Node's permission model.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {spawn} = require('child_process');
const {createEngine} = require('../src/server');
const {story, party} = require('./helpers');

const STORY = story({
	Start: 'Hello $lead.name.\n[[Go on|Next]]',
	Next: 'Done.<<set $isEnding to "success">>'
});

async function post(base, call, body) {
	const response = await fetch(`${base}/${call}`, {
		method: 'POST',
		headers: {'content-type': 'application/json'},
		body: JSON.stringify(body)
	});
	return {code: response.status, answer: await response.json()};
}

async function listening(engine) {
	await new Promise(resolve => engine.server.listen(0, '127.0.0.1', resolve));
	return `http://127.0.0.1:${engine.server.address().port}`;
}

test('start and step over HTTP; the story is sent only when the engine asks for it', async () => {
	const engine = createEngine({mode: 'shared', workers: 1, log: false});
	const base = await listening(engine);
	try {
		const snapshot = {id: 'author:story:abc'};
		const first = await post(base, 'start', {snapshot, party: party()});
		assert.equal(first.answer.status, 'unknown_snapshot');

		const started = await post(base, 'start', {snapshot: {...snapshot, story: STORY}, party: party()});
		assert.equal(started.code, 200);
		assert.equal(started.answer.status, 'ok', started.answer.message);

		const next = await post(base, 'step', {
			snapshot,
			frame: {state: started.answer.state, engineVersion: started.answer.engineVersion},
			party: party(),
			choice: {label: 'Go on'}
		});
		assert.equal(next.answer.status, 'ok', next.answer.message);
		assert.equal(next.answer.scene.name, 'Next');
		assert.equal(next.answer.ending, 'success');
	} finally {
		await engine.close();
	}
});

test('a state from another engine version answers version_mismatch', async () => {
	const engine = createEngine({mode: 'shared', workers: 1, log: false});
	const base = await listening(engine);
	try {
		const snapshot = {id: 'author:story:v', story: STORY};
		const started = await post(base, 'start', {snapshot, party: party()});
		const answer = await post(base, 'step', {
			snapshot,
			frame: {state: started.answer.state, engineVersion: '0'},
			party: party(),
			choice: {label: 'Go on'}
		});
		assert.equal(answer.answer.status, 'version_mismatch');
	} finally {
		await engine.close();
	}
});

test('malformed requests are refused before any story runs', async () => {
	const engine = createEngine({mode: 'shared', workers: 1, log: false});
	const base = await listening(engine);
	try {
		const snapshot = {id: 'author:story:bad', story: STORY};
		const cases = [
			['start', {party: party()}, /snapshot\.id/],
			['start', {snapshot, party: {now: [], leadId: 'c1'}}, /1 to 4/],
			['start', {snapshot, party: {...party(), leadId: 'nobody'}}, /leadId/],
			['start', {snapshot, party: party(), keep: {x: {nested: 1}}}, /plain values/],
			['step', {snapshot, party: party(), choice: {label: 'Go on'}}, /frame\.state/],
			['step', {snapshot, frame: {state: '{}', engineVersion: '1'}, party: party(), choice: {}}, /label or a handle/],
			['move', {snapshot, frame: {state: '{}', engineVersion: '1'}, party: party()}, /move\.to/]
		];
		for (const [call, body, message] of cases) {
			const {code, answer} = await post(base, call, body);
			assert.equal(code, 400, JSON.stringify(body));
			assert.match(answer.message, message);
		}
		const health = await (await fetch(`${base}/health`)).json();
		assert.deepEqual(health, {ok: true, engineVersion: '1', mode: 'shared'});
		assert.equal((await fetch(`${base}/other`, {method: 'POST'})).status, 404);
	} finally {
		await engine.close();
	}
});

test('the engine plays under the permission model it runs with on Cloud Run', async () => {
	const engineDir = path.join(__dirname, '..');
	const script = `
		const {createEngine} = require('./src/server');
		const {story, party} = require('./test/helpers');
		const engine = createEngine({mode: 'single-use', workers: 1});
		engine.handle('start', {snapshot: {id: 'x', story: story({Start: 'Hi $lead.name.<<set $isEnding to "success">>'})}, party: party()})
			.then(({answer}) => { console.log(JSON.stringify({status: answer.status, message: answer.message})); return engine.close(); })
			.then(() => process.exit(0));
	`;
	const output = await new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			['--permission', `--allow-fs-read=${path.join(engineDir, '..')}`, '--allow-worker', '-e', script],
			{cwd: engineDir}
		);
		let out = '';
		let err = '';
		child.stdout.on('data', d => (out += d));
		child.stderr.on('data', d => (err += d));
		child.on('exit', code => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${err}`))));
	});
	assert.deepEqual(JSON.parse(output.trim().split('\n').pop()), {status: 'ok'});
});

test('worker threads keep the permission limits: no files outside, no writes, no programs', async () => {
	const engineDir = path.join(__dirname, '..');
	const script = `
		const {Worker} = require('worker_threads');
		const probe = \`
			const {parentPort} = require('worker_threads');
			const out = {};
			try { require('fs').readFileSync('/etc/hostname'); out.read = 'allowed'; } catch (e) { out.read = e.code; }
			try { require('fs').writeFileSync(require('os').tmpdir() + '/engine-probe', 'x'); out.write = 'allowed'; } catch (e) { out.write = e.code; }
			try { require('child_process').execSync('true'); out.program = 'allowed'; } catch (e) { out.program = e.code; }
			parentPort.postMessage(out);
		\`;
		new Worker(probe, {eval: true}).on('message', m => { console.log(JSON.stringify(m)); process.exit(0); });
	`;
	const output = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${engineDir}`, '--allow-worker', '-e', script]);
		let out = '';
		child.stdout.on('data', d => (out += d));
		child.on('exit', code => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))));
	});
	assert.deepEqual(JSON.parse(output.trim()), {read: 'ERR_ACCESS_DENIED', write: 'ERR_ACCESS_DENIED', program: 'ERR_ACCESS_DENIED'});
});
