# Headless Server-Authoritative Twine Game Deployment

Deploy Twine/SugarCube games via FastAPI where all game logic runs on the server. Players receive only rendered HTML and choice buttons — no access to source code, passage graph, variables, or the SugarCube engine.

## Goal

- Player cannot inspect game logic, future passages, or variable state
- Player cannot cheat via browser dev tools or localStorage manipulation
- All dice rolls, conditionals, and branching happen server-side
- Client is a thin renderer: receives HTML + choices, sends back a pick

## Architecture

```
Server (Docker container)
┌───────────────────────────────────────────────────┐
│  FastAPI                                          │
│  ┌──────────────┐   ┌──────────────────────────┐  │
│  │ Twee Parser   │   │ Headless Chromium         │  │
│  │ (Python)      │──>│ (Playwright)              │  │
│  │               │   │                           │  │
│  │ Parses .twee  │   │ Browser (1 process)       │  │
│  │ files, builds │   │ ├─ Context A (Player 1)   │  │
│  │ <tw-storydata>│   │ │  └─ Tab: SugarCube run  │  │
│  │ injects into  │   │ ├─ Context B (Player 2)   │  │
│  │ format.js     │   │ │  └─ Tab: SugarCube run  │  │
│  │ template      │   │ ├─ Context C (Player 3)   │  │
│  └──────────────┘   │ │  └─ Tab: SugarCube run  │  │
│                      └──────────┬───────────────┘  │
│                                 │                  │
│              scrape rendered HTML + choices         │
│                                 │                  │
└─────────────────────────────────┼──────────────────┘
                                  ▼
Client (browser)            { html, choices[] }
┌───────────────────────────────────────────────────┐
│  Thin frontend — renders HTML blob, shows choice  │
│  buttons, sends player pick back to API           │
└───────────────────────────────────────────────────┘
```

## Source Files

### Twee files (story data)

Plain-text format, trivial to parse. Each passage is `:: Name [tags]` followed by content:

```
:: Start {"position":"75,25","size":"100,100"}
<div class="title">The Deadly Dungeon</div>
<<link "Enter the dungeon...">>
  <<set $depth to 0>>
  <<rollgoto 0>>
<</link>>
```

Every Twee file contains a `:: StoryData` passage with metadata including the **IFID** — a UUID that uniquely identifies the story across the entire Twine ecosystem:

```
:: StoryData
{
  "ifid": "B9F4A3E1-7C2D-4B5F-8E1A-3D6F9C2B5A7E",
  "format": "SugarCube",
  "format-version": "2.37.3",
  "start": "Start",
  "zoom": 0.6
}
```

The IFID is the canonical game identifier throughout the system — used as the Firestore document ID, storage path key, and API parameter. No slugifying titles, no collisions.

Advantages over compiled HTML exports:
- Easy to parse, edit, version control
- Clean separation of data from engine
- No HTML entity unescaping needed
- Built-in unique identifier (IFID) per story

### SugarCube format.js (game engine)

Located at: `public/story-formats/sugarcube-2.37.3/format.js`

This file contains the full SugarCube engine as an HTML template with `{{STORY_NAME}}` and `{{STORY_DATA}}` placeholders. At startup, the server:

1. Parses Twee files into passage data
2. Builds `<tw-storydata>` + `<tw-passagedata>` XML elements
3. Injects them into the format.js template (replacing `{{STORY_DATA}}`)
4. Saves the compiled HTML to a temp file or serves it internally

This is exactly how Twine itself compiles games — no custom build step needed.

## SugarCube Macros Used

Macros found across the current game files:

| Macro | Purpose | Runs on server? |
|---|---|---|
| `<<set>>` | Variables (`$health`, `$depth`, arrays) | Yes, natively |
| `<<if>>`/`<<elseif>>`/`<<else>>` | Conditional text & branching | Yes, natively |
| `<<goto>>` | Navigate to passage | Yes, natively |
| `<<link>>` | Player choices (rendered as clickable links) | Yes, natively |
| `<<linkreplace>>` | Inline interactive replacement | Yes, natively |
| `<<widget>>` (`<<rollgoto>>`) | Custom macro (d100 + offset → computed goto) | Yes, natively |
| `<<include>>` | Embed one passage inside another | Yes, natively |
| `<<for>>` | Loops (e.g. generating planet arrays) | Yes, natively |
| `<<replace>>` | DOM manipulation (live HUD updates) | Yes, natively |
| `<<nobr>>`/`<<silently>>` | Whitespace/output control | Yes, natively |
| `<<timed>>`/`<<repeat>>` | Timed events | Yes, but needs polling/websocket |
| `random()` | RNG | Yes, server-side (not predictable by player) |

**Key insight**: Because the real SugarCube engine runs in the headless browser, zero macro reimplementation is needed. Every macro works natively.

## How Playwright Headless Works

Playwright runs a real Chromium browser without a visible window. Your Python code controls it programmatically.

### Per-turn flow

```python
from playwright.async_api import async_playwright

# 1. Start a hidden browser (once, at server startup)
browser = await playwright.chromium.launch(headless=True)

# 2. Player joins — load game in isolated context
context = await browser.new_context()
page = await context.new_page()
await page.goto("file:///path/to/compiled_game.html")

# 3. Scrape what SugarCube rendered
html = await page.inner_html("#passages")
# → "<div class='title'>Deadly Pit Trap</div><p>The adventurers cautiously...</p>"

# 4. Extract clickable choices
links = await page.query_selector_all("#passages .btn a")
choices = []
for link in links:
    label = await link.inner_text()
    choices.append(label)
# → ["Yes — tread carefully", "No — press forward"]

# 5. Player picks "Yes" via the API → click that link in the headless tab
await links[0].click()

# 6. SugarCube processes the click internally:
#    - evaluates <<goto "P1yes">>
#    - loads the P1yes passage
#    - runs any <<set>>, <<if>>, random() macros
#    - renders new HTML in the DOM

# 7. Scrape the new rendered state
await page.wait_for_selector("#passages")
html = await page.inner_html("#passages")
# → "<div class='title'>Pit Trap — Avoided!</div>..."
```

The SugarCube engine reacts to the click exactly like a human clicked it. Variables update, dice roll, passages navigate — all server-side.

## Player Session Isolation

Each Playwright **context** is a fully isolated browser environment — its own memory, cookies, localStorage, JavaScript globals. SugarCube stores all game state in its own JS runtime per tab.

```
Browser (1 process, shared)
├── Context A (Player 1)  →  $depth=3, $roll=47, at passage "P18"
│   └── Page (tab)
├── Context B (Player 2)  →  $depth=7, $roll=12, at passage "P101"
│   └── Page (tab)
├── Context C (Player 3)  →  $depth=1, $roll=88, at passage "P7"
│   └── Page (tab)
```

- Players cannot see or affect each other
- Each has independent variable state, passage history, RNG
- Identical to three people in separate browsers — except all on your server

## Session Management

```python
sessions: dict[str, dict] = {}

async def new_game(player_id: str, game_file: str):
    """Player joins — create isolated game session."""
    context = await browser.new_context()
    page = await context.new_page()
    await page.goto(game_file)
    sessions[player_id] = {
        "context": context,
        "page": page,
        "last_active": time.time(),
    }

async def player_choice(player_id: str, choice_index: int):
    """Player picks a choice — click it in their headless tab."""
    page = sessions[player_id]["page"]
    links = await page.query_selector_all("#passages .btn a")
    await links[choice_index].click()
    await page.wait_for_selector("#passages")
    sessions[player_id]["last_active"] = time.time()

    html = await page.inner_html("#passages")
    new_links = await page.query_selector_all("#passages .btn a")
    choices = [await l.inner_text() for l in new_links]
    return {"html": html, "choices": choices}

async def player_disconnect(player_id: str):
    """Player leaves or times out — free resources."""
    await sessions[player_id]["context"].close()
    del sessions[player_id]
```

## API Endpoints

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class ChoiceRequest(BaseModel):
    choice_index: int

@app.get("/api/games")
async def list_games():
    """List available games."""
    # Scan games directory for .twee files
    return [{"ifid": "B9F4A3E1-7C2D-4B5F-8E1A-3D6F9C2B5A7E", "game_id": "grimjaw/B9F4A3E1-7C2D.../the-deadly-dungeon", "title": "The Deadly Dungeon", "author": "Grimjaw"}, ...]

@app.post("/api/games/{game_id}/start")
async def start_game(game_id: str):
    """Start a new game session. Returns session_id + initial passage."""
    session_id = str(uuid4())
    await new_game(session_id, compiled_games[game_id])
    page = sessions[session_id]["page"]
    html = await page.inner_html("#passages")
    links = await page.query_selector_all("#passages .btn a")
    choices = [await l.inner_text() for l in links]
    return {"session_id": session_id, "html": html, "choices": choices}

@app.post("/api/sessions/{session_id}/choose")
async def make_choice(session_id: str, req: ChoiceRequest):
    """Player makes a choice. Returns next passage."""
    result = await player_choice(session_id, req.choice_index)
    return result
```

## What the Player Sees vs. Cannot See

**Sees:**
- Rendered passage HTML (story text, styled with CSS classes)
- Choice button labels ("Yes — tread carefully", "No — press forward")

**Cannot see:**
- Twee source files or passage graph
- `<<rollgoto>>` lookup table or any macro source
- Variable values (`$roll`, `$depth`, `$result`) unless displayed in passage text
- Future passages or branching structure
- The SugarCube engine or its `State` object
- Other players' game state

**Cannot cheat:**
- No localStorage access (SugarCube saves are server-side only)
- No browser console access to SugarCube's API
- No way to navigate to arbitrary passages
- No way to view or modify variables

## Content to Strip Before Sending

Before forwarding HTML to the player, optionally strip:
- `<div class="meta">` — contains debug info (roll values, depth, entry numbers)
- SugarCube sidebar UI — hide via SugarCube config or CSS
- Any `data-` attributes that leak passage IDs

## Memory Requirements

Headless Chromium base process: ~80-120 MB (shared across all tabs).
Each additional tab (player): ~20-30 MB for a Twine game (no images, no heavy frameworks).

| Container RAM | Concurrent players |
|---|---|
| 512 MB | ~10-15 |
| 1 GB | ~30-40 |
| 2 GB | ~60-80 |
| 4 GB | ~150+ |

### Scaling strategies

- **Timeout idle sessions** — close tabs for players inactive for N minutes
- **Cap concurrent tabs** — reject or queue new players at the limit
- **Horizontal scaling** — add more containers, not bigger ones
- A $5/month VPS (1 GB) handles ~30 concurrent players comfortably

## Project Structure

```
twine-server/
├── main.py                  # FastAPI app, session management, Playwright lifecycle
├── compiler.py              # Twee parser → compiled HTML via format.js template
├── games/
│   ├── deadly-dungeon.twee
│   └── space-exploration.twee
├── engine/
│   └── sugarcube-2.37.3/
│       └── format.js        # Copied from public/story-formats/
├── static/
│   ├── index.html           # Game selection page
│   └── player.html          # Thin game renderer (receives HTML + choices via API)
├── Dockerfile
├── docker-compose.yml
└── requirements.txt         # fastapi, uvicorn, playwright
```

## Docker Setup

```dockerfile
FROM python:3.12-slim

