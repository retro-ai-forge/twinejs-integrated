# Headless Server-Authoritative Twine Game Deployment

Stories are written in the integrated Twine editor in SugarCube 2.37.3 and played on the Wudlands server. The real SugarCube engine runs in Node.js with jsdom. Players receive only the finished scene (text, images and numbered choices) and send back which choice they picked. They never get the story's other scenes, its variables or the engine.

Updated 2026-11-19. What a story may contain is defined in `docs/STORY-RULES.md` in the main app repository; this document refers to it as "the story rules".

## Goal

- Players can't see the story's logic, its other scenes or its variables.
- Players can't cheat through the browser: they only send the number of the choice they clicked.
- Dice, conditions and branching run on the server.
- The browser is a thin renderer: it shows the scene and sends back a pick.
- Authors test with the same engine players play with.

## Status

| Part | State |
|---|---|
| Editor with cloud sync (`twine_stories`) | Built |
| Image upload per story (Image Manager, bucket stages) | Built |
| Submit check (`_check_twine_syntax` in `backend/auth_routes.py`): metadata, links, endings, `Retreat` and `LastResort`; `TestCharacters` checked and stored apart as `testCharacters` | Built |
| Review: reviewers open a submission in the editor and test-play it | Built |
| Approval: approve or reject after the 7 days, live stories in `twine_live`, images in the `served` stage | Built: Approve and Reject (with a public reason) on the review page, for reviewers |
| Adventure lifecycle (`backend/adventures.py`): start, pinned story versions, run counter, endings, adventure log, recovery | Built, but its step API trusts the browser (see "Replacing the current step API") |
| Story checker for the allowed commands (`backend/story_rules.py`) | Built 2026-11-20: on submit, Save review and Approve |
| Legend changes per character, with each story's points | Planned |
| Predefined tags for checks, and fight scenes | Planned, not designed yet |
| Engine service (Node.js + jsdom + SugarCube) | Proof of concept only (scratch scripts, 2026-11-19) |
| Play screen in the Stories tab | Planned |
| `TestCharacters` loaded in the editor's Test | Planned |
| Several players (wallets) in one adventure | Planned |

## Decisions

- **Engine:** the real SugarCube engine in Node.js with jsdom. A headless browser was dropped for its memory use. A Python reimplementation of the commands was dropped because authors test with SugarCube, so the server has to run SugarCube too.
- **Shared engine processes:** all stories share a small pool of worker processes, to save memory. The risk this leaves is described under "Security". **Changed 2026-11-20:** live and unreviewed stories run in two separate engine services (`engine-live` with shared workers, `engine-test` with single-use workers), and reviewers test-play on `engine-test` instead of in the editor. See `ARCHITECTURE.md` in the main app repository.
- **No external loading:** the engine never fetches anything (scripts, stylesheets, images or network requests), story CSS can't load anything from an address, and images come only from the story's own image list.
- **Only reviewed commands:** a story may only use the forms in the story rules, written as shown there, with no nesting inside tags (see "Allowed commands").
- **Characters are data:** the server puts `$char` and `$lead` into the engine before every scene. `StoryInit` never holds character data.
- **What a story changes:** only the characters' Legend, per character with `+=` and `-=`, in at most 2 pairs (echoes from the Legend rules don't count). Python applies every change by the Legend rules and takes it from points set aside per character and story, at most 10 per pair, so replays and loops can't farm Legend. Injuries and other attribute changes come only from predefined tags (checks) and fight scenes, which Python runs outside the story engine.
- **Stateless clicks:** every click is handled from the state saved in the database, so any container can answer it.

## Architecture

```
Browser (play screen in the Stories tab)
┌──────────────────────────────────────────────────────────┐
│ shows the scene in a sandboxed frame and sends back the  │
│ step counter, the choice number and any options picked   │
└──────────────┬───────────────────────────▲───────────────┘
               │ /api/auth/me/adventures/… │ { html, choices, status }
┌──────────────▼───────────────────────────┴───────────────┐
│ FastAPI (Python, main app)                               │
│  - wallet login, run counter, adventure sessions in DB   │
│  - loads the pinned story, the saved engine state and    │
│    fresh character data                                  │
│  - applies Legend changes; runs checks and fights        │
│  - saves the new state with a conditional update on seq  │
└──────────────┬───────────────────────────▲───────────────┘
               │ internal HTTP             │ { html, choices, state, … }
┌──────────────▼───────────────────────────┴───────────────┐
│ Engine service (Node.js, its own Cloud Run service)      │
│  shared worker processes: jsdom + SugarCube 2.37.3       │
│  - builds the story page with the editor's publish code  │
│  - restores SugarCube's saved state, sets $char/$lead,   │
│    clicks the chosen element, reads the new scene        │
│  - no secrets, no database, no network                   │
└──────────────────────────────────────────────────────────┘
```

