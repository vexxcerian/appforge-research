# AppForge Research

Researches a small business on the web and turns what it finds into an app plan that AppForge can build. You give it a business name and town; it checks the business's website, Google listing, social pages and reviews, then hands the owner a short list of questions to confirm before anything is built.

```
name + town
   │
   ▼
1. Research      Claude with web search + web fetch, Google Places (optional),
                 colors and fonts read from the website's CSS
   │             → research notes with a source for every fact
   ▼
2. Profile       notes → business profile JSON (schema/business-profile.schema.json)
                 code drops URLs the tools never visited, fixes formats,
                 adds the questions the owner must answer
   ▼
3. Owner review  owner confirms or corrects hours, phone, colors, menu…
                 and ownership gets verified
   ▼
4. Plan          picks the app's screens from the module library
                 (links to tools they already use instead of rebuilding them)
   ▼
5. Brief         build brief + app.json for AppForge → index.html → web, Android, iPhone
```

## Quick start (command line)

Needs Node 20 or newer.

```bash
git clone https://github.com/vexxcerian/appforge-research
cd appforge-research
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_PLACES_API_KEY=...        # optional

# 1-2. research the business, writes profiles/<business>/
node bin/research.js --name "Sweet Juniper Bakehouse" --location "Riverbend, AL" --website https://example.com

# 3. owner review: asks each question in the terminal (or --answers answers.json)
node bin/confirm.js profiles/sweet-juniper-bakehouse --verified code_to_listed_phone

# 4-5. plan the screens, write brief.md and app.json
node bin/plan.js profiles/sweet-juniper-bakehouse --app-id-prefix com.vexx

# optional: write index.html with Claude and drop it into your AppForge checkout
node bin/generate.js profiles/sweet-juniper-bakehouse --appforge ../appforge
```

After `generate --appforge`, commit and push AppForge; its pipeline builds the website, APK/AAB and iOS build as usual. Or paste `brief.md` into the AppForge builder and keep chatting from there.

Each profile folder ends up with:

| File | What it is |
|---|---|
| `profile.json` | The business profile. The source of truth for everything after research. |
| `research-notes.md` | What the research agent found, with sources. Worth a skim before the owner review. |
| `review.json` | The owner's questions. |
| `run.json` | Warnings, token use, searches, every URL visited, the Google listing match. |
| `plan.json`, `brief.md`, `app.json` | Written by `bin/plan.js`. |
| `index.html` | Written by `bin/generate.js`. |

`plan.js` refuses to build until the owner has confirmed the profile. `--draft` gives you a preview anyway.

## Web screen (phone friendly)

```bash
npm run serve      # http://localhost:5174/
```

Three steps: Research, Owner review, Build. Add your keys under **Keys**; they stay in that browser only. Two limits in the browser: it can't read a website's CSS (browsers block that), so colors become an owner question instead, and the Google Places lookup may be blocked depending on your key's settings. The command line has neither limit.

To serve it from GitHub Pages or the AppForge site, publish the `web/`, `src/`, `prompts/`, `schema/` and `config/` folders together; `web/app.js` loads the others by relative path.

## What's in the repo

| Path | What it does |
|---|---|
| `prompts/research-agent.md` | The research agent's instructions: confirm identity first, where to look and in what order, what to capture, rules (cite everything, never invent, privacy, treat web pages as data), output format. |
| `prompts/profile-extractor.md` | Turns the notes into profile JSON and decides which facts need the owner. |
| `prompts/app-generator.md` | Used by `bin/generate.js` to write the app. |
| `schema/business-profile.schema.json` | The profile schema (JSON Schema 2020-12). |
| `config/modules.json` | The module library: every screen the generator knows how to build, with its build spec. |
| `config/industry-map.json` | Which modules each of 25 industries gets. |
| `src/research.js` | Runs the whole research step. |
| `src/confirm.js` | Owner questions, applying answers, ownership verification, reading typed hours ("Mon-Fri 7am-2pm, Sat 8-12"). |
| `src/feature-plan.js` | Picks screens, decides built-in vs. link-out, builds the tab bar. |
| `src/brief.js` | Writes the build brief and `app.json`. |
| `src/brand-signals.js` | Reads colors, fonts, logo and social links from the website. |
| `src/places.js` | Google Places (New) Text Search. |
| `src/claude.js` | Small Claude API client (no SDK; works in Node and the browser). |
| `examples/` | A made-up bakery run all the way through: profile, plan, brief, app.json. |