RUN pip install fastapi uvicorn playwright
RUN playwright install chromium --with-deps

COPY . /app
WORKDIR /app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```yaml
# docker-compose.yml
services:
  twine-server:
    build: .
    ports:
      - "8000:8000"
    mem_limit: 1g
    restart: unless-stopped
```

## Alternative: Python Macro Interpreter

If Playwright's memory overhead is too much, the current game files use a small enough macro subset to reimplement in Python (~300-500 lines):

- `<<set>>`, `<<if>>`/`<<elseif>>`/`<<else>>`, `<<goto>>`, `<<link>>`, `<<widget>>`, `<<include>>`, `<<for>>`, `<<nobr>>`/`<<silently>>`, `random()`

This would use <1 MB per session and scale to thousands of players on minimal hardware. The tradeoff: implementation effort up front, and any new SugarCube features in future games would need to be added to the interpreter.

The Playwright approach is recommended for getting started — zero macro reimplementation, full SugarCube compatibility, and the memory cost is acceptable for moderate player counts.

## Character Stats Injection from TheWudlands

Before a dungeon adventure starts, the server loads the player's character from the TheWudlands backend and injects their stats into the Twee game's `StoryInit` passage as SugarCube `<<set>>` macros. This happens before compilation — the player never sees the injection.

### Character data model (from `backend/character.py`)

Characters are stored in a `$char` array — each element is an object with string keys. This separates character data from game variables (`$depth`, `$roll`, etc.) and supports both solo (1 character) and party mode (any number of characters) with the same structure.

**Access patterns:**

```
$char[0]["might"]     → 5         (index + string key — works always)
$char[0]["name"]      → "Grimjaw Ironfoot"
$char[2]["agility"]   → 2
$lead["might"]        → 5         (shortcut to $char[0])
$char.length          → 4         (party size)
```

**For single-player adventure creators:** `$lead["might"]` is the simplest way to access the character. Since `$lead` is always `$char[0]`, story writers creating solo-only adventures never need to think about indexes — just use `$lead`:

```
<<if $lead["might"] gte 5>>Strong enough!<</if>>
$lead["name"] draws their sword.
```

Party-aware adventures use `$char[0]`, `$char[1]`, etc. or `<<for>>` loops. Both styles coexist — `$lead` is just a convenience alias for `$char[0]`.

**Character object keys:**

| Key | DB field | Example |
|---|---|---|
| `"name"` | `first_name` + `last_name` | `"Grimjaw Ironfoot"` |
| `"race"` | `race` | `"dwarf"` |
| `"gender"` | `gender` | `"m"` |
| `"vitalStatus"` | `vital_status` | `"alive"` |
| `"birthsign"` | `birthsign` | `"wolf"` |
| `"might"` | `attr.migh` | `5` |
| `"agility"` | `attr.agil` | `3` |
| `"endurance"` | `attr.endu` | `7` |
| `"precision"` | `attr.prec` | `2` |
| `"will"` | `attr.will` | `4` |
| `"insight"` | `attr.insi` | `3` |
| `"lore"` | `attr.lore` | `1` |
| `"presence"` | `attr.pres` | `2` |
| `"class1"` | `classes.class_1` | `"warrior"` |
| `"classLvl1"` | `classes.level_1` | `4` |
| `"class2"` | `classes.class_2` | `"none"` |
| `"classLvl2"` | `classes.level_2` | `0` |
| `"prof1"` | `profession.prof_1` | `"blacksmith"` |
| `"profLvl1"` | `profession.level_1` | `3` |
| `"prof2"` | `profession.prof_2` | `"none"` |
| `"profLvl2"` | `profession.level_2` | `0` |
| `"prof3"` | `profession.prof_3` | `"none"` |
| `"profLvl3"` | `profession.level_3` | `0` |

**Global variables (not per-character):**

| Var | Description |
|---|---|
| `$party_mode` | `true` if party, `false` if solo |
| `$lead` | Shortcut to `$char[0]` |
| `$inAdventure` | Adventure state flag |
| `$adventureFinished` | Count of completed adventures |
| `$adventureRunAway` | Count of run-aways |

### Resulting StoryInit (after injection)

The original Deadly Dungeon `StoryInit`:

```
:: StoryInit
<<set $depth to 0>>
<<set $roll to 0>>
<<set $offset to 0>>
<<set $result to 0>>
```

Becomes (solo — one character):

```
:: StoryInit
<<set $party_mode to false>>
<<set $char to [
  {
    "name": "Grimjaw Ironfoot", "race": "dwarf", "gender": "m",
    "vitalStatus": "alive", "birthsign": "wolf",
    "might": 5, "agility": 3, "endurance": 7, "precision": 2,
    "will": 4, "insight": 3, "lore": 1, "presence": 2,
    "class1": "warrior", "classLvl1": 4, "class2": "none", "classLvl2": 0,
    "prof1": "blacksmith", "profLvl1": 3, "prof2": "none", "profLvl2": 0,
    "prof3": "none", "profLvl3": 0
  }
]>>
<<set $lead to $char[0]>>
<<set $inAdventure to true>>
<<set $adventureFinished to 2>>
<<set $adventureRunAway to 0>>

/* --- Original StoryInit follows --- */
<<set $depth to 0>>
<<set $roll to 0>>
<<set $offset to 0>>
<<set $result to 0>>
```

Becomes (party — 4 characters):

```
:: StoryInit
<<set $party_mode to true>>
<<set $char to [
  {
    "name": "Grimjaw Ironfoot", "race": "dwarf",
    "might": 5, "agility": 3, "endurance": 7, "precision": 2,
    "will": 4, "insight": 3, "lore": 1, "presence": 2,
    "class1": "warrior", "classLvl1": 4, ...
  },
  {
    "name": "Elara Moonwhisper", "race": "elf",
    "might": 2, "agility": 6, "endurance": 3, "precision": 5,
    "will": 5, "insight": 7, "lore": 4, "presence": 3,
    "class1": "ranger", "classLvl1": 3, ...
  },
  {
    "name": "Thorgrim Stoneshield", "race": "dwarf",
    "might": 7, "agility": 2, "endurance": 8, "precision": 1,
    ...
  },
  {
    "name": "Lyssa Shadowveil", "race": "human",
    "might": 3, "agility": 5, "endurance": 4, "precision": 6,
    ...
  }
]>>
<<set $lead to $char[0]>>
<<set $inAdventure to true>>

/* --- Original StoryInit follows --- */
<<set $depth to 0>>
<<set $roll to 0>>
<<set $offset to 0>>
<<set $result to 0>>
```

### Server-side injection function

```python
import json

def inject_characters_into_storyinit(twee_source: str, characters: list[dict]) -> str:
    """
    Inject 1+ characters as $char array into StoryInit.
    Same structure for solo and party — $char is always an array,
    $lead always points to $char[0].
    """
    party_items = []
    for char in characters:
        attr = char["attr"]
        classes = char["classes"]
        prof = char["profession"]
        party_items.append({
            "name": f'{char["firstName"]} {char["lastName"]}',
            "race": char["race"],
            "gender": char["gender"],
            "vitalStatus": char["vitalStatus"],
            "birthsign": char["birthsign"],
            "might": attr["migh"],
            "agility": attr["agil"],
            "endurance": attr["endu"],
            "precision": attr["prec"],
            "will": attr["will"],
            "insight": attr["insi"],
            "lore": attr["lore"],
            "presence": attr["pres"],
            "class1": classes["class1"],
            "classLvl1": classes["lvl1"],
            "class2": classes["class2"],
            "classLvl2": classes["lvl2"],
            "prof1": prof["prof1"],
            "profLvl1": prof["lvl1"],
            "prof2": prof["prof2"],
            "profLvl2": prof["lvl2"],
            "prof3": prof["prof3"],
            "profLvl3": prof["lvl3"],
        })

    is_party = len(characters) > 1
    stats = characters[0].get("stats", {})

    lines = [
        f'<<set $party_mode to {"true" if is_party else "false"}>>',
        f'<<set $char to {json.dumps(party_items)}>>',
        f'<<set $lead to $char[0]>>',
        f'<<set $inAdventure to true>>',
        f'<<set $adventureFinished to {stats.get("adventureFinished", 0)}>>',
        f'<<set $adventureRunAway to {stats.get("adventureRunAway", 0)}>>',
    ]

    inject_block = "\n".join(lines)
    return twee_source.replace(
        ":: StoryInit",
        ":: StoryInit\n" + inject_block + "\n"
    )
```

### Data flow

```
TheWudlands DB                     Twine Server
┌─────────────┐                    ┌──────────────────────────────┐
│  characters  │  GET /characters  │                              │
│  [           │ ──────────────>   │  1. Load .twee source        │
│   { attr,    │                   │  2. inject_characters_into_  │
│     classes, │                   │     storyinit()              │
│     prof },  │                   │  3. → $char array + $lead    │
│   { ... },   │                   │  4. Compile with format.js   │
│   ...        │                   │  5. Load in headless tab     │
│  ]  (1+)     │                   │  6. SugarCube runs StoryInit │
│              │                   │     $char[0]["might"] = 5    │
└─────────────┘                    └──────────────────────────────┘
```

