# Project pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home lists all 7 projects; each opens a static page (overview, figures, inline PDF); a projects index and a demos page sit beside home under a `home · projects · demos` nav.

**Architecture:** `js/projects.js` is the single source of truth (browser global + Node module). `node tools/build.js` renders static `projects/<slug>.html`, `projects/index.html` and `sitemap.xml` from it; the output is committed, so the site keeps no build step. Home's list and the demos page reuse the existing `js/site.js`, guarded so missing elements are skipped.

**Tech Stack:** plain HTML/CSS/JS (ES5 style, like the rest of the site), Node (no dependencies) for the generator and tests, Python + Playwright (`uv run --with playwright`) for the browser smoke test.

**Spec:** `docs/superpowers/specs/2026-11-10-project-pages-design.md`

## Global Constraints

- No runtime build step, no frameworks, no npm dependencies. The generator uses Node built-ins only.
- Home looks exactly as it does now, apart from the nav line and 7 list rows.
- Home fits 1280×800 and 1440×900 with no page scroll; no horizontal overflow at 390 px.
- Every generated page reads fully with JavaScript off and has its own `<title>`, `meta description`, `link rel=canonical`, `og:title`, `og:description`, `og:url`, `og:image`.
- Site URL: `https://manishmrgn.github.io/`.
- Numbers in overviews only where the poster, paper or resume states them.
- Pages under `projects/` use relative paths (`../css/style.css`) so they work over `file://` and on GitHub Pages.
- Reuse the existing CSS tokens (`--paper`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--accent`, `--mono`) and fonts; no new colours.
- This folder is not a git repo: "commit" steps become "run all tests" until Manish runs `git init`.

## Review Focus

- A project with no `pdf` and no `figures` (5 of 7): page renders with no empty embed box and no "download" link.
- Text containing `&`, `<`, quotes (e.g. "Qwen3 & RAG"): escaped in HTML and in meta attributes.
- 7 rows on home at 1280×800: if the page would scroll, the list scrolls inside `.work-body` instead.
- Project page at 390 px wide: PDF shown as an "open pdf" link, not a squeezed embed; no horizontal overflow.
- Dark mode on generated pages: the theme script in `<head>` runs, so a saved "dark" choice applies before paint.

---

### Task 1: Project data

**Files:**
- Create: `js/projects.js`
- Create: `tests/projects.test.js`
- Modify: `README.md` (edit table: projects now live in `js/projects.js`; how to run the generator)

**Interfaces:**
- Produces: `PROJECTS` array (browser: `window.PROJECTS`; Node: `module.exports = PROJECTS`). Each item:
  `{ slug: string, title: string, oneLiner: string, tags: string[], where: string, year: number, with?: string[],
     overview: { problem: string, built: string[], results: string[] }, figures: [{ src, alt, caption }], pdf?: string,
     pdfLabel?: string }`. `src`/`pdf` are paths from the site root (`assets/...`).

- [ ] **Step 1: Write the failing test** `tests/projects.test.js` (same tiny `test()` harness as `tests/golf.test.js`):
  - `every project has slug, title, oneLiner, tags (≥1), where, year, overview.problem, overview.built (≥1), overview.results (≥1)`
  - `slugs are unique and match /^[a-z0-9-]+$/`
  - `every pdf and figure src exists on disk` (`fs.existsSync(path.join(root, src))`)
  - `there are 7 projects, newest year first` (`years` non-increasing)
- [ ] **Step 2: Run** `node tests/projects.test.js` — expect FAIL (cannot find `js/projects.js`).
- [ ] **Step 3: Write `js/projects.js`.** Slugs and sources:

  | slug | title | where · year | source |
  |---|---|---|---|
  | `sft-data` | Synthetic SFT data | Dimaag-AI · 2026 | resume |
  | `agent-harness` | Qwen3 agent harness | Dimaag-AI · 2026 | resume |
  | `price-forecasting` | Price forecasting | ITC Infotech · 2025 | resume |
  | `ai-town` | AI-Town narrative sim | personal · 2025 | resume |
  | `raster` | True-scale 3D from drones | IISc Aerospace (AIRL) · 2024 | poster `assets/papers/raster-poster.pdf` + resume |
  | `nerf` | NeRF, faster | IISc · 2024 | resume |
  | `debris` | Beach trash from the air | VIT · 2024 | paper `assets/papers/uav-debris-paper.pdf` + resume |

  `with` on `raster` and `debris`: Meghana V Gaonkar, Leona E Joseph; advisor Dr. R Balamurugan. Figures arrive in Task 2 (leave `figures: []` here).
- [ ] **Step 4: Run** `node tests/projects.test.js` — expect PASS.
- [ ] **Step 5: Run all tests** (`node tests/{brain,sfm,golf,projects}.test.js`).

### Task 2: Figures from the poster and paper

**Files:**
- Create: `assets/projects/raster/*.jpg`, `assets/projects/debris/*.jpg`
- Modify: `js/projects.js` (`figures` for `raster`, `debris`)

**Interfaces:**
- Consumes: `PROJECTS[].figures` shape from Task 1.

- [ ] **Step 1:** With PyMuPDF (`uv run --with pymupdf`, script kept in the session scratchpad, not the repo), cut 2 figures per project: `raster` → pipeline diagram, rescaled mesh; `debris` → one detection example, the results chart/table. JPEG, max 1200 px wide, ≤ 250 KB each.
- [ ] **Step 2:** Look at each image; reject any that shows an email address or is unreadable.
- [ ] **Step 3:** Add them to `figures` with `alt` text and a one-line `caption`.
- [ ] **Step 4: Run** `node tests/projects.test.js` — expect PASS (the "files exist" test covers the new paths).

### Task 3: Generator

**Files:**
- Create: `tools/build.js`
- Create: `projects/index.html`, `projects/<slug>.html` ×7 (generated), rewrite `sitemap.xml` (generated)
- Modify: `tests/projects.test.js`

**Interfaces:**
- Consumes: `PROJECTS` from Task 1.
- Produces: `node tools/build.js` writes the files; `node tools/build.js --check` writes nothing and exits 1 listing stale files. Exports `render()` → `{ [relativePath]: html }` for tests. Page markup classes used by Task 4's CSS: `.nav`, `.nav [aria-current="page"]`, `.proj`, `.proj-meta`, `.proj-tags`, `.proj-grid` (problem / built / results), `.proj-figs figure`, `.proj-pdf` (`<object>` + fallback link), `.cards`, `.card`.

- [ ] **Step 1: Write failing tests** in `tests/projects.test.js`:
  - `render() has projects/index.html, one page per slug, and sitemap.xml`
  - `each project page has its own <title>, meta description, canonical and og:title/description/url/image` (regex on the html; canonical = `https://manishmrgn.github.io/projects/<slug>.html`)
  - `html special characters are escaped` (render a fake project titled `A & <B> "C"`; page contains `A &amp; &lt;B&gt; &quot;C&quot;` in `<title>` and `og:title`)
  - `pages without a pdf have no <object> and no download link`; `pages with a pdf have both`
  - `every relative href/src in a generated page resolves to a file` (resolve against `projects/`)
  - `build --check passes` (spawn `node tools/build.js --check`, exit code 0)
  - `sitemap lists /, /projects/, /demos.html and every project page`
- [ ] **Step 2: Run** — expect FAIL (`tools/build.js` missing).
- [ ] **Step 3: Write `tools/build.js`.** One shared `layout(title, desc, url, body)`; head copies `index.html`'s theme-script, fonts, colour-scheme and theme-color tags with `../` paths; footer is the static part of home's footer (github · linkedin · resume, theme toggle) + `../js/theme.js`. Project page order: nav, back link, title, meta line (where · year · with), tags, the three overview blocks, figures, PDF (`<object data="../<pdf>" type="application/pdf">` + "open pdf" / "download" link), back link. Index: `.cards`, one card per project (title, where · year, oneLiner, tags, "read more →"). A missing `pdf` or figure file stops the build with that path in the message.
- [ ] **Step 4: Run** `node tools/build.js`, then `node tests/projects.test.js` — expect PASS.

### Task 4: Nav, home list and page styles

**Files:**
- Modify: `index.html` (nav line above the intro; `<script defer src="js/projects.js">` before `js/site.js`)
- Modify: `js/site.js` (remove the inline `PROJECTS`; read `window.PROJECTS`; rows link to `projects/<slug>.html`; preview shows `oneLiner` and `tags`)
- Modify: `css/style.css` (nav; project page; cards; `.work-body` list scrolls inside itself only when needed)
- Modify: `tests/smoke.py`

**Interfaces:**
- Consumes: `window.PROJECTS` (Task 1), the class names from Task 3.

- [ ] **Step 1: Write failing smoke checks** in `tests/smoke.py`:
  - `home: nav shows home · projects · demos, home marked current`
  - `home: 7 project rows, each links to projects/<slug>.html`
  - `home: still no scroll at 1280x800 and 1440x900` (existing checks keep running with 7 rows)
  - `projects: index lists 7 cards, each links to its page`
  - `project pages: load with no console errors; every link and pdf returns 200` (loop over slugs)
  - `project page at 390px: no horizontal overflow; the pdf is a link, the embed is hidden`
  - `project page: a saved dark theme applies` (set `localStorage['portfolio-theme']='dark'`, reload, `html[data-theme]=="dark"`)
- [ ] **Step 2: Run** `uv run --with playwright python tests/smoke.py` — expect the new checks to FAIL.
- [ ] **Step 3:** Make the changes listed under Files. At ≤ 600 px, `.proj-pdf object { display: none }` and the link stays.
- [ ] **Step 4: Run** the smoke test and all Node tests — expect PASS. Look at home, the index and two project pages (one with a PDF, one without) in light and dark in the browser pane.

### Task 5: Demos page (phase 2)

**Files:**
- Create: `demos.html`
- Modify: `js/site.js` (each block — tabs, projects, clock, coords — skips itself when its element is missing)
- Modify: `tests/smoke.py`, `README.md` ("Adding a showcase": add it to `demos.html` too)

**Interfaces:**
- Consumes: the three showcase `<section>`s and scripts as in `index.html`; `SHOWCASES` in `js/site.js`.

- [ ] **Step 1: Write failing smoke checks:** `demos: nav marks demos current; the three tabs switch panels; no console errors; no horizontal overflow at 390px; switching tabs pauses the hidden demo` (reuse the existing `showcase:hide` check).
- [ ] **Step 2: Run** — expect FAIL (`demos.html` missing).
- [ ] **Step 3:** `demos.html` = same head and footer as home, nav, one line per demo describing it, then the showcase block full width. Same section ids, so the demo scripts work unchanged.
- [ ] **Step 4: Run** all tests — expect PASS. Look at it in the pane.

### Task 6: Wrap-up

- [ ] Update `CLAUDE.md` (what was built; how to add a project: edit `js/projects.js`, run `node tools/build.js`).
- [ ] Run every test one last time; record the pass counts.
