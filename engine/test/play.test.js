// One call at a time, in the real SugarCube 2.37.3 (src/play.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const {story, withTags, party, Player, text, ALRIK, BRENA} = require('./helpers');

test('start shows the start scene with the party, and its choices', async () => {
	const player = new Player(
		story({
			StoryInit: '<<set $meta_allowRunAway to true>>',
			Start: 'Hello $lead.name and $char[1].name.\n[[Go on|Next]]\n<<button "Wait">><<goto "Next">><</button>>',
			Next: 'Done.<<set $isEnding to "success">>'
		})
	);
	const answer = await player.start();
	assert.equal(answer.status, 'ok');
	assert.equal(answer.engineVersion, '1');
	assert.deepEqual(answer.scene, {name: 'Start', tags: []});
	assert.match(text(answer), /Hello Alrik and Brena\./);
	assert.deepEqual(answer.choices, [{label: 'Go on'}, {label: 'Wait'}]);
	assert.equal(answer.allowRunAway, true);
	assert.equal(answer.ending, null);
	assert.deepEqual(answer.requests, []);
});

test('the cleaned scene keeps text and classes, nothing behind them', async () => {
	const player = new Player(
		story({
			Start:
				'<span class="red">Look.</span> [img[gate.webp]]\n[[Enter the cave|Cave]] [[Camp]]\n' +
				'<<area 0.10 0.20 0.30 0.40 [[Cave]]>>\n<<link [[Rest|Camp]]>><<set $rested to true>><</link>>',
			Cave: 'Dark.<<set $isEnding to "success">>',
			Camp: 'Warm.<<set $isEnding to "success">>'
		})
	);
	const {html, choices} = await player.start();
	for (const leak of ['data-passage', 'href', 'title=', 'aria-label', 'Cave"', 'passage-start', 'id=', '$rested', 'onclick']) {
		assert.ok(!html.includes(leak), `${leak} in ${html}`);
	}
	assert.match(html, /<span class="red">Look\.<\/span>/);
	assert.match(html, /<img src="gate\.webp"/);
	// In page order: the hotspot lies on the image at the top.
	assert.deepEqual(choices, [{handle: 'h1'}, {label: 'Enter the cave'}, {label: 'Camp'}, {label: 'Rest'}]);
	assert.match(html, /class="wud-hotspot" data-choice="0" style="position:absolute;box-sizing:border-box;left:10%;top:20%;width:30%;height:40%"/);
});

test('a step follows the clicked label, a hotspot its handle', async () => {
	const scenes = {
		Start: '[img[gate.webp]]\n<<area 0.10 0.20 0.30 0.40 [[Gate]]>>\n[[Walk on->Road]]',
		Gate: 'At the gate.<<set $isEnding to "success">>',
		Road: 'On the road.<<set $isEnding to "success">>'
	};
	const byLabel = new Player(story(scenes));
	await byLabel.start();
	const road = await byLabel.click('walk  ON');
	assert.equal(road.scene.name, 'Road');
	assert.equal(road.ending, 'success');

	const byHandle = new Player(story(scenes));
	await byHandle.start();
	assert.equal((await byHandle.click('h1')).scene.name, 'Gate');
});

test('a label that is not in the scene is refused, and nothing runs', async () => {
	const player = new Player(story({Start: '[[Go on|Next]]', Next: 'x<<set $isEnding to "success">>'}));
	const started = await player.start();
	const answer = await player.click('Fly away');
	assert.equal(answer.status, 'refused');
	assert.equal(answer.reason, 'label_gone');
	assert.equal(answer.scene.name, 'Start');
	assert.equal(answer.state, started.state);
});