### Using character stats in passages

The `$char` array and `$lead` shortcut work the same way for solo and party — story writers use the same syntax:

**Solo / lead character** — use `$lead` shortcut:

```
:: P102
<div class="title">Exit Blocked by a Boulder</div>

<<if $lead["might"] + $lead["endurance"] gte 12>>
  With a mighty heave, $lead["name"] shoves the boulder aside!
  <div class="exit">You emerge from the dungeon!</div>
  <div class="btn"><<link "Play again?">><<goto "Start">><</link>></div>
<<else>>
  The boulder won't budge. $lead["name"]'s strength isn't enough.
  <div class="btn"><<link "Search for another exit...">><<rollgoto 107>><</link>></div>
<</if>>
```

**Party — combined strength using loop:**

```
:: P102 [cave]
<div class="title">Exit Blocked by a Boulder</div>

<<set _total_might to 0>>
<<for _i, _c range $char>>
  <<set _total_might to _total_might + _c["might"]>>
<</for>>

<<if _total_might gte 15>>
  The party pushes together! The boulder rolls aside!
<<else>>
  Even together, the party can't budge it.
<</if>>
```

**Individual party member checks by index:**

```
:: Narrow Ledge [cave]
A narrow ledge stretches across a chasm.

<<for _i, _c range $char>>
  <<if _c["agility"] gte 5>>
    _c["name"] leaps across!
  <<else>>
    _c["name"] stumbles but makes it.
  <</if>>
<</for>>
```

**Specific character by index:**

```
<<if $char[0]["might"] gte 5>>The leader is strong enough.<</if>>
<<if $char[2]["lore"] gte 4>>The third character reads the runes.<</if>>
```

Story writers use `$lead` for solo-focused passages and `<<for ... range $char>>` for party-wide checks. The same code works whether `$char` has 1 or 4 elements.

## Native UI Elements via SugarCube Special Passages

Extra screens (character sheet, equipment, rest, storage) are defined as regular passages in the Twee file and surfaced via SugarCube's built-in special passages and dialog system. No separate frontend code or API endpoints needed — everything flows through the same headless scrape pipeline.

### Special passages

SugarCube has two passages that are automatically included on every page:

- **`:: PassageHeader`** — rendered before every passage
- **`:: PassageFooter`** — rendered after every passage

Define them once, they appear everywhere. No need to edit individual adventure passages.

### SugarCube Dialog system

`Dialog.wiki()` opens a **modal overlay** without navigating away from the current passage. When closed, the player is right where they were — no back-button logic needed.

```
Dialog.setup("Title")        → set the dialog title
Dialog.wiki('<<include>>')   → fill with wiki-parsed content
Dialog.open()                → show it
Dialog.close()               → dismiss it
Dialog.isOpen()              → check state (used by scraper)
```

### Toolbar — React buttons that switch to existing app tabs

The TheWudlands app already has polished, DB-connected screens for character stats, equipment, storage, and resting. The game should not duplicate these — the toolbar buttons simply switch the player to the existing app tabs.

No SugarCube `Dialog` passages, no `UI_Equipment` / `UI_Storage` / `UI_CharacterSheet` / `UI_Rest` passages needed. The Twee files stay clean — story content only.

#### Where the toolbar lives

The toolbar is a **React component** in the Stories tab, rendered above the game output — not inside the Twee file:

```tsx
// Inside StoriesTab.tsx, when activeSession is running
<div className={styles.adventureView}>
  {/* React toolbar — switches to existing app tabs */}
  <div className={styles.adventureToolbar}>
    <button onClick={() => setActiveTab("stats")}>Character</button>
    <button onClick={() => setActiveTab("body")}>Equipment</button>
    <button onClick={() => { setActiveTab("home"); onRestingChange(true); }}>Camp</button>
  </div>

  {/* Scraped SugarCube output — story content only */}
  <div
    className={styles.adventurePassage}
    dangerouslySetInnerHTML={{ __html: activeSession.html }}
  />

  {/* Choice buttons */}
  <div className={styles.adventureChoices}>
    {activeSession.choices.map((label, i) => (
      <button key={i} onClick={() => makeChoice(i)}>{label}</button>
    ))}
  </div>

  {/* Adventure controls */}
  <div className={styles.adventureControls}>
    <button onClick={() => endAdventure("stop")}>Stop Adventure</button>
    <button onClick={() => endAdventure("run_away")}>Run Away</button>
  </div>
</div>
```

#### What each button does

| Button | Action | Screen shown |
|---|---|---|
| **Character** | `setActiveTab("stats")` | Existing Stats tab — attributes, class, profession |
| **Equipment** | `setActiveTab("body")` | Existing Body tab — equip slots, backpack, soul |
| **Camp** | `setActiveTab("home")` + toggle rest | Existing Camp tab — rest location, item storage |

The player uses the same screens they already know. When they switch back to the Stories tab, the game is exactly where they left it (headless session stays alive), and any gear changes are synced via the dirty flag mechanism (see "Gear sync between tabs" section).

#### What stays in the Twee file

The Twee file contains **only story content** — no UI screens:

```
:: PassageHeader
(empty or minimal — e.g. a compact HUD showing health/depth)

:: PassageFooter
(empty)
```

If a lightweight in-game HUD is wanted (without leaving the story), PassageHeader can show a one-liner:

```
:: PassageHeader
<div class="hud">$charName | HP: $health | Depth: $depth</div>
```

But equipment management, character sheet, storage, and resting all happen on the existing React tabs.

#### Why this is better than SugarCube Dialog screens

| Concern | SugarCube Dialog approach | Reuse existing tabs |
|---|---|---|
| Equipment UI | Rebuilt from scratch in Twee macros | Already built, polished, DB-connected |
| Item management | Simple arrays (`$backpack`) | Full item system (quality, durability, slots, categories) |
| Storage | Basic `<<for>>` loops | Camp with full item transfer rules |
| Resting | Simple `<<set>>` heal | Existing rest system with location, timer, rules |
| Styling | Separate CSS in StoryStylesheet | Matches app design system |
| Maintenance | Two places to update | One source of truth |
| Duplicate state | Gear in SugarCube vars AND DB | DB is the only source, synced into SugarCube |

## Embedding in TheWudlands App — Stories Tab Integration

The TheWudlands Next.js app has a character preview overlay with tabs: **Stats**, **Body & Soul**, **Camp**, and **Stories**. The Stories tab (`StoriesTab.tsx`) currently has "Start Adventure" / "Stop Adventure" / "Run Away" buttons and a placeholder noting *"Adventures will be listed here once addon selection is wired up."*

This is the natural integration point. When the player starts an adventure, the Stories tab content is replaced entirely with the SugarCube game output from the headless server.

### Current app structure

```
CharacterPreview (full-viewport overlay)
├── Tab bar: [Stats] [Body] [Camp]    ├── Character name heading
└── Tab content area
    └── StoriesTab
        ├── "Start Adventure" / "Stop Adventure" / "Run Away" buttons
        ├── Rest toggle + location selector
        └── Placeholder: "Adventures will be listed here..."
```

### Target integration

```
CharacterPreview (full-viewport overlay)
├── Tab bar: [Stats] [Body] [Camp]    ├── Character name heading
└── Tab content area
    └── StoriesTab
        ├── BEFORE ADVENTURE: Adventure selector (list of .twee games)
        │   └── "Enter The Deadly Dungeon" / "Enter Space Exploration" / ...
        │
        └── DURING ADVENTURE: SugarCube game replaces entire tab content
            ├── React toolbar: [Character] [Equipment] [Camp]  (switch to existing tabs)
            ├── Rendered passage HTML + choices
            └── "Stop Adventure" / "Run Away" footer (React)
```

### How it works

**Phase 1 — Adventure selection** (React, in StoriesTab):

```tsx
// StoriesTab.tsx — before an adventure is active
const [availableGames, setAvailableGames] = useState([]);
const [activeSession, setActiveSession] = useState(null);

// Fetch available games from the Twine headless server
useEffect(() => {
  fetch("/api/adventure/games").then(r => r.json()).then(setAvailableGames);
}, []);

// Render game list
if (!activeSession) return (
  <div>
    <h4>Available Adventures</h4>
    {availableGames.map(game => (
      <button key={game.id} onClick={() => startGame(game.id)}>
        Enter {game.name}
      </button>
    ))}
  </div>
);
```

**Phase 2 — Start game** (calls headless server, injects character stats):

```tsx
async function startGame(gameId: string) {
  // 1. Set character to in-adventure in TheWudlands DB
  await fetch(`/api/auth/me/characters/${character.id}/in-adventure`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inAdventure: true }),
  });

  // 2. Start headless session — server loads character stats,
  //    injects into StoryInit, compiles with format.js, opens tab
  const res = await fetch("/api/adventure/start", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, characterId: character.id }),
  });
  const session = await res.json();
  // session = { sessionId, html, choices: [...] }

  setActiveSession(session);
}
```

**Phase 3 — Game running** (React renders scraped HTML):

```tsx
// StoriesTab.tsx — adventure is active, replace entire tab content
if (activeSession) return (
  <div className="adventure-container">
    {/* Rendered SugarCube output — passage text + toolbar */}
    <div
      className="adventure-passage"
      dangerouslySetInnerHTML={{ __html: activeSession.html }}
    />

    {/* Choice buttons */}
    <div className="adventure-choices">
      {activeSession.choices.map((label, i) => (
        <button key={i} onClick={() => makeChoice(i)}>
          {label}
        </button>
      ))}
    </div>

    {/* React-level controls (not in Twee) */}
    <div className="adventure-controls">
      <button onClick={() => endAdventure("stop")}>Stop Adventure</button>
      <button onClick={() => endAdventure("run_away")}>Run Away</button>
    </div>
  </div>
);

async function makeChoice(choiceIndex: number) {
  const res = await fetch(`/api/adventure/sessions/${activeSession.sessionId}/choose`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choiceIndex }),
  });
  const newState = await res.json();
  setActiveSession(prev => ({ ...prev, ...newState }));
}
```

**Phase 4 — End adventure** (sync state back to TheWudlands DB):