| Part | Does | Never does |
|---|---|---|
| Browser | Shows the scene; sends the step counter, choice number and option picks | Receives other scenes, variables, link destinations or the engine |
| FastAPI | Login, run counter, sessions, Legend changes, checks and fights, endings, recovery | Runs story code |
| Engine | Runs SugarCube for one click at a time | Holds secrets, reaches the database or the network, keeps player state between clicks |

### Why jsdom

Measured on 2026-11-19 on a laptop, with the button test story (`myFirstStory`) and TW-tut-04:

| | SugarCube in jsdom | Headless Chromium |
|---|---|---|
| Memory with 1 story open | 88 MB | 336 MB |
| Each extra open story | about 4 MB | about 26 MB |
| CPU per click | about 0.19 s | not measured |

- **Same output as the browser:** two scenes screenshotted from Twine-style browser play and from the engine's HTML plus the story CSS were pixel-identical, with the same clickable elements (5 and 13).
- **Every link form worked:** `[[links]]`, `<<area>>` hotspots, both `<<button>>` forms, `<<link>>`, a button that sets a variable, and radio buttons.
- **One shim needed:** jsdom has no layout, so SugarCube waits forever for a window width. The engine sets a fixed viewport size before SugarCube starts.
- **Memory creep:** over 300 clicks the engine's JavaScript memory stayed flat, but the process grew to about 250 MB. Workers are restarted every few hundred clicks.
- **Not measured yet:** Cloud Run itself.

## Stories: from the editor to the engine