test('picks: radio buttons, checkboxes, drop-downs and cycles reach the next scene', async () => {
	const player = new Player(
		story({
			StoryInit: '<<set $path to "none">><<set $careful to false>><<set $weapon to "none">><<set $stance to "none">>',
			Start:
				'<label><<radiobutton "$path" "north">> North</label> <label><<radiobutton "$path" "south">> South</label>\n' +
				'<label><<checkbox "$careful" false true>> Move carefully</label>\n' +
				'<<listbox "$weapon">><<option "Sword" "sword">><<option "Bow" "bow">><</listbox>>\n' +
				'<<cycle "$stance">><<option "Defensive" "defensive">><<option "Bold" "bold">><<option "Wild" "wild">><</cycle>>\n' +
				'[[Set out->Road]]',
			Road: 'Path $path, careful $careful, weapon $weapon, stance $stance.<<set $isEnding to "success">>'
		})
	);
	const start = await player.start();
	assert.deepEqual(start.inputs, [
		{kind: 'radio', labels: ['North', 'South'], picked: null},
		{kind: 'checkbox', label: 'Move carefully', checked: false},
		{kind: 'listbox', options: ['Sword', 'Bow'], picked: 'Sword'},
		{kind: 'cycle', options: ['Defensive', 'Bold', 'Wild'], picked: 'Defensive'}
	]);
	const road = await player.click('Set out', ['South', 'Move carefully', 'Bow', 'Wild']);
	assert.equal(road.status, 'ok', road.message);
	assert.match(text(road), /Path south, careful true, weapon bow, stance wild\./);
});

test('a pick that is not in the scene refuses the click', async () => {
	const player = new Player(
		story({
			Start: '<label><<radiobutton "$path" "north">> North</label>\n[[Set out->Road]]',
			Road: 'x<<set $isEnding to "success">>'
		})
	);
	await player.start();
	const answer = await player.click('Set out', ['West']);
	assert.equal(answer.status, 'refused');
	assert.equal(answer.reason, 'pick_gone');
});

test('a click that stays in the scene keeps its change for the next click', async () => {
	const player = new Player(
		story({
			StoryInit: '<<set $water to 3>>',
			Well: '<<link "Drink">><<set $water -= 1>><</link>>\n<<button [[Walk on|Road]]>><</button>>',
			Road: 'Water $water.<<set $isEnding to "success">>'
		})
	);
	await player.start();
	const drink = await player.click('Drink');
	assert.equal(drink.scene.name, 'Well');
	assert.equal((await player.click('Drink')).status, 'ok');
	assert.match(text(await player.click('Walk on')), /Water 1\./);
});

test('a number rolled in the scene text is the one the button sees', async () => {
	const player = new Player(
		story({
			Start: '<<set $roll to random(1, 1000000)>>\n<<button "Go on">><<set $seen to $roll>><<goto "Next">><</button>>',
			Next: 'x<<set $isEnding to "success">>'
		})
	);
	await player.start();
	const rolled = JSON.parse(player.state).active.roll;
	const next = await player.click('Go on');
	assert.equal(JSON.parse(next.state).active.seen, rolled);
});

test('Legend changes are counted once: the click and the new scene, never the re-shown one', async () => {
	const player = new Player(
		story({
			Start: '<<set $lead.mercy += 1>>\n<<button [[Spare him|Next]]>><<set $lead.mercy += 3>><</button>>',
			Next:
				'<<set $lead.courage += 2>><<set $char[1].mercy += 1>><<for _i, _c range $char>><<set _c.courage += 1>><</for>>\n' +
				'<<set $lead.might to 99>>[[On|End]]',
			End: 'x<<set $isEnding to "success">>'
		})
	);
	const start = await player.start();
	assert.deepEqual(start.legend, {c1: {mercy: 1}});
	// The control layer applied that +1 and sends the fresh values.
	player.party = {...party(), now: [{...ALRIK, mercy: 11}, BRENA], shown: [{...ALRIK, mercy: 10}, BRENA]};
	const next = await player.click('Spare him');
	assert.deepEqual(next.legend, {c1: {mercy: 3, courage: 3}, c2: {mercy: 1, courage: 1}});
});

test('$picked is the one picked, else the lead; $keep_ values come in and their changes go out', async () => {
	const hut = {
		StoryInit: '<<set $keep_metHermit to false>>',
		Hut: '<<if $keep_metHermit>>You again, $picked.name.<<else>>A stranger, $picked.name.<</if>>\n[[Greet him->Fire][$keep_metHermit to true]]',
		Fire: 'Warm.<<set $isEnding to "success">>'
	};

	// Remembered from an earlier run, and Brena picked.
	const returning = await new Player(story(hut), party(undefined, 'c1', 'c2')).start({metHermit: true});
	assert.match(text(returning), /You again, Brena\./);
	assert.deepEqual(returning.keep, {});

	// A first visit, nobody picked: $picked is the lead.
	const first = new Player(story(hut));
	assert.match(text(await first.start()), /A stranger, Alrik\./);
	assert.deepEqual((await first.click('Greet him')).keep, {metHermit: true});
});