```tsx
async function endAdventure(reason: "stop" | "run_away") {
  // 1. Read final game state from headless session
  const finalState = await fetch(
    `/api/adventure/sessions/${activeSession.sessionId}/state`
  ).then(r => r.json());

  // 2. Close the headless tab
  await fetch(`/api/adventure/sessions/${activeSession.sessionId}`, {
    method: "DELETE",
  });

  // 3. Set character back to not-in-adventure, sync any loot/stats
  await fetch(`/api/auth/me/characters/${character.id}/in-adventure`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inAdventure: false,
      reason,
      adventureResults: finalState,
    }),
  });

  setActiveSession(null);
  onPlayerDataUpdated?.(); // refresh character data
}
```

### API routing — proxy through TheWudlands backend

The TheWudlands Next.js app doesn't talk to the Twine headless server directly from the browser. Instead, TheWudlands' own FastAPI backend proxies the requests, handling auth and character validation:

```
Browser (Next.js)              TheWudlands Backend           Twine Headless Server
┌──────────────┐               ┌──────────────────┐          ┌──────────────────┐
│ StoriesTab   │  /api/adv/*   │ FastAPI           │  HTTP    │ FastAPI           │
│              │ ────────────> │                   │ ───────> │ + Playwright      │
│ renders HTML │               │ • Auth check      │          │ • Compiles Twee   │
│ + choices    │ <──────────── │ • Char validation  │ <─────── │ • Runs SugarCube  │
│              │  {html,       │ • Injects stats    │  {html,  │ • Scrapes output  │
│              │   choices}    │ • Syncs DB on end   │  choices}│                   │
└──────────────┘               └──────────────────┘          └──────────────────┘
```

```python
# TheWudlands backend — adventure proxy routes
@router.post("/api/adventure/start")
async def start_adventure(req: StartRequest, player = Depends(get_current_player)):
    character = get_character(player, req.character_id)

    # Validate: not crafting, not already in adventure
    if character.crafting.active_craft:
        raise HTTPException(400, "Still crafting")
    if character.in_adventure:
        raise HTTPException(400, "Already in adventure")

    # Set in-adventure flag
    set_in_adventure(player, character, True)

    # Forward to Twine headless server with character data
    char_data = character.to_dict()
    response = await httpx.post(
        f"{TWINE_SERVER}/sessions/start",
        json={"game_id": req.game_id, "character": char_data},
    )
    return response.json()


@router.delete("/api/adventure/sessions/{session_id}")
async def end_adventure(session_id: str, player = Depends(get_current_player)):
    # Read final state before closing
    state_res = await httpx.get(f"{TWINE_SERVER}/sessions/{session_id}/state")
    final_state = state_res.json()

    # Close headless tab
    await httpx.delete(f"{TWINE_SERVER}/sessions/{session_id}")

    # Sync results back: loot found, stats changed, adventure count
    sync_adventure_results(player, session_id, final_state)

    return {"status": "ended", "results": final_state}
```

### State sync on adventure end

When the adventure ends, the server reads SugarCube's final variable state and maps it back to TheWudlands DB:

```python
async def read_final_state(page) -> dict:
    """Read all game-relevant variables from the headless session."""
    return await page.evaluate('''() => ({
        // Character stats (may have been buffed/debuffed during adventure)
        might: State.variables.might,
        agility: State.variables.agility,
        endurance: State.variables.endurance,
        precision: State.variables.precision,
        will: State.variables.will,
        insight: State.variables.insight,
        lore: State.variables.lore,
        presence: State.variables.presence,

        // Inventory changes
        backpack: State.variables.backpack,
        mainHand: State.variables.mainHand,
        offHand: State.variables.offHand,
        armor: State.variables.armor,

        // Adventure progress
        depth: State.variables.depth,
        currentPassage: State.passage,
    })''')


def sync_adventure_results(player, session_id, final_state):
    """Write adventure outcomes back to TheWudlands DB."""
    character = get_character_for_session(session_id)

    # Update gear from what the character ended with
    character.gear["items"] = rebuild_gear_items(final_state)

    # Increment adventure counters
    character.adventure_finished += 1

    # Set back to not-in-adventure
    character.in_adventure = False

    save_character(player, character)
```

### What the player experiences

1. Opens character → clicks **Stories** tab
2. Sees list of available adventures → clicks "Enter The Deadly Dungeon"
3. The Stories tab content smoothly replaces with the dungeon game
4. Toolbar buttons (Character Sheet, Equipment, Rest) are native SugarCube, rendered as part of each passage via PassageHeader
5. Story choices appear as buttons below the passage text
6. "Stop Adventure" / "Run Away" buttons remain at the bottom (React-level, always visible)
7. On adventure end, the tab returns to the adventure selector, character stats/inventory are synced back

### Tab interactions during adventure

The other CharacterPreview tabs still work during an adventure, with the same restrictions already in place:

| Tab | During adventure | Notes |
|---|---|---|
| Stats | Available (read-only) | Shows live stats from React state |
| Body & Soul | Available | Equipment view from TheWudlands DB |
| Camp | Available (when resting) | Camp storage, rest location |
| Stories | **Shows active game** | SugarCube output replaces tab content |

Switching tabs away from Stories and back does not interrupt the headless session — it keeps running on the server. The Stories tab just re-fetches the current scrape when re-opened.

### Gear sync between tabs — dirty flag via onPlayerDataUpdated

When the player switches to the Body tab, changes weapons, and returns to the Stories tab, the game needs to reflect the new gear. The approach uses a dirty flag — no extra DB calls needed.

**Key insight**: The Twine headless server never touches the database. All data flows through React state, which is already updated by the existing equip/unequip API calls.

#### Data flow

```
Body Tab                    CharacterPreview           Twine Headless Server
                            (React state)              (Playwright)

Player unequips sword
  → PATCH /api/.../equip
  → DB updated ✓
  → onPlayerDataUpdated()
      → setGearDirty(true)
      → character prop
        updated with fresh
        data from API

Player clicks Stories tab
      → gearDirty? yes
      → syncCharacterToGame()
        sends character      ──→  page.evaluate(updates)
        from React state          → State.variables updated
        (already fresh)           → Engine.show()
                             ←──  scraped HTML + choices
      → setGearDirty(false)
```

The DB was already written by the equip/unequip API call on the Body tab. `onPlayerDataUpdated` returns fresh character data — `CharacterPreview` has it in React state. When syncing to the headless session, it forwards what React already knows. No DB query needed.

#### Implementation in CharacterPreview.tsx

```tsx
// Add dirty flag to existing state
const [gearDirty, setGearDirty] = useState(false);

// Extend existing handlePlayerDataUpdated callback
const handlePlayerDataUpdated = useCallback((data: RawPlayerData) => {
  setVaultData(null);
  setHomeData(null);
  setCampData(null);
  if (activeSession) {
    setGearDirty(true);  // ← mark that something changed during adventure
  }
  onPlayerDataUpdated?.(data);
}, [onPlayerDataUpdated, activeSession]);

// Sync when switching back to Stories tab
useEffect(() => {
  if (activeTab === "stories" && activeSession && gearDirty) {
    syncCharacterToGame();
    setGearDirty(false);
  }
}, [activeTab]);
```

#### Sync function — forwards React state, no DB read

```tsx
async function syncCharacterToGame() {
  // character prop is already up-to-date from onPlayerDataUpdated
  const effective = {
    might: character.attr.migh,
    agility: character.attr.agil,
    endurance: character.attr.endu,
    precision: character.attr.prec,
    will: character.attr.will,
    insight: character.attr.insi,
    lore: character.attr.lore,
    presence: character.attr.pres,
    mainHand: getEquippedName(character, "Main Hand"),
    offHand: getEquippedName(character, "Off Hand"),
    armor: getEquippedName(character, "Chest"),
    // ... map other equipped slots
  };

  const res = await fetch(`/api/adventure/sessions/${activeSession.sessionId}/sync`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stats: effective }),
  });
  const updated = await res.json();
  setActiveSession(prev => ({ ...prev, ...updated }));
}
```

#### Server-side sync endpoint — pushes into SugarCube via page.evaluate

```python
@router.post("/sessions/{session_id}/sync")
async def sync_character(session_id: str, req: SyncRequest):
    """Push updated character stats into the running SugarCube session.
    No DB access — data comes from the request body."""
    page = sessions[session_id]["page"]

    await page.evaluate(
        '(s) => { for (const [k,v] of Object.entries(s)) State.variables[k] = v; }',
        req.stats
    )
    await page.evaluate('Engine.show()')

    return await scrape_state(page)
```

#### Where each piece of data lives at each step

| Step | Data source | DB call? |
|---|---|---|
| Player equips sword on Body tab | Body tab → PATCH API → DB | Yes (already happens today) |
| API returns updated character | Backend → React state | No (response from the PATCH) |
| `onPlayerDataUpdated` fires | React callback | No |
| `gearDirty` set to `true` | React state | No |
| Player switches to Stories tab | React detects tab change | No |
| `syncCharacterToGame()` called | Reads from React state (character prop) | No |
| Twine headless receives stats | JSON payload from sync request | No |
| `page.evaluate()` pushes into SugarCube | Playwright → headless Chromium tab | No |
| `Engine.show()` re-renders passage | SugarCube re-evaluates `<<if>>` checks with new stats | No |
| Scraped HTML returned to frontend | Playwright scrape → API response | No |

**The only DB call in the entire flow is the original equip/unequip on the Body tab — which already happens today.** Everything else is in-memory: React state → JSON payload → Playwright evaluate.

## Images and Audio — External Storage and Delivery

### SugarCube media capabilities

SugarCube has built-in support for images and a full audio engine:

**Images** — standard HTML in any passage:
```
<img src="https://assets.wudlands.com/adventures/deadly-dungeon/dragon.webp">
[img[https://assets.wudlands.com/adventures/deadly-dungeon/dragon.webp]]
```

**Audio macros**:
| Macro | Purpose |
|---|---|
| `<<cacheaudio "id" "url">>` | Preload an audio file |
| `<<audio "id" play/stop/fade...>>` | Control a track |
| `<<masteraudio volume/mute/stop>>` | Global audio controls |
| `<<createplaylist "id">>` | Build playlists |
| `<<playlist "id" play/stop>>` | Control playlist playback |
| `<<waitforaudio>>` | Wait until audio is loaded |

