# Twine and SugarCube inside The Wudlands

How the integrated Twine editor and SugarCube 2.37.3 behave inside, what of that is dangerous or awkward for a server-authoritative game, and how we cope with it: the story check, the editor's protections, and the engine that runs SugarCube in Node.js with jsdom.

Updated 2026-11-21. The platform side lives in the main app repository: services and their rights, the story's way from submit to live, and how `serverless-wudlands` controls every adventure (the story stack with side stories and fights, checks, Legend, endings) are in `ARCHITECTURE.md`. What a story may contain is in `docs/STORY-RULES.md` ("the story rules").

## Status

| Part | State |
|---|---|
| Editor with cloud sync (`twine_stories`) and the Image Manager | Built |
| Built-in story formats only (Paperthin, SugarCube 2.37.3) | Built 2026-11-20 |
| Sealed frame for every story run in the editor | Built 2026-11-20; no dialogs and no network since 2026-11-21 |
| Review copies (a submission opened in a reviewer's editor) | Built; re-checked when opened, since 2026-11-21 |
| Story check (`backend/story_rules.py`, `_check_twine_syntax`) | Built 2026-11-20; story name, `stylesheet` tag, tags and story fields since 2026-11-21 |
| Story check tested against the real SugarCube | Done once (2026-11-21, scratch scripts); to become a permanent test |
| Engine (Node.js + jsdom + SugarCube) | Proof of concept only (scratch scripts, 2026-11-19) |
| `TestCharacters` loaded into the editor's Test | Planned |
| Printed values shown as plain text (runtime change) | Planned |
| Editor placeholders for skill checks, fights and side-story results | Planned |

## What SugarCube 2.37.3 does that matters

Read from the bundled `public/story-formats/sugarcube-2.37.3/format.js` and verified by playing crafted stories in it (2026-11-21). SugarCube is built for stories that run in the reader's own browser, so it runs a lot of story text as JavaScript. Each line here is answered by the story check, the editor or the engine.

| SugarCube | Consequence | Our answer |
|---|---|---|
| Runs a link's text as an expression (`Wikifier.helpers.evalText`): `[[alert(1)\|Cave]]` runs | Code in any link or button text | Link and button texts are plain words (story rules) |
| Runs a link target that names no scene (`evalPassageId`) | `[[Go\|alert(1)]]` runs | Every target must be an existing scene |
| Runs setters (`[[Go\|Cave][$x to …]]`) and `<<link>>`/`<<button>>` bodies on click | Code on click | Only the listed forms, typed expressions |
| Runs every expression: after `to`, in `<<if>>`, `<<print>>`, `<<case>>`, macro arguments including backquotes | Code anywhere a value is expected | A typed expression grammar with no other words |
| Runs an image source that names no scene, like a target | `[img[alert(1)]]` runs | Only uploaded file names; the editor rewrites them to `https://…` bucket URLs, which then read as a label and a comment |
| Evaluates HTML attribute directives (`@attr`, `sc-eval:`), `data-setter`, `data-passage`; `<html>` passes raw HTML | Code in HTML | HTML tags with only `class` |
| Decodes the story's name and shows it in the sidebar as markup at every start (`UIBar` `setDisplayTitle`); also puts it inside a JavaScript string (`generateName("{{STORY_NAME}}")`) | `</title><script>…` in a name ran; a backslash or line break stops SugarCube from starting | The name is plain words, at most 100 characters |
| Renders the sidebar and special scenes at start even when nothing shows them (`codePassageNames`: `PassageReady`, `PassageDone`, `PassageHeader`, `PassageFooter`, `StoryAuthor`, `StoryBanner`, `StoryCaption`, `StoryDisplayTitle`, `StoryInterface`, `StoryMenu`, `StoryShare`, `StorySubtitle`, `StoryInit`) | Their code runs, in the engine too | All refused except `StoryInit`, which is checked like a scene with stricter rules |
| In a Twine 2 story sets aside only `init` and `widget` passages (`codeTagNames`); `script` and `stylesheet` passages are ordinary scenes | A `stylesheet` passage is a playable scene, links and all | The tags `init`, `widget`, `script` and `stylesheet` are refused |
| Splits a passage's tag attribute at spaces | One tag `x widget` becomes a widget passage | Tags are single words without spaces |
| Skips `Twine.private` and `annotation` passages; uses a `Twine.image` passage's text as an image source | Hidden scenes; images from anywhere | Media tags refused; skipped passages are still checked |
| Runs the Story JavaScript at start | Code with no limits | The Story JavaScript must be empty; the platform adds its own runtime |
| Needs Web Storage, reports fatal errors with `alert()`, waits until `$(window).width()` is above 0 | Won't start in a sandbox without storage, nor in jsdom | Memory storage and an in-page error box in the sealed frame; a viewport shim in the engine |
| A restored state renders its scene again, commands included | Changes would be counted twice, and a random number drawn while the scene is shown would be drawn again | The engine counts only what follows the restore (see "Counting each change once"); see "Random numbers in a story" |

## The story check

The main protection, in the main app: `_check_twine_syntax` in `backend/auth_routes.py` with `backend/story_rules.py`, the rules in `docs/STORY-RULES.md`. It runs on submit, on a reviewer's Save review, on Approve, and when a review copy is opened (see "Review copies").

- **Only the reviewed list:** a story may only use the forms in the story rules, written as shown there. Everything else is refused: unlisted SugarCube commands, any JavaScript (Story JavaScript, `<<script>>`, `<<run>>`, `<script>`, `on…` attributes), the engine's internals (`State`, `Engine`, `Config`, `setup`, `window`, `document`), typed input, destinations built from variables, and anything that loads from outside the story.
- **No nesting inside tags:** a command's `<< >>` and an HTML tag's `< >` never contain another command or HTML tag. The one exception is a `[[link]]` inside `<<button>>`, `<<link>>` and `<<area>>`. `[[ ]]` links draw the lines between scenes in the editor, so authors should use them for every way out of a scene. Commands go between an opening and a closing tag instead:
  ```
  <<button [[Take the sword|Cave]]>><<set $hasSword to true>><</button>>
  <<area 0.10 0.20 0.30 0.40 [[Gate]]>>
  <<for _i, _c range $char>><<if _c.equipment.includes("rope_1")>><<set _hasRope to true>><</if>><</for>>
  ```
- **Checked without running:** the checker reads every scene and every branch. Code can be put together from pieces of text across several scenes, or hidden in a branch only some players or dates reach, so playing a story during review can't find it. The checker accepts only what it can read as one of the listed forms.
- **Unique choice texts:** the player's click or pick comes back as its text, so every text a player can pick appears once in a scene: link and button texts, the `<label>` text each radio button and checkbox sits in, and the options of drop-downs and cycles, also across lists and in different branches of an `<<if>>` or `<<switch>>` (a text always names one choice). Choices don't go inside `<<for>>`.
- **The whole story, not only scenes:** the story's name, its tags, its story data (each field of the kind the editor sends, checked first) and the special scenes and tags from the table above.
- **Tested against SugarCube itself (2026-11-21):** 126 crafted stories, each put through the story check and then played in the bundled SugarCube under jsdom, with every link, button, hotspot and choice clicked. That found two gaps, the `stylesheet` tag and the story name, both closed the same day. Afterwards all 64 stories whose code really runs in SugarCube were refused, and none of the accepted ones ran code. This should become a permanent test, so every rule change is checked against the real SugarCube.
- **Printed values stay text (planned):** the runtime will show every printed variable (`<<print>>` and a plain `$name`) as plain text, so a name or a stored text can never become a command. Stock SugarCube doesn't do this. Character names are already restricted to plain Latin letters (`backend/character_names.py`).

## The editor

### Built-in story formats only

A story format's code runs on the app's address with the viewer's login (its editor extensions and `hydrate`). The editor therefore has only Paperthin (Proof) and SugarCube 2.37.3 (`platformStoryFormat` in `src/store/story-formats/defaults.ts`); the Add story format button is gone and formats added earlier are dropped when the editor loads. A story only names its format: the story check accepts exactly SugarCube 2.37.3, and review copies always use the built-in one.

### Publishing a story

`src/util/publish.ts` turns a story into SugarCube's page: every scene, name and tag escaped, image file names rewritten to bucket URLs (`src/util/twine-images.ts`), and the Wudlands runtime added (`src/util/wudlands-runtime.ts`: the `<<area>>` hotspot command, the sidebar stowed, the stylesheet layers around the author's stylesheet). The engine builds its pages with the same code.

