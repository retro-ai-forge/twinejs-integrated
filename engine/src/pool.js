// Runs engine calls in worker threads, with a time and a memory limit
// (ARCHITECTURE.md "Engines"):
//
//   single-use (engine-test, unreviewed stories): every call gets a fresh
//     worker, ended afterwards, so a story can only damage its own call. A few
//     workers are started in advance, so the call doesn't wait for one.
//   shared (engine-live, reviewed stories): a fixed number of workers play many
//     calls each and are replaced after `recycleAfter` calls (the process grows
//     slowly, measured 2026-11-19).
//
// A call over the time limit ends its worker: the answer is time_limit. A
// worker that dies (out of memory, a crash) answers story_error. Each worker is
// a separate JavaScript world (V8 isolate); the whole process runs under Node's
// permission model (no child processes, files read only below the engine).

const os = require('os');
const path = require('path');
const {Worker} = require('worker_threads');
const {ENGINE_VERSION} = require('./version');

const WORKER_FILE = path.join(__dirname, 'worker.js');

class EngineWorker {
	constructor(memoryMb) {
		this.calls = 0;
		this.dead = false;
		this.pending = null;
		this.worker = new Worker(WORKER_FILE, {
			resourceLimits: {maxOldGenerationSizeMb: memoryMb, maxYoungGenerationSizeMb: 32},
			stdout: false,
			stderr: false
		});
		this.ready = new Promise(resolve => {
			const onReady = message => {
				if (message && message.ready) {
					this.worker.off('message', onReady);
					resolve(true);
				}
			};
			this.worker.on('message', onReady);
			this.worker.once('exit', () => resolve(false));
		});
		this.worker.on('message', message => {
			if (this.pending && message && message.id === this.pending.id) {
				const {finish} = this.pending;
				finish(message.answer);
			}
		});
		this.worker.on('error', error => this.fail(`the engine worker failed: ${error.message}`));
		this.worker.on('exit', () => {
			this.dead = true;
			this.fail('the engine worker stopped');
		});
	}

	fail(message) {
		if (this.pending) {
			const {finish} = this.pending;
			finish({status: 'story_error', engineVersion: ENGINE_VERSION, message});
		}
	}

	async run(id, call, html, request, timeLimitMs) {
		if (!(await this.ready) || this.dead) {
			return {status: 'story_error', engineVersion: ENGINE_VERSION, message: 'the engine worker did not start'};
		}
		this.calls += 1;
		return new Promise(resolve => {
			const timer = setTimeout(() => {
				finish({status: 'time_limit', engineVersion: ENGINE_VERSION, message: `over ${timeLimitMs} ms`});
				this.end();
			}, timeLimitMs);
			const finish = answer => {
				if (!this.pending) {
					return;
				}
				this.pending = null;
				clearTimeout(timer);
				resolve(answer);
			};
			this.pending = {id, finish};
			this.worker.postMessage({id, call, html, request});
		});
	}

	end() {
		this.dead = true;
		this.worker.terminate().catch(() => {});
	}
}

class EnginePool {
	constructor({
		mode = 'shared',
		workers = Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length)),
		spare = 1,
		recycleAfter = 300,
		timeLimitMs = 2000,
		memoryMb = 256
	} = {}) {
		if (!['shared', 'single-use'].includes(mode)) {
			throw new Error(`unknown worker mode ${mode}`);
		}
		Object.assign(this, {mode, spare, recycleAfter, timeLimitMs, memoryMb});
		this.nextId = 0;
		this.queue = [];
		this.closed = false;
		if (mode === 'shared') {
			this.idle = Array.from({length: workers}, () => new EngineWorker(memoryMb));
		} else {
			this.maxRunning = workers;
			this.running = 0;
			this.spares = Array.from({length: spare}, () => new EngineWorker(memoryMb));
		}
	}

	run(call, html, request) {
		if (this.closed) {
			return Promise.resolve({status: 'story_error', engineVersion: ENGINE_VERSION, message: 'the engine is shutting down'});
		}
		return new Promise(resolve => {
			this.queue.push({call, html, request, resolve});
			this.next();
		});
	}

	next() {
		while (this.queue.length) {
			const worker = this.takeWorker();
			if (!worker) {
				return;
			}
			const job = this.queue.shift();
			this.nextId += 1;
			worker
				.run(this.nextId, job.call, job.html, job.request, this.timeLimitMs)
				.then(answer => {
					job.resolve(answer);
					this.giveBack(worker);
				});
		}
	}

	takeWorker() {
		if (this.mode === 'shared') {
			return this.idle.shift() || null;
		}
		if (this.running >= this.maxRunning) {
			return null;
		}
		this.running += 1;
		// The replacement is started once this call is done (giveBack), so it
		// doesn't take CPU from the call (engine-test has a single vCPU).
		return this.spares.shift() || new EngineWorker(this.memoryMb);
	}

	giveBack(worker) {
		if (this.mode === 'shared') {
			if (worker.dead || worker.calls >= this.recycleAfter) {
				worker.end();
				if (!this.closed) {
					this.idle.push(new EngineWorker(this.memoryMb));
				}
			} else {
				this.idle.push(worker);
			}
		} else {
			worker.end();
			this.running -= 1;
			if (!this.closed && this.spares.length < this.spare) {
				this.spares.push(new EngineWorker(this.memoryMb));
			}
		}
		this.next();
	}

	async close() {
		this.closed = true;
		for (const worker of [...(this.idle || []), ...(this.spares || [])]) {
			worker.end();
		}
	}
}

module.exports = {EnginePool};