### Storage architecture — Twee on server, media on CDN

Twee files are tiny (~3-50KB each). Images and audio scale fast. At 1000+ games with ~50MB of media each, that's 50GB+ — too much for the app server.

**Solution**: Twee files stay on the game server, media lives in external object storage behind a CDN.

```
Game Server (tiny)                    CDN / Object Storage (scalable)
┌────────────────────┐                ┌──────────────────────────────┐
│ games/             │                │ adventures/                  │
│   deadly-dungeon   │                │   deadly-dungeon/            │
│     .twee (15KB)   │                │     images/                  │
│   space-explore    │                │       golden-dragon.webp     │
│     .twee (3KB)    │                │       skeleton-army.webp     │
│   ... 1000 games   │                │     audio/                   │
│       (~47MB total)│                │       dungeon-ambient.mp3    │
└────────────────────┘                │   space-exploration/         │
                                      │     images/...               │
                                      │     audio/...                │
                                      │   ... 1000 games             │
                                      │       (~50GB total)          │
                                      └──────────────────────────────┘
```

Twee passages reference full URLs. When the headless browser renders a passage, the scraped `<img src="https://cdn...">` passes through unchanged. The player's browser loads images **directly from the CDN** — the game server never handles media bytes:

```
Player ──→ Game Server ──→ Headless Browser
  │              │              │
  │    scraped HTML with        │
  │  ← CDN image URLs  ←───────┘
  │
  │  <img src="https://cdn.wudlands.com/...">
  │
  └──→ CDN ──→ image served directly to player
```

### Storage provider options

| Provider | Storage cost | Bandwidth | Notes |
|---|---|---|---|
| **Cloudflare R2** | $0.015/GB/mo | **Free egress** | Best overall — no bandwidth fees |
| **Backblaze B2** | $0.006/GB/mo | $0.01/GB | Cheapest raw storage |
| **AWS S3** | $0.023/GB/mo | $0.09/GB | Industry standard |
| **DigitalOcean Spaces** | $5/mo for 250GB | 1TB included | Simple flat pricing |
| **MinIO** | Self-hosted | Free | Run on your own server |
| **IPFS + Pinata** | $0.15/GB/mo | Free via gateways | Decentralized, fits Web3 theme |
| **Arweave** | ~$5/GB one-time | $0 forever | Permanent storage, pay once |

**Cost estimate for 1000 games (~50GB)**:

| Solution | Monthly cost |
|---|---|
| R2 + Cloudflare CDN | ~$0.75 storage, $0 bandwidth |
| B2 + BunnyCDN | ~$0.30 + ~$1-5 bandwidth |
| IPFS (Pinata) | ~$7.50 |
| Arweave | ~$250 one-time, then $0 forever |
| S3 + CloudFront | ~$1.15 + bandwidth |

### Cloud asset security — signed URLs

By default, object storage URLs are either public (anyone can access) or private (nobody can access). **Signed URLs** give controlled, time-limited access — the server generates a URL that works for a few minutes, then expires.

#### How signed URLs work

```
Public URL:    https://assets.wudlands.com/adventures/dragon.webp
               → anyone can access, anytime, forever

Signed URL:    https://assets.wudlands.com/adventures/dragon.webp
                 ?X-Amz-Expires=300
                 &X-Amz-Signature=a7f3b2c1d9e8...
                 &X-Amz-Date=20261026T120000Z
               → works for 5 minutes, then 403s
```

The signature is generated server-side using your secret key. The storage provider validates it. No secret is exposed to the player — they get a working URL that self-destructs.

#### Server-side: generate signed URLs when scraping

```python
import boto3

s3 = boto3.client('s3',
    endpoint_url='https://your-r2-endpoint.r2.cloudflarestorage.com',
    aws_access_key_id='...',
    aws_secret_access_key='...',
)

def sign_url(key: str, expires_in: int = 300) -> str:
    """Generate a presigned URL that expires in 5 minutes."""
    return s3.generate_presigned_url(
        'get_object',
        Params={'Bucket': 'game-assets', 'Key': key},
        ExpiresIn=expires_in,
    )

async def scrape_with_signed_urls(page, game_id):
    """Scrape passage HTML and replace asset URLs with signed versions."""
    html = await page.inner_html("#passages")

    # Rewrite image URLs
    def sign_match(match):
        path = match.group(1)
        signed = sign_url(path)
        return f'src="{signed}"'

    html = re.sub(
        r'src="https://assets\.wudlands\.com/([^"]+)"',
        sign_match,
        html,
    )
    return html
```

#### What this protects against

| Threat | Signed URLs? |
|---|---|
| Browsing the storage bucket to see all game images | **Blocked** — bucket is private |
| Sharing a direct link to spoil others | **Blocked** — link expires in 5 min |
| Bots scraping the entire asset library | **Blocked** — no valid signature |
| Player saving the image they're currently viewing | Not preventable (true for any website) |

#### Security levels

**Level 1 — Public bucket, hashed filenames** (minimal effort):
```
https://assets.wudlands.com/adventures/deadly-dungeon/a7f3b2c1.webp
```
Filenames are non-guessable hashes. No directory listing. Player would need to know the hash to access an image. Practical security for most cases.

**Level 2 — Private bucket, signed URLs** (recommended):
```
https://assets.wudlands.com/adventures/deadly-dungeon/dragon.webp
  ?X-Amz-Signature=...&X-Amz-Expires=300
```
Bucket is fully private. Server generates time-limited URLs per passage scrape. Links expire after 5 minutes. Best balance of security and simplicity.

**Level 3 — Private bucket, signed URLs + session cookie validation** (maximum):
```
Cloudflare Worker validates:
  1. Signed URL is valid and not expired
  2. Request includes a valid session cookie
  3. Session has visited a passage containing this image
```
Requires a Cloudflare Worker or edge function in front of R2. Only serves assets for passages the player has actually reached. Maximum lockdown.

#### Supported by all major providers

| Provider | Signed URL support |
|---|---|
| AWS S3 | Yes — `generate_presigned_url()` |
| Cloudflare R2 | Yes — S3-compatible API |
| Backblaze B2 | Yes — S3-compatible API |
| DigitalOcean Spaces | Yes — S3-compatible API |
| Google Cloud Storage | Yes — `generate_signed_url()` |
| MinIO | Yes — S3-compatible API |

### Audio in the headless architecture

Audio needs special handling — it plays inside the headless Chromium tab where nobody hears it. The audio must be forwarded to the player's browser as events.

**Approach**: Inject an audio interceptor into the headless session that captures play/stop/fade commands instead of actually playing audio:

```python
# Inject audio event capture before loading the game
await page.evaluate('''() => {
    window._audioEvents = [];
    const origPlay = SimpleAudio.tracks.get;
    // Hook into SugarCube's audio system to capture events
    const handler = {
        get(target, prop) {
            const track = Reflect.get(target, prop);
            if (typeof track?.play === 'function') {
                const origPlay = track.play.bind(track);
                track.play = (...args) => {
                    window._audioEvents.push({
                        action: 'play', track: prop, time: Date.now()
                    });
                    return origPlay(...args);
                };
            }
            return track;
        }
    };
}''')
```

Scrape audio events alongside HTML:

```python
async def scrape_state(page):
    html = await page.inner_html("#passages")
    links = await page.query_selector_all("#passages a")
    choices = [await l.inner_text() for l in links]

    audio_events = await page.evaluate('''() => {
        const events = window._audioEvents || [];
        window._audioEvents = [];
        return events;
    }''')

    return {
        "html": html,
        "choices": choices,
        "audio": audio_events,
        # e.g. [{"action": "play", "track": "sfx_dragon"}, 
        #       {"action": "stop", "track": "bgm_dungeon"}]
    }
```

The frontend plays audio locally based on the events:

```tsx
useEffect(() => {
  if (!activeSession?.audio) return;
  for (const event of activeSession.audio) {
    const url = `https://assets.wudlands.com/adventures/${gameId}/audio/${event.track}.mp3`;
    if (event.action === 'play') {
      audioManager.play(event.track, url);
    } else if (event.action === 'stop') {
      audioManager.stop(event.track);
    }
  }
}, [activeSession]);
```

Audio file URLs use the same signed URL approach as images — time-limited, secure.

### GCP Solution — Firebase Storage (Cloud Storage for Firebase)

If the project already uses **Firestore** for the database, Firebase Storage is the natural choice for media — same Firebase project, same console, same billing, same service account credentials.

**What it is**: A regular Google Cloud Storage (GCS) bucket with a Firebase SDK wrapper. Same infrastructure, same data centers — just friendlier security rules and client SDKs on top.

| Feature | Details |
|---|---|
| Max file size | 5 TB per object |
| Storage cost | $0.026/GB/month (US multi-region) |
| Egress | $0.12/GB |
| Free tier | 5 GB storage, 1 GB/day downloads, 50K downloads/day |
| Security | Firebase Security Rules OR signed URLs |
| CDN | Can put Cloud CDN in front |
| Access | Firebase SDK, GCS SDK, or REST API — all work on same bucket |

**Architecture split** — each tool for its strength:

```
Firestore  →  game metadata, player sessions, character data (already exists)
Firebase Storage (GCS)  →  images, audio files (same Firebase project)
```

**Note**: Firestore is a document database (1 MB max doc size) — not suitable for storing images directly. Firebase Storage is the proper file/object store within the same ecosystem.

#### Firebase Security Rules (alternative to signed URLs)

```javascript
// storage.rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /games/{gameId}/{allPaths=**} {
      allow read: if request.auth != null;  // any logged-in player
    }
  }
}
```

Players authenticate via Firebase Auth → can read images directly. Simpler than signed URLs but less granular (any authenticated user sees all game images).

#### Firebase Storage signed URLs (GCS-compatible)

```python
from google.cloud import storage
from datetime import timedelta

def generate_gcs_signed_url(bucket_name: str, blob_name: str, expiration_minutes: int = 15):
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    return blob.generate_signed_url(
        version="v4",
        expiration=timedelta(minutes=expiration_minutes),
        method="GET",
    )
