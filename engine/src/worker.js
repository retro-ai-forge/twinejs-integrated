// A worker thread that plays engine calls (src/play.js). The parent (pool.js)
// never runs story code; each worker is its own JavaScript world, so story
// code in one can't reach another worker's pages or players.

const {parentPort} = require('worker_threads');
const {play} = require('./play');

parentPort.on('message', async ({id, call, html, request}) => {
	let answer;
	try {
		answer = await play(call, html, request);
	} catch (error) {
		answer = {status: 'story_error', message: String(error && error.message).slice(0, 300)};
	}
	parentPort.postMessage({id, answer});
});

parentPort.postMessage({ready: true});
