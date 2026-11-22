// Run by the Cloud Run job engine-egress-check (the app's
// scripts/deploy_engines.sh), with the engines' image and network settings:
// nothing on the internet may answer from there (SETUP.md "Story engines",
// step 5). Exits 0 when every attempt fails, 1 when any gets through.
// Never part of the engine service itself.
//
// Name lookups count too: a lookup of <data>.attacker.example carries data to
// the attacker's name server even when no connection is possible, so any
// answer - "no such name" included - means the question got out.

const dns = require('dns');
const net = require('net');

const ATTEMPTS = [
	['www.google.com', 443],
	['example.com', 80],
	['1.1.1.1', 443],
	['8.8.8.8', 53]
];
const TIMEOUT_MS = 5000;
// A name nobody has looked up before, so no cache can answer it.
const LOOKUPS = ['example.com', `egress-check-${Date.now()}.example.com`];
// Answers from a name server: the question reached one.
const ANSWER_CODES = ['ENOTFOUND', 'ENODATA'];

function connect(host, port) {
	return new Promise(resolve => {
		const socket = net.connect({host, port});
		const done = result => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(TIMEOUT_MS, () => done('blocked (timeout)'));
		socket.once('connect', () => done('CONNECTED'));
		socket.once('error', error => done(`blocked (${error.code || error.message})`));
	});
}

async function fetchOnce(url) {
	try {
		const response = await fetch(url, {signal: AbortSignal.timeout(TIMEOUT_MS)});
		return `CONNECTED (HTTP ${response.status})`;
	} catch (error) {
		return `blocked (${(error.cause && error.cause.code) || error.name})`;
	}
}

async function lookup(name) {
	const resolver = new dns.promises.Resolver({timeout: TIMEOUT_MS, tries: 1});
	try {
		const addresses = await resolver.resolve4(name);
		return `ANSWERED (${addresses.length} address${addresses.length === 1 ? '' : 'es'})`;
	} catch (error) {
		if (ANSWER_CODES.includes(error.code)) {
			return `ANSWERED (${error.code})`;
		}
		return `blocked (${error.code || error.message})`;
	}
}

(async () => {
	const results = [];
	for (const [host, port] of ATTEMPTS) {
		results.push([`${host}:${port}`, await connect(host, port)]);
	}
	results.push(['https://www.google.com', await fetchOnce('https://www.google.com')]);
	for (const name of LOOKUPS) {
		results.push([`lookup ${name}`, await lookup(name)]);
	}
	for (const [target, result] of results) {
		console.log(`${target.padEnd(48)} ${result}`);
	}
	const open = results.filter(([, result]) => /^(CONNECTED|ANSWERED)/.test(result));
	if (open.length) {
		console.log(`FAILED: ${open.length} attempt(s) got out - the engines' network has a way out`);
		process.exit(1);
	}
	console.log('OK: nothing got out');
})();