```

### Cost at Scale — Provider Comparison

#### Upload constraints per game

| Constraint | Limit |
|---|---|
| Max zip upload | 15 MB |
| Max single image | 400 KB |
| Max images per game | 30 |
| Max media per game | 30 × 400KB = **12 MB** |
| Min resolution | 600 × 340 px (16:9 landscape) |
| Max resolution | 1000 × 1250 px (4:5 portrait) |
| Allowed formats | JPG, WebP, GIF |
| Naming | Must match scene id (e.g. `ruined-gate.jpg`) |

#### Storage costs (10,000 games × 12 MB each = 120 GB)

| Provider | Storage/mo | Notes |
|---|---|---|
| Firebase free tier | $0 | Covers up to 5 GB |
| Firebase Storage | $3.12 | Same as GCS pricing |
| R2 | $1.80 | |
| B2 + Cloudflare | $0.72 | Cheapest raw storage |

Storage is cheap everywhere — **egress dominates cost**.

#### Egress costs by player volume (120 GB stored, ~15 images × 400KB per session)

| Daily sessions | Monthly egress | Firebase Storage | R2 | GCS + Cloud CDN |
|---|---|---|---|---|
| 100 players/day | ~18 GB | $2.16 | **$0** | ~$1-2 |
| 1,000 players/day | ~180 GB | $21.60 | **$0** | ~$12-15 |
| 5,000 players/day | ~900 GB | $108 | **$0** | ~$55-70 |
| 50,000 players/day | ~9 TB | $1,080 | **$1.80** | ~$550-700 |

#### The key takeaway

At 50,000 daily sessions, Firebase egress alone ($1,080/mo) pays for **50 years** of R2 ($1.80/mo).

#### Recommendation

| Stage | Provider | Why |
|---|---|---|
| **Start** | Firebase Storage | Same project as Firestore, zero setup, free tier covers early growth |
| **Scale (1000+/day)** | Cloudflare R2 | Free egress, S3-compatible, easy migration |

Switching providers is a **backend-only change** — the server generates image URLs, so moving from Firebase Storage to R2 means changing one function. No Twee file changes, no frontend changes, players notice nothing.

#### Dual-storage approach — Firebase as master, R2 for serving

Storage is cheap (120 GB × 2 copies = ~$5/mo total). Keep both:

```
Firebase Storage  →  master copy (uploads land here, admin access, backup)
R2                →  serving copy (players download from here, free egress)
```

| Concern | Answer |
|---|---|
| Storage cost of keeping both? | ~$5/mo for 120 GB × 2 — negligible |
| Why keep Firebase copy? | Easy admin access, same console as Firestore, backup |
| Why serve from R2? | Free egress, no surprise bills at scale |
| Sync how? | On upload: save to Firebase first, then copy to R2 |

```python
async def upload_game_images(game_id, zip_file):
    for image in unzip(zip_file):
        # 1. Master copy → Firebase (admin access, backup)
        firebase_bucket.blob(f"games/{game_id}/{image.name}").upload(image.data)
        
        # 2. Serving copy → R2 (players download from here)
        r2.put_object(Bucket='game-assets', Key=f"games/{game_id}/{image.name}", Body=image.data)
    
    # Server generates signed URLs pointing to R2, not Firebase
```

**Flow:**
- Story writer uploads → images land in **Firebase** (and get copied to R2)
- Admin browses images → sees them in **Firebase console**
- Players play games → images served from **R2** (free egress)

### Story Writer Upload Pipeline

Story writers upload a Twee file and an image zip through an admin interface. The server validates, unpacks, and stores everything in Firebase.

```
Story Writer uploads:
  ├── dungeon-adventure.twee     (text, ~15KB, contains :: StoryData with IFID)
  └── dungeon-images.zip         (images, ~3MB)
          ├── goblin.png
          ├── treasure-room.jpg
          └── dark-corridor.webp

Server:
  1. Parse .twee → extract IFID from :: StoryData, validate passages
  2. Unzip images → validate (types, sizes, count)
  3. Store:
       Firestore doc key:  IFID (e.g. "B9F4A3E1-7C2D-4B5F-8E1A-3D6F9C2B5A7E")
         ├── game_id: "grimjaw/B9F4A3E1-.../the-deadly-dungeon"
         ├── title, author, passage count
         └── twee_source (raw text)
       Firebase Storage:  /games/{author}/{ifid}/{title_slug}/images/
         ├── goblin.png
         ├── treasure-room.jpg
         └── dark-corridor.webp
```

#### Parsing the IFID from StoryData

```python
import json, re

def parse_story_data(twee_text: str) -> dict:
    """Extract :: StoryData JSON from a Twee file. Returns the parsed dict."""
    match = re.search(
        r'^:: StoryData\s*\n(.*?)(?=\n::|\Z)',
        twee_text, re.MULTILINE | re.DOTALL
    )
    if not match:
        raise ValueError("Twee file missing :: StoryData passage")
    
    data = json.loads(match.group(1).strip())
    if "ifid" not in data:
        raise ValueError("StoryData missing IFID")
    
    return data
    # Returns: {
    #   "ifid": "B9F4A3E1-7C2D-4B5F-8E1A-3D6F9C2B5A7E",
    #   "format": "SugarCube",
    #   "format-version": "2.37.3",
    #   "start": "Start",
    #   "zoom": 0.6
    # }
```

The IFID is a **UUID v4, uppercased** — globally unique, stable across import/export, and standard across the Twine ecosystem. It serves as the primary key for games throughout the system.

#### Upload endpoint

```python
from fastapi import UploadFile, File, HTTPException, Depends
from zipfile import ZipFile
from google.cloud import storage, firestore
import io, os

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.webp', '.gif'}
MAX_IMAGE_SIZE = 400 * 1024             # 400 KB per image
MAX_ZIP_SIZE = 15 * 1024 * 1024         # 15 MB per zip
MAX_IMAGES_PER_GAME = 30

db = firestore.Client()
bucket = storage.Client().bucket("your-firebase-bucket")

@app.post("/api/games/upload")
async def upload_game(
    twee_file: UploadFile = File(...),
    image_zip: UploadFile = File(None),
    author: str = Depends(get_current_user)
):
    # 1. Read and parse Twee — extract IFID and title from StoryData
    twee_content = await twee_file.read()
    twee_text = twee_content.decode("utf-8")
    story_data = parse_story_data(twee_text)  # extracts :: StoryData JSON
    passages = parse_twee(twee_text)

    ifid = story_data["ifid"]                 # e.g. "B9F4A3E1-7C2D-4B5F-8E1A-3D6F9C2B5A7E"
    title = passages["title"]                 # e.g. "The Deadly Dungeon"
    author_slug = slugify(author)             # e.g. "grimjaw"
    title_slug = slugify(title)               # e.g. "the-deadly-dungeon"
    game_id = f"{author_slug}/{ifid}/{title_slug}"
    # e.g. "grimjaw/B9F4A3E1-7C2D-4B5F-8E1A-3D6F9C2B5A7E/the-deadly-dungeon"

    # 2. Store Twee in Firestore — IFID is the primary key
    db.collection("games").document(ifid).set({
        "ifid": ifid,
        "game_id": game_id,
        "title": title,
        "format": story_data.get("format", "SugarCube"),
        "format_version": story_data.get("format-version", "2.37.3"),
        "author": author,
        "author_slug": author_slug,
        "passage_count": len(passages["passages"]),
        "twee_source": twee_text,
        "created_at": firestore.SERVER_TIMESTAMP,
        "status": "processing"
    })

    # 3. Unzip and store images
    image_count = 0
    if image_zip:
        zip_bytes = await image_zip.read()
        if len(zip_bytes) > MAX_ZIP_SIZE:
            raise HTTPException(413, "Zip exceeds 15MB limit")

        with ZipFile(io.BytesIO(zip_bytes)) as zf:
            for entry in zf.namelist():
                ext = os.path.splitext(entry)[1].lower()
                if ext not in ALLOWED_EXTENSIONS:
                    continue
                
                data = zf.read(entry)
                if len(data) > MAX_IMAGE_SIZE:
                    continue
                
                if image_count >= MAX_IMAGES_PER_GAME:
                    break

                filename = os.path.basename(entry)
                blob = bucket.blob(f"games/{game_id}/images/{filename}")
                blob.upload_from_string(data, content_type=guess_mime(ext))
                image_count += 1

    # 4. Mark as ready
    db.collection("games").document(ifid).update({
        "status": "ready",
        "image_count": image_count
    })
    
    return {"game_id": game_id, "ifid": ifid, "title": title, "passages": len(passages["passages"]), "images": image_count}
```

#### Security checklist for uploads

| Check | Why |
|---|---|
| Validate file extensions | No `.exe`, `.js`, `.html` in zip |
| Check magic bytes | Ensure PNG is actually a PNG |
| Limit per-file size (400KB) | Prevent oversized uploads |
| Limit zip size (15MB) | Prevent zip bombs |
| Limit image count (30) | Match game constraints |
| Sanitize filenames | No path traversal (`../../etc/passwd`) |
| Rate limit uploads | Prevent spam |
| Auth required | Only registered story writers can upload |

#### Optional: admin review queue

Games can start as `status: "pending_review"` — an admin approves before they appear in the player game list. Prevents inappropriate content from going live immediately.

## Random Side Stories — On-the-Fly Injection

Short story snippets that appear as extra choice buttons during a main adventure. They are fully decoupled from the main story — the main story writer has nothing to configure, nothing to know about. Side stories connect at runtime through **passage tags**.

### How it works

```
Main story (written by story writer):       Side story pool (written separately):
  :: Swamp Crossing [swamp]                   { tag: "swamp", "The Glowing Moss" }
  :: Dark Forest Path [forest]                { tag: "swamp", "Bog Witch" }
  :: Cave Entrance [cave underground]         { tag: "forest", "Lost Traveler" }
  :: Mountain Pass [mountain]                 { tag: "cave", "Echoing Voices" }
                                              { tag: "forest", "Wounded Deer" }
                                              { tag: "underground", "Ancient Shrine" }