### Sealed frame for every story run

The editor's buttons that run a story are **Test** (from the start scene), **Run here** (Twine's "test from here", from the selected scene), **Play** (without debug) and **Proof** (Paperthin, a printable text view). All four go through `replaceDom` (`src/util/replace-dom.ts`), which replaces the tab's page with one frame:

- `sandbox="allow-scripts"`, without `allow-same-origin`: the story runs with an empty origin of its own. No login cookie, no API as the viewer, no access to the editor's page or its stored stories, and it can't move the tab elsewhere.
- **No dialogs:** without `allow-modals`, story code can't put `alert`, `confirm` or `prompt` boxes over the app's address. SugarCube's own error alerts appear as a box inside the page (`DIALOG_SHIM`).
- **Nothing goes out:** a Content-Security-Policy is the first thing in the frame's head (`SEALED_FRAME_CSP`): no fetch, XHR, beacon or WebSocket, no forms, no fonts or styles from an address, images only from the story image bucket. Inline scripts and eval stay, because SugarCube is one and evaluates the story's expressions.
- **In-memory storage:** the frame has no browser storage and SugarCube won't start without it, so a small script gives it stores in memory; the story's own saves last as long as the tab.
- **The same for everyone:** authors and reviewers, the author's own story, an imported one, a review copy. Nobody has to judge whether a story is safe to run.
- **Tested in Chromium (2026-11-21)** with a SugarCube story whose own JavaScript tried every way out: nothing reached an outside server and no dialog appeared; with the previous settings five requests arrived and all three dialogs showed. A frame can still load another page into itself; CSP has no rule for that.