1. **Writing:** the editor keeps stories in the browser's localStorage and syncs them to `twine_stories` (see "Story persistence"). Images are uploaded to the bucket's `create` stage through the Image Manager.
2. **Testing:** the editor's Test plays the story in the author's browser with the same `format.js` and the Wudlands runtime (`src/util/wudlands-runtime.ts`: the `<<area>>` hotspots and the stylesheet layers). A `TestCharacters` scene (JSON, editor only) holds the test party; loading it into `$char` and `$lead` in Test is planned.
3. **Submitting:** `POST /api/auth/me/twine-stories/{id}/submit` runs the submit check and the story checker for the allowed commands (`backend/story_rules.py`), checks the `TestCharacters` party and stores it apart from the scenes as `testCharacters`, stores a frozen copy in `twine_review` and copies the images to the `review` stage. When the checker refuses a story, it names the scene and the line and shows an accepted form to use instead. For 7 days after the last submit the author may submit again, and each submit starts the 7 days again. After that the story is locked and waits for review, with no time limit. A story that passed review (`approved`) is live, and its author can't resubmit it: the route refuses with 409 (`_submit_refusal`, and any story id in `twine_live`), and its final write only replaces an entry still `submitted`, so an approval during a submit isn't overwritten either. Changes go out as a new story with a new id (the editor's Duplicate gives one); only the platform fixes bugs in a live story.
4. **Review:** only stories the author can no longer change, so only after the 7 days. A reviewer opens the story from the review page in the editor (`/twine/#/review/{owner}/{storyId}`, loaded through `GET /api/auth/twine-reviews/{owner}/{storyId}/story`, reviewers only). The editor keeps it as a local review copy (`src/util/review-copies.ts`): new story and passage ids, so an author reviewing their own story keeps their working copy, the author's `review`-stage images, no cloud sync and no Submit. Test and Play work as usual. Then the reviewer approves (`POST /api/auth/twine-reviews/{owner}/{storyId}/approve`) or rejects (`…/reject`); both answer 409 while the author can still change the story. Approval copies the images to the `served` stage, stores the live copy in `twine_live` (`_id` is the story id, so only one live story per id) and keeps the review entry as an `approved` record without the story text. Rejection removes the entry, so the author can fix the story and submit it again. Only stories in `twine_live` can be played.
5. **Starting a run:** the run loads the story from `twine_live` and pins that version in `story_snapshots` (`author:storyId:hash`), so neither a resubmit during review nor a platform fix to a live story changes a running adventure.
6. **Building the playable page:** the engine builds it from the pinned scenes with the editor's own publish code (`src/util/publish.ts`, bundled for Node) and the same `format.js`. The page is then the one the author tested, plus the platform's runtime. The author's Story JavaScript must be empty. Workers cache built pages per snapshot id.

There are no `.twee` files on the server and no Twee parser: the editor already stores stories as lists of scenes.

## Allowed commands

- **Only the reviewed list:** a story may only use the forms in the story rules, in the syntax shown there. Everything else is refused when the story is submitted:
  - SugarCube commands that aren't listed
  - any JavaScript: Story JavaScript, `<<script>>`, `<<run>>`, `<script>`, `on…` attributes
  - the engine's internals: `State`, `Engine`, `Config`, `setup`, `window`, `document`
  - typed input, and destinations built from variables
  - anything that loads from outside the story
- **No nesting inside tags:** a command's `<< >>` and an HTML tag's `< >` never contain another command or HTML tag. The one exception is a `[[link]]` inside `<<button>>`, `<<link>>` and `<<area>>`. `[[ ]]` links draw the lines between scenes in the editor, so authors should use them for every way out of a scene. Commands go between an opening and a closing tag instead, for example `<<set>>` inside `<<button>>…<</button>>`, or `<<if>>` inside `<<for>>` to check whether any character carries a tool.

```
<<button [[Take the sword|Cave]]>><<set $hasSword to true>><</button>>
<<area 0.10 0.20 0.30 0.40 [[Gate]]>>
<<for _i, _c range $char>><<if _c.equipment.includes("rope_1")>><<set _hasRope to true>><</if>><</for>>
```

- **Checked without running:** the checker reads the text of every scene and every branch. SugarCube runs each expression as JavaScript: everything after `to` in `<<set>>`, `<<if>>` conditions, `<<print>>` and link setters. Code can also be put together from pieces of text across several scenes, or hidden in a branch that is only taken for some players or after a date. Playing a story during review can't find that, so the checker accepts only what it can read as one of the listed forms.
- **Printed values stay text:** the engine's runtime shows every printed variable (`<<print>>` and a plain `$name`) as plain text. A name or a stored text can never become a command. Stock SugarCube does not do this; the runtime has to change it.

## Characters, Legend and test characters

- **`$char` and `$lead`:** the engine sets them as data from the characters Python sends, fresh for every new scene. Stories read them and change only their Legend values; anything else written into them is lost at the next scene. Their values and how stories may use them are in the story rules ("Characters"). They are never written into `StoryInit`, which would make player-typed names part of the story's code.
- **Still to align:** today `adventures._character_var` sends `attr` (`migh`, …) and `classes`, with no `name`, professions, equipment or Legend, and `$lead` is only an id. The engine needs the values from the story rules: `firstName`, `name`, `might`, `prof1`, `equipment`, the 20 Legend values (with the fade worked out, `legend.decayed`) and so on. Attributes are the current values, injuries included (`attrNow`).
- **Equipment:** item ids with their tier, each listed with every lower tier too. A tier-3 candle also counts as `candle_1` and `candle_2`, so `.includes("candle_1")` means "a candle of tier 1 or better".
- **Legend:** a story changes each character's Legend values with `+=` and `-=`: `$lead.mercy`, `$char[1].mercy`, or `_c.mercy` in a `range $char` loop. The engine reports each character's changes by name. Python applies them through the Legend rules (`backend/legend.py`: pair scale, echoes, limits, written by `change_legend`), so the result can differ from plain addition in the editor's Test. `$meta_` names are only story settings now.
- **A story's Legend points:** the submit check counts the pairs a story writes changes for (at most 2; echoes don't count) and, per pair, adds up the sizes of the changes written in it, each written change once, at most 10 (planned numbers in `data/legend-rules.json`). The first time a character plays the story, Python stores these points for that character with the run counter (`story_plays`), hidden from players. Each applied change uses up its size, a change bigger than what's left moves only what's left, and a spent pair no longer changes for that character in this story, on any replay. Echoes from the Legend rules don't count. The points come from the version a character first plays and are never refilled: a live story can't be resubmitted, and a platform fix doesn't refill them. A new version is a new story with its own id and its own points, so review must refuse near-copies of a live story, which would hand out the same Legend again.
- **Counting each change once:** a restored scene runs its commands again, and their changes were already counted. So the engine re-shows the current scene with the character data it was first shown with (then the choice numbers the player saw match too) and counts only what follows: the clicked element's commands, then the new scene's own. Fresh data from Python goes in when the new scene begins, with the click's changes added on.
- **Attributes:** story code never changes them. Checks and fight scenes do, in Python (see "Checks and fight scenes").
- **Test characters:** a `TestCharacters` scene in the editor holds up to 4 characters as JSON, checked like real ones (`backend/test_characters.py`). On submit it is stored apart from the scenes as the submission's `testCharacters`, for test runs; it never reaches a real adventure.