At runtime:
  Player enters "Swamp Crossing" [tagged: swamp]
    → Server scrapes main story choices: "Wade through", "Turn back"
    → Server queries side story pool: 2 stories match tag "swamp"
    → Random roll (30% chance): triggered
    → Random pick: "Bog Witch" selected
    → Player sees: "Wade through", "Turn back", "A crooked hut in the fog..."
```

The main story writer never mentions side stories. The side story writer never sees the main story. Tags are the only connection.

### Architecture

```
Main Story Twee          Side Story Pool           Server (runtime)
┌──────────────┐         ┌──────────────────┐      ┌─────────────────────┐
│ :: Passage    │         │ Firestore:       │      │                     │
│ [swamp]      │         │  side_stories/   │      │ 1. Scrape passage   │
│              │         │   swamp-glow-001 │      │ 2. Read passage tags│
│ Story text   │         │   bog-witch-001  │      │ 3. Query matching   │
│ and choices  │         │   lost-trav-001  │      │    side stories     │
│              │         │   ...            │      │ 4. Roll chance      │
│ (no side     │         │                  │      │ 5. Inject button    │
│  story refs) │         │ Each has:        │      │ 6. Send to player   │
└──────────────┘         │  - tag           │      └─────────────────────┘
                         │  - chance %      │
                         │  - passages[]    │
                         │  - hook_text     │
                         │  - rewards       │
                         └──────────────────┘
```

### Side story data model (Firestore)

```python
# Collection: side_stories
{
    "id": "bog-witch-001",
    "tag": "swamp",                          # matches passage tags
    "hook_text": "A crooked hut in the fog...",  # button label shown to player
    "chance": 30,                            # 30% chance to appear
    "min_level": 2,                          # optional: only for level 2+
    "max_plays": 1,                          # optional: player sees this only once
    "author": "side_writer_42",
    "status": "approved",
    "passages": [
        {
            "title": "SS_bog-witch_Start",
            "text": "Smoke curls from a chimney...\n<<link \"Knock on the door\">><<goto \"SS_bog-witch_P2\">><</link>>\n<<link \"Walk away\">><<goto \"SS_bog-witch_End\">><</link>>",
            "tags": []
        },
        {
            "title": "SS_bog-witch_P2",
            "text": "The door creaks open. An old woman peers at you...",
            "tags": []
        },
        {
            "title": "SS_bog-witch_End",
            "text": "You return to the path.",
            "tags": ["side-end"]
        }
    ],
    "rewards": {                             # optional: given on completion
        "items": ["potion_of_swamp_sight"],
        "xp": 15
    }
}
```

### Server-side: scrape with side story injection

```python
import random

async def scrape_with_side_stories(page, session):
    """Scrape passage HTML and inject a random side story button if triggered."""
    html = await page.inner_html("#passages")
    choices = await get_choices(page)

    # Block nested side stories — no random events inside a random event
    if "active_side_story" in session:
        return {"html": html, "choices": choices}

    # 1. Get current passage tags from SugarCube
    tags = await page.evaluate(
        '() => Story.get(State.passage).tags || []'
    )

    if not tags:
        return {"html": html, "choices": choices}

    # 2. Query side stories matching any tag
    available = []
    for tag in tags:
        docs = db.collection("side_stories") \
            .where("tag", "==", tag) \
            .where("status", "==", "approved") \
            .get()
        available.extend(docs)

    # 3. Filter: respect min_level, max_plays, already-seen
    player_seen = session.get("seen_side_stories", set())
    player_level = session.get("player_level", 1)

    candidates = [
        s for s in available
        if s.id not in player_seen
        and player_level >= s.get("min_level", 0)
        and random.randint(1, 100) <= s.get("chance", 30)
    ]

    # 4. Pick one (or none)
    if candidates:
        side_story = random.choice(candidates)
        choices.append({
            "label": side_story.get("hook_text"),
            "type": "side_story",
            "story_id": side_story.id
        })

    return {"html": html, "choices": choices}
```

### Server-side: enter and exit side stories

```python
async def enter_side_story(session_id: str, story_id: str):
    """Player clicked a side story button — inject passages and navigate."""
    side = db.collection("side_stories").document(story_id).get().to_dict()
    session = sessions[session_id]
    page = session["page"]

    # Save return point
    session["return_passage"] = await page.evaluate('State.passage')
    session["active_side_story"] = story_id

    # Inject side story passages into the running SugarCube engine
    passages_json = json.dumps(side["passages"])
    await page.evaluate(f'''(passages) => {{
        for (const p of passages) {{
            if (!Story.has(p.title)) {{
                Story.add({{
                    title: p.title,
                    text: p.text,
                    tags: p.tags || []
                }});
            }}
        }}
        Engine.play(passages[0].title);
    }}''', side["passages"])

    # Track that player has seen this side story
    session.setdefault("seen_side_stories", set()).add(story_id)

    return await scrape_state(page)


async def exit_side_story(session_id: str):
    """Side story ended — return to main story and apply rewards."""
    session = sessions[session_id]
    page = session["page"]

    # Apply rewards if any
    story_id = session.pop("active_side_story")
    side = db.collection("side_stories").document(story_id).get().to_dict()
    if "rewards" in side:
        await apply_rewards(page, side["rewards"])

    # Return to main story
    return_to = session.pop("return_passage")
    await page.evaluate(f'Engine.play("{return_to}")')

    return await scrape_state(page)


async def apply_rewards(page, rewards: dict):
    """Push side story rewards into SugarCube variables."""
    if "items" in rewards:
        for item in rewards["items"]:
            await page.evaluate(
                f'State.variables.backpack.push("{item}")'
            )
    if "xp" in rewards:
        await page.evaluate(
            f'State.variables.xp = (State.variables.xp || 0) + {rewards["xp"]}'
        )
```

### Detecting side story end

The server checks for the `side-end` tag on the current passage after each player choice. If found, it triggers the exit automatically:

```python
async def player_choice(session_id: str, choice_index: int):
    """Handle player choice — detect side story end automatically."""
    page = sessions[session_id]["page"]

    # Click the choice in headless tab
    links = await page.query_selector_all("#passages a")
    await links[choice_index].click()
    await page.wait_for_selector("#passages")

    # Check if we landed on a side-end passage
    tags = await page.evaluate(
        '() => Story.get(State.passage).tags || []'
    )
    if "side-end" in tags and "active_side_story" in sessions[session_id]:
        return await exit_side_story(session_id)

    return await scrape_with_side_stories(page, sessions[session_id])
```

### What the player experiences

```
Playing "The Deadly Dungeon"...

  ┌─────────────────────────────────────┐
  │ The path descends into a murky      │
  │ swamp. Twisted trees rise from      │
  │ the dark water on all sides.        │
  │                                     │
  │  [Wade through the swamp]           │  ← main story
  │  [Turn back to higher ground]       │  ← main story
  │  [A crooked hut in the fog...]      │  ← side story (30% chance)
  └─────────────────────────────────────┘

Player clicks "A crooked hut..."
  → enters 2-5 passage mini adventure
  → gets reward (potion, xp, lore)
  → automatically returns to "Swamp Crossing"
  → continues main story as if nothing happened
```

### Tag system — matching rules

Side stories can use simple or compound tags:

| Side story tag | Matches passages tagged | Use case |
|---|---|---|
| `swamp` | `[swamp]`, `[swamp dark]` | Any swamp scene |
| `combat` | `[combat]`, `[combat boss]` | Any fight scene |
| `night` | `[night]`, `[forest night]` | Nighttime encounters |
| `underground` | `[underground]`, `[cave underground]` | Below-ground scenes |

A passage tagged `[swamp night]` could trigger side stories tagged `swamp` OR `night` — the server checks all tags.

### Content scaling

| Scale | Side stories | Storage | Notes |
|---|---|---|---|
| Launch | 20-50 snippets | Firestore only | Enough for variety |
| Growth | 200-500 snippets | Firestore only | Rich random encounters |
| Scale | 1000+ snippets | Firestore only | Side stories are tiny (text only, <5KB each) |

Side story text (Twee passages) is stored in Firestore. Side story images use the same CDN as main stories:

```
R2 / Firebase Storage:
  games/deadly-dungeon/images/         ← main story images
  side-stories/bog-witch-001/images/   ← side story images
  side-stories/swamp-glow-001/images/  ← side story images
```

Same upload pipeline (zip + validation), same signed URL rewriting when scraping. Side story passages reference images the same way as main stories:

```
:: SS_bog-witch_Start
<img src="side-stories/bog-witch-001/images/witch-hut.webp">
Smoke curls from a chimney made of bones...
```

### Side stories access all game state — no copy needed

Side story passages are injected into the **same running SugarCube engine**. All variables from StoryInit and everything modified during the main story are already live:

```
SugarCube State (one engine per player):
  $charName = "Grimjaw Ironfoot"    ← from StoryInit injection
  $might = 5                        ← from StoryInit injection
  $depth = 4                        ← modified during main story
  $backpack = ["rope", "torch"]     ← modified during main story

Side story runs HERE ↑ — same engine, same variables, no copying
```

Side story passages use variables directly:

```
:: SS_bog-witch_P2
<<if $might gte 5>>
  "Strong one, aren't you, $charName?" she cackles.
<<else>>
  "Too weak for my needs," she mutters.