test('results are written into a resumed frame before the click', async () => {
	const player = new Player(
		story({
			Harbour: '<<button "Back aboard">><<if $sideResult is "fled">><<goto "Ashore">><<else>><<goto "Aboard">><</if>><</button>>',
			Ashore: 'Ashore.<<set $isEnding to "success">>',
			Aboard: 'Aboard.<<set $isEnding to "success">>'
		})
	);
	await player.start();
	const answer = await player.click('Back aboard', [], {results: {sideResult: 'fled'}});
	assert.equal(answer.scene.name, 'Ashore');
});

test('move goes to Retreat, scene tags come along', async () => {
	const storyDoc = withTags(
		story({
			Start: '[[On|Inn]]',
			Inn: 'A bed.[[Sleep|End]]',
			End: 'x<<set $isEnding to "success">>',
			Retreat: 'You run.<<set $isEnding to "failure">>'
		}),
		'Inn',
		['camp']
	);
	const player = new Player(storyDoc);
	await player.start();
	const inn = await player.click('On');
	assert.deepEqual(inn.scene.tags, ['camp']);
	const retreat = await player.move('Retreat');
	assert.equal(retreat.scene.name, 'Retreat');
	assert.equal(retreat.ending, 'failure');
});

test('random jumps land in one of their scenes', async () => {
	const storyDoc = story({
		Start: '<<button "Turn the page">><<goto `"Page" + random(1, 3)`>><</button>>',
		Page1: 'One.<<set $isEnding to "success">>',
		Page2: 'Two.<<set $isEnding to "success">>',
		Page3: 'Three.<<set $isEnding to "success">>'
	});
	const reached = new Set();
	const player = new Player(storyDoc);
	await player.start();
	const startState = player.state;
	for (let i = 0; i < 12; i++) {
		player.state = startState;
		reached.add((await player.click('Turn the page')).scene.name);
	}
	assert.ok([...reached].every(name => ['Page1', 'Page2', 'Page3'].includes(name)), [...reached].join());
	assert.ok(reached.size >= 2);
});

test('visited() counts across steps', async () => {
	const player = new Player(
		story({
			Start: 'Visits <<print visited("Start")>>.\n[[Again->Start]]'
		})
	);
	await player.start();
	await player.click('Again');
	const third = await player.click('Again');
	assert.match(text(third), /Visits 3\./);
});

test('a story error answers story_error', async () => {
	const player = new Player(story({Start: 'Broken <<nosuchmacro>> here.[[On|End]]', End: 'x<<set $isEnding to "success">>'}));
	const answer = await player.start();
	assert.equal(answer.status, 'story_error');
	assert.match(answer.message, /nosuchmacro/);
});

test('an unreadable state answers story_error', async () => {
	const player = new Player(story({Start: '[[On|End]]', End: 'x<<set $isEnding to "success">>'}));
	player.state = '{"nope":1}';
	const answer = await player.click('On');
	assert.equal(answer.status, 'story_error');
});

test('the page has no network: fetch and XMLHttpRequest are gone', async () => {
	const player = new Player(
		story({
			Start: 'fetch <<print typeof fetch>>, xhr <<print typeof XMLHttpRequest>>, socket <<print typeof WebSocket>>.<<set $isEnding to "success">>'
		})
	);
	const answer = await player.start();
	assert.match(text(answer), /fetch undefined, xhr undefined, socket undefined\./);
});

test("a story's own Story JavaScript is never played", async () => {
	const storyDoc = story({Start: 'Value <<print typeof window.planted>>.<<set $isEnding to "success">>'});
	storyDoc.storyData.script = 'window.planted = 1;';
	const answer = await new Player(storyDoc).start();
	assert.match(text(answer), /Value undefined\./);
});