## One click, step by step

### Starting

1. The browser sends `POST /api/auth/me/adventures` with the story, the characters and the lead.
2. Python runs the existing checks (dead, crafting, foraging, already adventuring), takes a run, claims the characters and pins the story version.
3. The engine builds the page and starts SugarCube, which runs `StoryInit`. It then sets `$char` and `$lead`, renders the start scene and returns it with the saved state and the start scene's Legend changes.
4. Python stores the state with the session (`status: active`, `seq: 0`) and applies those changes the same way as a step's (below).

### Each step

1. The browser sends `POST /api/auth/me/adventures/{id}/step` with `{seq, choice, picks}`. `choice` is the number of a clickable element in the current scene. `picks` holds the option numbers chosen in its radio buttons, checkboxes, drop-downs and cycles.
2. Python refuses a stale `seq` with 409 and the current state, as today. It loads the pinned story, the saved state and fresh character data.
3. The engine restores SugarCube from the saved state, the way a browser reload does. The state is the scene and its variables as they were when the scene began, character data included, so the scene renders the same way every time, dice included. Besides that scene, only the startup code runs again: the platform's runtime and `StoryInit`, whose values the saved state then replaces. The start scene doesn't run again.
4. The engine applies the picks, clicks the chosen element (its commands and setters run, and SugarCube moves to the next scene, which gets the fresh character data), cleans and numbers the new scene, and returns it with the new state, `$isEnding` and each character's Legend changes.
5. Python saves the state with `seq + 1` in a conditional update and applies the Legend changes, taking them from the story's points, in one transaction, so a repeated or racing request applies them once. On an ending it finishes the run (the existing `_finalize`).
6. The browser shows the new scene.

A forged choice number can only pick another clickable element of the current scene. A repeated or stale request gets the current state.

### Retreat and LastResort

- **Retreat:** the play screen offers it while `$meta_allowRunAway` is true in the engine's state, the same variable the author sees in Test. Python then asks the engine to move to `Retreat`. Today's step check reads each scene's own `<<set>>` or the `StoryInit` value instead; that difference goes away. A retreat costs no Legend unless the story's Retreat scenes set a small price, which counts like any other change. A run that ends there uses up the run but never counts as completed.
- **LastResort:** only the server sends a run there, when the engine fails (an error, or the time limit). Players can't ask for it any more. Whether the player still gets the run back when the adventure has already applied effects is open (see "Open points").

## Checks and fight scenes (planned)

Story code never injures a character or changes its attributes. Two parts of the platform will, run by Python outside the story engine:

- **Checks:** the story marks where a check happens with a predefined tag, such as a difficult jump. The engine only reports the tag. Python rolls the check with the characters' current values and settles what a failure costs, such as an injury through the condition rules (`condition.apply_loss`).
- **Fight scenes:** made by the platform, not part of the submitted story, with a fixed layout in the play screen. Python runs the fight and applies its results to the characters. When it ends, the player returns to the story's last scene.

Still to design: the tags' form, what the story learns about a result, and how returning to a scene keeps it from starting the same check or fight again, since a restored scene runs its commands again.

## Saving and scaling

- **Sessions:** `adventure_sessions` holds SugarCube's saved state (about 2 KB for the test story) with `seq` and `status`. Every write is the existing conditional update on `seq` (`find_one_and_update_checked`).
- **Workers keep nothing about players:** only built story pages per snapshot id, which are rebuilt after a restart.
- **Any container can answer:** the main app and the engine both scale out. A crash mid-click leaves the old state in place, and the retry runs the click again.
- **Same result on retry:** restoring the same state twice gave identical HTML in the test.

## What the player receives

- **Scene HTML, cleaned:** no scripts, no event attributes, no `data-passage` or other link targets. Clickable elements become numbered buttons and links that keep their classes, so the story stylesheet still applies (for example `.row`). Image names are rewritten to the story's bucket URLs.
- **The story stylesheet:** checked at submit (no `url()`, `@import` and the like) and applied inside a sandboxed frame without scripts, so it can't style or reach the rest of the app.
- **Never:** other scenes, variables the scene doesn't print, link destinations, the engine, or other players' state.