<</if>>
```

Side stories can also **modify** state — changes persist when returning to the main story:

```
:: SS_bog-witch_Task
<<set $backpack.push("swamp_potion")>>
<<set $lore to $lore + 1>>
```

After returning, `$backpack` has the potion and `$lore` is +1. No sync needed.

### No nested side stories

When the player is inside a side story, the server skips random injection — no side story within a side story. This is enforced by the `active_side_story` check in `scrape_with_side_stories()`.

### Why this works

| Concern | Answer |
|---|---|
| Main story writer burden | **Zero** — tags passages normally, nothing else |
| Side story writer burden | **Minimal** — write a 2-5 passage snippet, assign a tag |
| Adding new side stories | Add to Firestore — instantly available in ALL matching games |
| Removing a side story | Set `status: "disabled"` — gone from all games immediately |
| Same side story, many games | Automatic — any game with a `[swamp]` passage can trigger it |
| Player sees same one twice | Prevented by `seen_side_stories` tracking per session |
| Difficulty scaling | `min_level` filter — harder side stories for higher-level characters |
| Balance | `chance` percentage tunable per side story |

## Story Persistence — Cloud Sync via Firestore

The Twine editor stores all stories in **`window.localStorage`** using individual JSON keys. This works for quick editing but has critical limitations:

- **5 MB cap** per origin (most browsers), ~10 MB on some
- **Safari evicts localStorage after 7 days** of inactivity (ITP policy)
- Stories are lost when the user clears browser data
- No cross-device access

### Current localStorage key structure

| Key pattern | Content |
|---|---|
| `twine-stories` | Comma-separated list of story UUIDs |
| `twine-stories-{id}` | JSON of one Story (metadata only, passages stripped) |
| `twine-passages` | Comma-separated list of passage UUIDs |
| `twine-passages-{id}` | JSON of one Passage (name, text, tags, position) |
| `twine-prefs` | Comma-separated list of pref UUIDs |
| `twine-prefs-{id}` | JSON `{id, name, value}` per preference |
| `twine-storyformats` | Comma-separated list of format UUIDs |
| `twine-storyformats-{id}` | JSON per StoryFormat |

Every change flows through a **save middleware** (`src/store/persistence/local-storage/stories/save-middleware.ts`) that writes to localStorage on each Redux-style action. The existing `StorageQuota` component (`src/components/storage-quota/storage-quota.tsx`) uses `navigator.storage.estimate()` to show remaining space.

### Realistic story sizes

| Story complexity | Passages | Estimated size |
|---|---|---|
| Small (tutorial/demo) | 10–30 | 10–50 KB |
| Medium (short adventure) | 50–150 | 100–500 KB |
| Large (full game) | 300–800 | 500 KB – 3 MB |
| Very large | 1000+ | 3–5 MB (hits localStorage limit) |

### Cloud storage design — Firestore collection

Store stories in the existing Firestore (MongoDB-compatible) database. A single MongoDB document supports up to 16 MB, so even large stories fit easily.

**Collection: `twine_stories`**

```json
{
  "address": "user-wallet-address",
  "storyId": "uuid",
  "ifid": "B9F4A3E1-...",
  "name": "Desert Crossing",
  "lastUpdate": "2026-10-28T14:30:00Z",
  "storyData": {
    "storyFormat": "SugarCube",
    "storyFormatVersion": "2.37.3",
    "startPassage": "passage-uuid",
    "stylesheet": "...",
    "script": "...",
    "tags": [],
    "tagColors": {},
    "snapToGrid": true,
    "zoom": 0.6
  },
  "passages": [
    {
      "id": "passage-uuid",
      "name": "Start",
      "text": "<<link 'Enter'>><<goto 'Room1'>><</link>>",
      "tags": ["start"],
      "left": 75, "top": 25,
      "width": 100, "height": 100
    }
  ],
  "sizeBytes": 487320
}
```

Keyed by `(address, storyId)` — same pattern as the `characters` collection. The `ifid` field is indexed for cross-reference with the headless game system.

### Sync strategy — localStorage as primary, DB as backup

localStorage remains the fast working store. The DB is a persistent safety net that enables cross-device access.

```
User opens Twine editor
  → Load from localStorage (existing behavior, instant)
  → Fetch from DB in background (GET /api/auth/twine-stories)
  → Merge:
      DB has stories not in localStorage → add to localStorage
      localStorage has newer lastUpdate  → push to DB
      DB has newer lastUpdate            → update localStorage
  → Show sync status on story cards

User edits a passage
  → Save to localStorage (existing, immediate)
  → Debounced save to DB (5 seconds after last edit)
  → Story card shows cloud icon: syncing → saved

User imports .twee/.html from disk
  → Import to localStorage (existing behavior)
  → Auto-save to DB (same debounce)

User deletes a story
  → Remove from localStorage (existing)
  → Remove from DB (DELETE /api/auth/twine-stories/{storyId})
```

### Backend API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/auth/twine-stories` | List all stories for the authenticated user |
| `GET` | `/api/auth/twine-stories/{storyId}` | Get one story with passages |
| `PUT` | `/api/auth/twine-stories/{storyId}` | Create or update a story (upsert) |
| `DELETE` | `/api/auth/twine-stories/{storyId}` | Delete a story |

All endpoints require wallet authentication (same as existing `/api/auth/*` routes). The PUT endpoint accepts the full story + passages JSON and performs an upsert.

### Twine editor integration points

1. **Save middleware extension** — in `src/store/persistence/local-storage/stories/save-middleware.ts`, after each localStorage write, queue a debounced sync call to the backend API.

2. **State loader extension** — in `src/store/state-loader.tsx`, after loading from localStorage, fetch from DB and merge by `lastUpdate` timestamp (newest wins).

3. **Sync status indicator** — add a small cloud icon to each story card on the stories canvas:
   - ☁️ synced (green) — DB matches localStorage
   - 🔄 syncing (amber) — debounce pending or request in flight
   - ⚠️ error (red) — sync failed, retry queued

4. **Delete handler** — extend the `deleteStory` action path to also remove from DB.

5. **Import handler** — after `importStories()` completes, trigger a DB sync for each imported story.

### Debounce and cost considerations

Firestore pricing is per document read/write, not per byte. Auto-saving on every keystroke would be expensive. The 5-second debounce groups rapid edits into a single write. Additional guard: skip the write if the serialized story hasn't changed since the last sync (compare a hash of the JSON payload).

### Conflict resolution

Simple strategy: **newest `lastUpdate` wins**. On merge:
- If both sides changed, the newer version replaces the older
- The editor always works on the localStorage copy, so the user never loses in-progress work
- Future enhancement: per-passage merge using passage IDs (not needed for v1)

### Key files

| Purpose | Path |
|---|---|
| Save middleware (hook point) | `src/store/persistence/local-storage/stories/save-middleware.ts` |
| State loader (load + merge point) | `src/store/state-loader.tsx` |
| Story types | `src/store/stories/stories.types.ts` |
| Storage quota UI | `src/components/storage-quota/storage-quota.tsx` |
| localStorage save/load | `src/store/persistence/local-storage/stories/save.ts` / `load.ts` |
| Import parser | `src/util/import.ts` |
| Twee import/export | `src/util/twee.ts` |

---

## SugarCube Special Passages and StoryData Reference

### :: StoryData fields (Twee 3 specification)

Every Twee file must contain a `:: StoryData` passage with a JSON body. Only `ifid` is required:

```
:: StoryData
{
  "ifid": "B9F4A3E1-7C2D-4B5F-8E1A-3D6F9C2B5A7E",
  "format": "SugarCube",
  "format-version": "2.37.3",
  "start": "Start",
  "tag-colors": { "combat": "red", "swamp": "green" },
  "zoom": 0.6
}
```

| Field | Required | Type | Description |
|---|---|---|---|
| `ifid` | **Yes** | string | UUID v4, uppercased. Unique story identifier (like ISBN for books) |
| `format` | No | string | Story format name (e.g. `"SugarCube"`, `"Harlowe"`) |
| `format-version` | No | string | Story format version (e.g. `"2.37.3"`) |
| `start` | No | string | Name of the starting passage |
| `tag-colors` | No | object | `{ "tag-name": "color" }` pairs for editor display |
| `zoom` | No | number | Editor zoom level |

If `start` is omitted, SugarCube falls back to the first non-special passage in the file.

### SugarCube 2 special passages — complete list

#### Story-level (run once or define global settings)

| Passage | Purpose | Used in headless? |
|---|---|---|
| `StoryData` | JSON metadata: IFID, format, start passage | **Yes** — parsed on upload for game ID and metadata |
| `StoryTitle` | Story name (plain text) | **Yes** — used for display in game list |
| `StoryDisplayTitle` | Formatted title shown in UI bar (v2.31+) | No — UI bar hidden |
| `StoryInit` | Runs once at startup — set variables, cache audio | **Yes** — character stats injection point |
| `StoryInterface` | Replace default UI with custom HTML (must have `#passages`) | No — UI bar hidden |
| `StoryStylesheet` | CSS styling for the story | Yes — runs in headless tab, affects scraped HTML |

#### Sidebar passages (UI bar — all hidden in headless architecture)

| Passage | Purpose | Used in headless? |
|---|---|---|
| `StoryBanner` | Image/text above the title in sidebar | No |
| `StorySubtitle` | Text below the title in sidebar | No |
| `StoryAuthor` | Author info in sidebar | No |
| `StoryCaption` | Dynamic info (HP, gold, progress) in sidebar | No |
| `StoryMenu` | Custom menu items in sidebar | No |
| `StoryShare` | Social links below Restart button | No |

These are irrelevant — the SugarCube sidebar is hidden because the frontend is React with its own toolbar. Character stats, equipment, and menus are handled by existing TheWudlands app tabs.

#### Per-passage processing (run on every passage change)

| Passage | When it runs | Output visible? | Used in headless? |
|---|---|---|---|
| `PassageReady` | Before passage renders | No (code only) | Yes — pre-render logic, variable setup |
| `PassageHeader` | Prepended to every passage | **Yes** | **Yes** — compact HUD (HP, depth, etc.) |
| `PassageFooter` | Appended to every passage | **Yes** | Yes — footer content if needed |
| `PassageDone` | After passage renders | No (code only) | Yes — post-render cleanup, audio triggers |

#### Execution order per passage

```
1. PassageReady    → code runs (no output) — set up variables before render
2. PassageHeader   → rendered before passage content — HUD, status bar
3. :: PassageName  → the actual passage content — story text, choices
4. PassageFooter   → rendered after passage content
5. PassageDone     → code runs (no output) — cleanup, trigger audio events
```

#### What matters for the headless architecture

```
StoryData       → parsed on upload for IFID, format, start passage
StoryTitle      → extracted for game list display
StoryInit       → character stats injected here before game loads
StoryStylesheet → CSS styling, runs in headless tab
PassageReady    → pre-render logic (invisible, but affects game state)
PassageHeader   → compact HUD: "$charName | HP: $health | Depth: $depth"
PassageFooter   → footer content if needed
PassageDone     → post-render logic (invisible, e.g. audio event triggers)
```

Everything else (sidebar passages, StoryInterface, StoryDisplayTitle) is ignored — the SugarCube UI bar is hidden and replaced by React components.