### Review copies

A reviewer opens a submission from the review page (`/twine/#/review/{owner}/{storyId}`, loaded through `GET /api/auth/twine-reviews/{owner}/{storyId}/story`, reviewers only). The editor keeps it as a local review copy (`src/util/review-copies.ts`, `src/routes/review-load/`):

- a new story id and new scene ids, so an author reviewing their own story keeps their working copy; the name gets "Review:" in front
- the built-in SugarCube, whatever the submission names, and the author's frozen `review`-stage images
- never synced to the cloud and never submitted; the review bar offers **Save review** instead of Submit
- the stored test party comes back as a `TestCharacters` scene, so Save review stores it again
- **today's check:** the answer carries `checkProblems`. A submission was stored as it was submitted, possibly before a rule existed, so its code may be anything. While there are problems, Test, Run here, Play and Publish to File refuse the copy (`refuseUncheckedReviewCopy` in `src/store/use-publishing.ts`), and the review bar lists them, until a Save review passes the check on the server. A copy without a check result (opened before this existed) counts as unchecked. Proof still works.

### Cloud sync

The editor keeps stories in the browser's localStorage, which is limited (about 5 MB, cleared with browser data, evicted by Safari after 7 days without use, not shared between devices). The database copy is the safety net and gives access from other devices.