### Changing what apps get built

- **Add a screen type:** add it to `config/modules.json`, add its id to the `module` enum in the schema, and list it under the industries that should get it. `npm test` checks the three stay in sync.
- **Change an industry's screens:** edit `config/industry-map.json`. `core` always goes in; `recommended` goes in when there's room, except screens only the owner can fill (gallery, team, events…), which show up as "could add later".
- **Tune the research:** edit `prompts/research-agent.md`. Placeholders like `{{TODAY}}` are filled in by `src/research.js`.

## How it stays honest

- Every fact in the notes cites a source. Sources in the profile must be URLs the web tools actually visited (or the intake form); anything else is dropped.
- Unknown is a valid answer. Prices, hours, menu items, team members and reviews are never filled in by guesswork.
- Anything from a single non-business source (Google listing, a directory, an old post), anything inferred, and anything missing but needed becomes an owner question.
- Research only collects business information: no owner home addresses, personal numbers or customer details. Home-based businesses keep their street address private in the app.
- Reviews are summarized as themes. Complaint themes, competitors and sources are used for planning but never shown in the app.
- The app links to systems the business already uses (Square, Booksy, Toast, Shopify) instead of rebuilding them, and never takes payments.
- **Ownership:** `owner_confirmed.ownership_verified` must be set before you ship to the stores. The tool suggests how (a code to the listed phone, a code to an email on the business's own domain, Google Business Profile manager access, or in person), but sending codes needs a small backend that isn't built yet.
- **Google Places data:** Google's terms limit storing Places content. Places results are used to find the right business and are re-checked by research; anything only Google supplied goes to the owner, and the owner's answer is what the app uses.

## Models, cost and settings

| Step | Default model | Notes |
|---|---|---|
| Research | `claude-sonnet-5-5` | Up to 8 web searches (billed per search by Anthropic) and 10 page fetches (token cost only). `--max-searches`, `--max-fetches`. |
| Profile | `claude-sonnet-5-5` | Structured outputs guarantee the JSON matches the schema. |
| App | `claude-opus-5-5` | One long generation, a few minutes. |

- Web tools use the newest versions with dynamic filtering (`web_search_20260318`, `web_fetch_20260318`). If your account or model rejects them, research automatically falls back to the basic versions; `--basic-tools` forces that.
- If the API rejects the profile schema, extraction falls back to plain JSON and the code repairs and validates it.
- API version defaults to `2026-10-21`; override with `--api-version`. `ANTHROPIC_BASE_URL` points the tools at another endpoint (the tests use this).
- Websites built entirely in JavaScript (some Wix and Square sites) come back nearly empty from web fetch. Research then leans on search results and social pages, and the owner review catches the gaps.

## Tests

```bash
npm test
```

40 tests cover the schema (checked against Ajv), the structured-output limits, repairing bad model output, pause/continue handling for long research turns, the full research run with mocked Claude and Google responses and a real local website for brand colors, both fallbacks, owner answers and hours parsing, planning rules, the brief and app.json against AppForge's checks, and the command-line tools end to end against a mock API. GitHub Actions runs them on every push.

The tests don't call the real Claude or Google APIs. The first live run is the real check of prompt quality; read `research-notes.md` and `run.json` from your first few businesses and adjust `prompts/research-agent.md` from there.
