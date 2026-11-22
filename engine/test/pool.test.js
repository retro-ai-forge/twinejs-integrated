// Calls in worker threads: both modes, the time limit, a dying worker.

const test = require('node:test');
const assert = require('node:assert/strict');
const {EnginePool} = require('../src/pool');
const {buildPage} = require('../src/page');
const {story, party} = require('./helpers');

const plain = buildPage(story({Start: 'Hello $lead.name.[[On|End]]', End: 'x<<set $isEnding to "success">>'}));
// Raw SugarCube, not a story the check would let through: an endless loop.
const endless = buildPage(story({Start: '<<run while (true) {}>>'}));

for (const mode of ['single-use', 'shared']) {
	test(`${mode}: calls run in workers, also several at once`, async () => {
		const pool = new EnginePool({mode, workers: 2, timeLimitMs: 5000});
		try {
			const answers = await Promise.all(
				[1, 2, 3].map(() => pool.run('start', plain, {party: party()}))
			);
			for (const answer of answers) {
				assert.equal(answer.status, 'ok', answer.message);
				assert.equal(answer.scene.name, 'Start');
			}
		} finally {
			await pool.close();
		}
	});

	test(`${mode}: a call over the time limit answers time_limit, and the next call works`, async () => {
		const pool = new EnginePool({mode, workers: 1, timeLimitMs: 1500});
		try {
			const stuck = await pool.run('start', endless, {party: party()});
			assert.equal(stuck.status, 'time_limit');
			const after = await pool.run('start', plain, {party: party()});
			assert.equal(after.status, 'ok', after.message);
		} finally {
			await pool.close();
		}
	});
}

test('shared workers are replaced after recycleAfter calls', async () => {
	const pool = new EnginePool({mode: 'shared', workers: 1, recycleAfter: 2, timeLimitMs: 5000});
	try {
		const first = pool.idle[0];
		await pool.run('start', plain, {party: party()});
		await pool.run('start', plain, {party: party()});
		assert.notEqual(pool.idle[0], first);
		assert.equal((await pool.run('start', plain, {party: party()})).status, 'ok');
	} finally {
		await pool.close();
	}
});