## Security

### What story code could do in the engine

In the 2026-11-19 tests, a single `<<set>>` line reached the Node.js process outside jsdom. From there it ran a shell command, read a file, read all environment variables and sent a network request.

It also replaced a function shared by every page in the process. On the next click in that process, for a different story and player:
- the scene came back with an extra link added
- that player's scene and variables were sent to an outside server

jsdom's script settings can't prevent this:
- With scripts off, SugarCube never starts.
- With `runScripts: "outside-only"`, a plain `<<set>>` in `StoryInit` still reached the server process.
- SugarCube runs the story's commands as JavaScript inside the same page.

### Layers of protection

1. **Story checker at submit**, the main protection: only the listed forms pass, and nothing is run during the check.
2. **Review before play:** only approved stories (`twine_live`) can be played; a submitted story can only be reviewed.
3. **The engine is its own service:**
   - an empty environment (no secrets)
   - a service account without permissions
   - reachable only from the backend
   - Node's permission model on: no child processes, and no file access beyond its own files (in the test it blocked the shell command and the file read)
   - no outbound network, enforced by the platform, because Node 22's permission model can't block network access
   - a time limit per click (2 seconds stopped an endless loop in the test) and a memory limit
4. **jsdom settings:** `runScripts: "dangerously"` is required, because SugarCube itself is a script. `resources` stays off, so the page fetches nothing.
5. **Worker recycling:** shared workers restart every few hundred clicks. Memory needs this anyway, and it limits how long a compromised worker lasts.
6. **Python doesn't trust the engine's output:** it cleans the HTML again and checks the reported changes against its own rules and limits.

### Accepted risk of shared processes