- **Collection:** `twine_stories`, one document per story, keyed by `(address, storyId)`, with `name`, `ifid`, `storyData` (format, start passage, stylesheet, script, tags, tag colours, zoom) and `passages` (`id`, `name`, `text`, `tags`, position and size).
- **Endpoints**, all requiring wallet login:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/auth/me/twine-stories` | List the author's stories |
| `GET` | `/api/auth/me/twine-stories/{storyId}` | One story with its scenes |
| `PUT` | `/api/auth/me/twine-stories/{storyId}` | Create or update (upsert) |
| `DELETE` | `/api/auth/me/twine-stories/{storyId}` | Delete |

- **Sync:** edits save to localStorage at once and to the database 10 seconds after the last change (`DEBOUNCE_MS` in `src/store/persistence/cloud-sync/cloud-sync-context.tsx`). On load, cloud and local copies are merged by `lastUpdate`. Review copies are skipped.
- **Key files:** `src/store/persistence/cloud-sync/` (`cloud-api.ts`, `cloud-sync-context.tsx`, `use-queue-story-sync.ts`, `cloud-sync-badge.tsx`).

### Special scenes and story data

- **Story data:** the editor stores the name, the IFID and the story data as fields of the story document. No `StoryData` or `StoryTitle` passage is parsed on the server.
- **Allowed special scenes:** `StoryInit` (story setup, no character data), `Retreat` and `LastResort` (required by the story check), and `TestCharacters` (the test party: up to 4 characters as JSON, checked like real ones by `backend/test_characters.py` and stored apart from the scenes on submit; it never reaches a real adventure).
- **Story Stylesheet:** allowed and checked (no `url(`, `@import`, `@font-face`, backslashes, `<`…). Styles go only there.
- **Story JavaScript:** must be empty.
- **Refused:** every other special scene from the table above, and the scene tags `init`, `widget`, `script`, `stylesheet`, `Twine.audio`, `Twine.video`, `Twine.vtt` and `Twine.image`.

## The engine (Node.js + jsdom)

Players never get the story's other scenes, its variables or the engine: the real SugarCube runs on the server, one click at a time, and the player receives only the finished scene. Which engine service runs which story, and what the control layer decides around each click, is in `ARCHITECTURE.md`.

### Why jsdom

A headless browser was dropped for its memory use; a Python reimplementation of the commands was dropped because authors test with SugarCube, so the server has to run SugarCube too. Measured on 2026-11-19 on a laptop, with the button test story (`myFirstStory`) and TW-tut-04:

| | SugarCube in jsdom | Headless Chromium |
|---|---|---|
| Memory with 1 story open | 88 MB | 336 MB |
| Each extra open story | about 4 MB | about 26 MB |
| CPU per click | about 0.19 s | not measured |

- **Same output as the browser:** two scenes from Twine-style browser play and from the engine's HTML plus the story CSS were pixel-identical, with the same clickable elements.
- **Every link form worked:** `[[links]]`, `<<area>>` hotspots, both `<<button>>` forms, `<<link>>`, a button that sets a variable, and radio buttons.
- **One shim needed:** jsdom has no layout, so SugarCube waits forever for a window width. The engine gives the page a fixed viewport size before SugarCube starts.
- **Memory creep:** over 300 clicks the engine's JavaScript memory stayed flat, but the process grew to about 250 MB, so shared workers are restarted every few hundred clicks.

### Building the page

From the pinned scenes, with the editor's own publish code (`src/util/publish.ts`, bundled for Node) and the same `format.js`, so the page is the one the author tested, plus the platform's runtime. Workers cache built pages per snapshot id. There are no `.twee` files on the server and no Twee parser.

### One click

- **Starting a story** (also a side story pushed onto the stack): build the page, let SugarCube run `StoryInit`, set `$char` and `$lead`, render the start scene and return it with the saved state and the start scene's Legend changes.
- **Each step:** restore SugarCube from the saved state, the way a browser reload does. The state is the scene and its variables as they were when the scene began, character data included, so the scene renders the same way again (for random numbers see below). Besides that scene only the startup code runs again (the runtime and `StoryInit`, whose values the saved state then replaces). Then apply the picks (radio buttons, checkboxes, drop-downs, cycles), click the chosen element (its commands and setters run, and SugarCube moves to the next scene, which gets the fresh character data), clean and number the new scene, and return it with the new state, `$isEnding` and each character's Legend changes.
- **Resuming a parked story** after a side story or fight is a normal step: the control layer writes the result variables into the parked state and sends the remembered click.
- **A skill check at a click** is reported to the control layer without moving on; it rolls, and the engine then enters the success or the failure scene.
- **Moving to `Retreat` or `LastResort`** is a move the control layer asks for; the browser can't.
- **One story per page, always:** side stories are separate frames on the control layer's stack, never scenes injected into another story's page or variables.
- **Same result on retry:** restoring the same state twice gave identical HTML in the test.

### Random numbers in a story

Stories may use `random(min, max)` and `either(a, b, ...)` (the story rules). Where they run decides whether repeating matters:

- **At a click,** between a link's or button's tags: the main use, sending the player to a random scene from a selection. This is for pure chance, such as which way the current carries the boat; skill checks such as a jump or a climb are rolled by the control layer instead (a check command, see `ARCHITECTURE.md` "Skill checks"). The number is drawn once while the click runs, the scene it leads to is saved, nothing is kept or repeated, and the player never sees a number, only where they end up.
- **While a scene is shown,** in the scene's own text, such as `<<set $guard to either("asleep", "awake")>>` followed by `<<switch $guard>>`: the engine shows that scene again when it handles the next click, because it restores the state from when the scene began. A fresh draw could then give "awake" where the player saw "asleep", with other text and other choices: the label the player clicked may be gone (the click is then refused and the scene shown as it is now), or another button may carry it.

**Decided 2026-11-21: accepted.** A number drawn in a scene's own text is drawn again whenever the engine shows the scene again. That fits The Wudlands: things change overnight, take what you have. For text that is harmless: the player only ever sees the scene as it was first shown, and the engine's second showing is only there to make the click. It must not decide which buttons or links the scene offers, or a click could be refused, or land on a same-labelled choice the player never saw. So randomness that chooses the way on belongs in the button (the main use), and reviewers look out for random choices in a scene's text. If this ever causes trouble, SugarCube's seeded random fixes it: the runtime calls `State.prng.init()` at start (SugarCube 2.37.3 allows it in the Story JavaScript, where the runtime sits), SugarCube then keeps the seed and how many numbers were drawn in the state it saves anyway, and the scene shown again draws the same numbers. Nothing extra would be stored, and the seed stays with the server and the engine.

The control layer's own rolls (side stories, skill checks, fights) are separate: drawn fresh by the server, never repeated (`ARCHITECTURE.md`).

### Characters inside SugarCube

- **`$char` and `$lead` are data,** set by the engine from what the control layer sends, fresh for every new scene. Stories read them and change only their Legend values; anything else written into them is lost at the next scene. They are never written into `StoryInit`, which would make player-typed names part of the story's code. Their values and how stories may use them are in the story rules ("Characters").
- **Still to align:** `adventures._character_var` sends `id`, `firstName`, `lastName`, `gender`, `race`, `raceGroup`, `birthsign`, `vitalStatus`, the maximum attributes (`attr`) and `classes`. The story rules need `name`, `might` and the other attributes as current values with injuries (`attrNow`), `prof1`–`prof3`, `equipment` and the 20 Legend values with the fade worked out (`legend.decayed`).
- **Equipment:** item ids with their tier, each listed with every lower tier too: a tier-3 candle also counts as `candle_1` and `candle_2`, so `.includes("candle_1")` means "a candle of tier 1 or better".
- **Legend changes** (`$lead.mercy += 2`, `$char[1].mercy`, `_c.mercy` in a `range $char` loop) are reported by character and name; Python applies them by its rules, so the result can differ from plain addition in the editor's Test.
- **Counting each change once:** a restored scene runs its commands again, and their changes were already counted. So the engine re-shows the current scene with the character data it was first shown with (then the choices the player saw match too) and counts only what follows: the clicked element's commands, then the new scene's own.

### Cleaning the output

The player sees the visible text and labels, nothing behind them: no scripts, no event attributes, no `data-passage` or other link targets, no setters, no check names or difficulties. Clickable elements keep their classes, so the story stylesheet still applies, and the player's click comes back as the choice's label (`ARCHITECTURE.md` "What the player receives"). Watch the platform's own runtime too: `<<area>>` hotspots get a `title` and an `aria-label` that name the destination scene when the link has no text of its own; the cleaning removes them, and the server gives hotspots a neutral handle. The control layer cleans the output again and doesn't trust the reported changes.

### What story code could do in the engine

In the 2026-11-19 tests a single `<<set>>` line reached the Node.js process outside jsdom. From there it ran a shell command, read a file, read all environment variables and sent a network request. It also replaced a function shared by every page in the process: on the next click in that process, for a different story and player, the scene came back with an extra link, and that player's scene and variables were sent to an outside server.

jsdom's script settings can't prevent this: with scripts off SugarCube never starts, with `runScripts: "outside-only"` a plain `<<set>>` in `StoryInit` still reached the server process, and SugarCube runs the story's commands as JavaScript inside the same page. So:

1. **The story check** keeps code out (see above), and review comes before any live play.
2. **The engine service has nothing to steal:** no secrets, a service account without permissions, no outbound network (enforced by the platform), reachable only from the backend (`ARCHITECTURE.md`).
3. **Node's permission model:** no child processes and no file access beyond its own files (in the test it blocked the shell command and the file read). It can't block the network, hence the platform rule.
4. **jsdom settings:** `runScripts: "dangerously"`, because SugarCube itself is a script; `resources` off, so the page fetches nothing.
5. **Limits:** a time limit per click (2 seconds stopped an endless loop in the test) and a memory limit.
6. **Worker modes:** unreviewed stories (`engine-test`) get a fresh process for every click. Reviewed stories (`engine-live`) share workers, restarted every few hundred clicks.

**Accepted risk of shared workers** (decided 2026-11-19, now only for reviewed stories on `engine-live`): a harmful story that gets past the story check and review could, until its worker restarts, change other stories' scenes in the same worker (for example add a fake "reconnect your wallet" message), read their text and players' variables, push their players into `LastResort`, and report false results (Legend changes still stay within each story's points). Separate workers per author would close this at about 90 to 250 MB per active author; revisit if story submission opens to everyone.

### Engine service layout (planned)

```
twine-engine/            Node.js service, deployed as engine-live and engine-test
├── server.js            internal HTTP API: start, choose, move to Retreat or LastResort
├── workers.js           shared workers (recycled every few hundred clicks) or single-use processes
├── page.js              builds the story page: the editor's publish code + format.js + runtime
├── run.js               one click: restore, picks, click, fresh $char/$lead, count Legend changes, clean
├── shims.js             fixed viewport size and other jsdom gaps
└── Dockerfile           Node only, no secrets, no outbound network
```

The main app's Dockerfile stays as it is.

## Open points

1. **Printed values as text:** the runtime change that makes `<<print>>` and a plain `$name` show values as plain text.
2. **Permanent test against SugarCube:** turn the 2026-11-21 scratch scripts into a test that plays every refused and accepted example in the real SugarCube.
3. **Quoted button forms (decided 2026-11-21: they stay):** `<<button "Go" "Cave">>` and `<<goto>>` inside buttons are how a button sends the player to a random scene, so they stay. The step graph (`backend/twine_graph.py`, today only `[[links]]` and image links) is to be built from the story check's own reading of each scene instead, so these exits count too, per label (`ARCHITECTURE.md` "Every click").
4. **`TestCharacters` in the editor's Test:** load the party into `$char` and `$lead`.
5. **Editor placeholders** for the control layer's commands and results (a skill check, a fight, a side story's outcome), for example **Pass** / **Fail** buttons, so both branches can be tested in the editor, and one button per test-party member for `<<pick_member>>` (`ARCHITECTURE.md` "Picking a party member").
6. **Character values:** align `$char` with the story rules (see "Characters inside SugarCube").