Decided on 2026-11-19: stories share worker processes to save memory. A harmful story that gets past the checker and review could do the following to other stories' sessions in the same worker until that worker restarts:
- change their scenes, for example add a fake "reconnect your wallet" message
- read their text and players' variables
- push their players into `LastResort`
- report false results (Legend changes still stay within each story's points)

Separate workers per author would close this at about 90 to 250 MB per active author. Revisit this if story submission opens to everyone.

## Play screen in the app

- **The Stories tab:** during an adventure it shows the play screen: the scene in its frame, the numbered choices, Retreat when allowed, and toolbar buttons that switch to the existing Stats, Body and Camp tabs. Stories have no character sheets or inventories of their own.
- **Gear changes:** changes made on other tabs during an adventure reach the story at the next scene, because character data is sent fresh with every click. No sync endpoint is needed.
- **Effects:** story code never writes character data. The engine reports Legend changes and Python applies them by its rules. Injuries, items and anything else come only from Python, through checks, fights and other predefined tags.
- **Ending a run:** the existing `_finalize` writes the adventure log, settles the run counter, updates stats, uses up provisions and releases the characters. Only a `finished` run (an ending reached from the start) adds the story to `completedStories`, which unlocks follow-up stories; `run_away` (an ending of the Retreat graph, which the submit check keeps apart from the main one) and `aborted` never do.

### Replacing the current step API

Today `POST /api/auth/me/adventures/{id}/step` takes `{seq, fromPassage, toPassage, vars}`, and `GET …/story` returns every scene. That was built for a story running in the browser, and it can be abused:
- a jump to `LastResort` gives the run back
- every ending can be read in advance
- links inside a false `<<if>>` can still be taken
- the browser supplies the variables

With the engine:
- **Step:** takes `{seq, choice, picks}`, and the server works out the next scene.
- **Story endpoint:** `GET …/story` is removed.
- **Variables:** variables from the browser are never accepted. `serverVars` becomes the character data sent to the engine.
- **Step graph:** `backend/twine_graph.py` stays for the submit check (endings, reachable scenes, `Retreat` kept apart from the main story) but no longer decides steps.

## Engine service layout (planned)

```
twine-engine/            Node.js service, deployed as its own Cloud Run service
├── server.js            internal HTTP API: start, choose, move to Retreat or LastResort
├── workers.js           pool of shared worker processes, recycled every few hundred clicks
├── page.js              builds the story page: the editor's publish code + format.js + runtime
├── run.js               one click: restore, picks, click, fresh $char/$lead, count Legend changes, clean, save
├── shims.js             fixed viewport size and other jsdom gaps
└── Dockerfile           Node only, no secrets, no outbound network
```

The main app's Dockerfile stays as it is. FastAPI calls the engine over internal HTTP with a time limit.

## Images

- **Storage:** a GCS bucket, by stage (`backend/twine_images.py`). `twine-images/{wallet}/create/{storyId}/` is the author's working copy, `review/` the copy frozen on submit, and `served/` the production copy (copying to it on approval is planned).
- **Access:** files are public by exact URL but the bucket can't be listed. Uploads go only through the backend, and images are converted to WebP in the browser.
- **In stories:** images are referenced by file name (`[img[oasis.webp]]`). The submit check refuses names that weren't uploaded, and the engine's output points them at the bucket.
- **Later, if needed:** signed URLs (to stop sharing spoiler links) or a CDN or R2 in front of `served` (for egress costs). Either is a backend-only change.
- **Audio:** not supported. It needs a live browser, and the story rules refuse it.

## Side stories (future, needs a redesign)

The idea stays: short stories, written separately, that appear by chance as an extra choice in scenes with a matching tag, then return the player to the main story. The earlier sketch injected scenes into a running headless browser and granted rewards by changing `State.variables`, which no longer fits. A redesign has to keep to these points:

- Side stories are stories like any other: same editor, same checker, same review.
- The platform, not story code, adds their scenes to the page and moves the player in and out.
- Rewards go through Python's rules.
- The side story's scenes and position are part of the pinned story version and the saved state, so the click flow stays stateless.

## Story persistence — cloud sync (built)

The editor keeps stories in the browser's localStorage, which is limited (about 5 MB, cleared with browser data, evicted by Safari after 7 days without use, and not shared between devices). The database copy is the safety net and gives access from other devices.

- **Collection:** `twine_stories`, one document per story, keyed by `(address, storyId)`, with `name`, `ifid`, `storyData` (format, start passage, stylesheet, script, tags, zoom) and `passages` (`id`, `name`, `text`, `tags`, position and size).
- **Endpoints**, all requiring wallet login:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/auth/me/twine-stories` | List the author's stories |
| `GET` | `/api/auth/me/twine-stories/{storyId}` | One story with its scenes |
| `PUT` | `/api/auth/me/twine-stories/{storyId}` | Create or update (upsert) |
| `DELETE` | `/api/auth/me/twine-stories/{storyId}` | Delete |

- **Sync:** edits save to localStorage at once and to the database 10 seconds after the last change (`DEBOUNCE_MS` in `src/store/persistence/cloud-sync/cloud-sync-context.tsx`). On load, cloud and local copies are merged by `lastUpdate`.
- **Key files:** `src/store/persistence/cloud-sync/` (`cloud-api.ts`, `cloud-sync-context.tsx`, `use-queue-story-sync.ts`, `cloud-sync-badge.tsx`).

## Special scenes and story data

- **Story data:** the editor stores the title (`name`), the IFID and the story data (start scene, format, stylesheet, script) as fields of the story document. No `StoryData` or `StoryTitle` passage is parsed on the server.
- **Allowed special scenes:** `StoryInit` (story setup, no character data), `Retreat` and `LastResort` (required by the submit check), and `TestCharacters` (the test party, stored apart from the scenes on submit).
- **Story Stylesheet:** allowed, and checked (see the story rules).
- **Story JavaScript:** must be empty. The platform adds its own runtime.
- **Not allowed:** `PassageReady`, `PassageDone`, `PassageHeader`, `PassageFooter`, `StoryInterface`, `StoryCaption`, `StoryMenu`, `StoryBanner`, and the scene tags `widget`, `init` and `script`.
- **Sidebar passages** (`StoryAuthor`, `StorySubtitle`, `StoryShare` and the like) have no effect. Only the scene itself is sent, and the app provides its own controls.

## Open points

1. **LastResort refunds:** should a run that ends in `LastResort` still get its run back after it has applied effects? The recommendation is to refund only runs that applied none.
2. **Several wallets in one adventure:** this needs invitations, access for every member, a rule for who pays, and polling. The recommendation is that the lead chooses for the group.
3. **Checks and fight scenes:** the tags' form, what the story learns about a result, and returning to a scene without repeating it (see "Checks and fight scenes").
4. **Character value names:** the story rules use `might`, `firstName`, `name`, `prof1` and so on. The backend's `$char` must be aligned with them.
5. **Quoted button forms:** keep `<<button "Go" "Cave">>` and `<<goto>>` inside buttons, or accept only `[[ ]]` forms so that every exit draws a line in the editor.
6. **Printed values as text:** the runtime change that makes `<<print>>` and plain `$name` show values as plain text.
