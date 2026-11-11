# Project pages, projects index and demos page — design

Date: 2026-11-10 · Status: draft, waiting for Manish's review

## Goal

A recruiter who opens the site, or a project link shared on LinkedIn / in a DM, can read what each project was,
what Manish built and what came out of it, and open the paper or poster, without leaving the site.

## What Manish asked for

- Home stays exactly as it looks now (intro, project list, voxel demos, footer).
- Home lists **all** projects; clicking one opens its own page with an overview and the paper/poster.
- A **projects** page that shows the same projects in more detail.
- A **demos** page holding the voxel demos, for when there are more than fit on home. Home keeps its demos too.
- Nav like the reference site's index (home / projects / demos), in this site's own style, not a copy of the
  reference's keypad.
- Claude drafts the overviews from the poster, paper and resume; Manish edits the wording.

## Assumptions (Manish didn't say; correct them)

- The 7 projects: NeRF faster, True-scale 3D from drones (RASTER, IISc), Synthetic SFT data (Dimaag), Beach trash from
  the air (VIT paper), Qwen3 agent harness (Dimaag), AI-Town narrative sim, Price forecasting (ITC).
- Order on home and projects: newest first, IISc/VIT research grouped with their year.
- Site URL stays https://manishmrgn.github.io/ (from the current canonical tag).

## Approach

One data file is the single source of truth; a small Node script writes static HTML pages from it, so every page has
its full text and its own link-preview tags without the browser running JavaScript. The site itself still has no
build step: the script runs only when project text changes, and its output is committed with the site.

Rejected: one JS-rendered template page (shared links would all show the home preview card); hand-written pages
(the list would live in several places).

## Files

| File | What |
|---|---|
| `js/projects.js` | The data: per project `slug, title, oneLiner, tags, where, year, overview { problem, built, results[] }, figures[], pdf, links[]`. Loads in the browser (`window.PROJECTS`) and in Node (`module.exports`), as `golf-core.js` does. |
| `tools/build.js` | `node tools/build.js` writes `projects/<slug>.html`, `projects/index.html` and rewrites `sitemap.xml`. `--check` exits non-zero if any output is out of date. No dependencies. |
| `projects/<slug>.html` | Generated. Header nav, title, where/year, tags, overview (problem → what I built → results with numbers), figures, the PDF shown inline (`<object>`, with a "download / open" link; phones get the link only), back link. Own `<title>`, description, canonical and og tags. |
| `projects/index.html` | Generated. All projects as cards: title, where/year, one-liner, tags, "read more →". |
| `demos.html` | Hand-written. The three showcases full width, each with a one-line description. Phase 2. |
| `assets/projects/<slug>/` | Figures cut from the poster and paper (PNG/JPG, sized for the page). |
| `js/site.js` | `PROJECTS` comes from `js/projects.js`; each home row links to `projects/<slug>.html`. |
| `index.html` | Adds the nav and loads `js/projects.js`. Nothing else visible changes. |
| `css/style.css` | Nav, project page and card styles, reusing the existing tokens (paper, ink, accent, fonts). |

## Home

- Looks the same. The list grows from 4 to 7 rows; the hover preview keeps working (one-liner + tags).
- If 7 rows break the no-scroll rule at 1280×800, the list scrolls inside its own box instead of the page.
- Nav: `home · projects · demos` in the mono font, top of the left column, current page marked.

## Project page content (drafted by Claude, edited by Manish)

- RASTER and Beach trash: from the poster, the paper and the resume; figures from the poster/paper.
- The other five: from the resume only, so shorter, no PDF, no figures until Manish adds some.
- Numbers only where a source states them (e.g. 0.2 cm on an 18 cm marker, 27 h → 40 s, 81.7% → 86.1% mAP@50).
- Co-authors credited by name on RASTER and Beach trash.

## Demos page (phase 2)

The three showcases on one page, each in its own full-width block. Only one runs at a time (the others pause on
`showcase:hide`), as on home. Built after the project pages work, since it reuses the demo code in a new layout.

## Error handling

- Missing PDF or figure: `build.js` fails with the path, rather than writing a page with a dead link.
- No JavaScript: every generated page reads fully without it. Home's list still needs JavaScript, as it does today;
  the nav's "projects" link reaches the same pages without it.

## Testing

- `node tests/projects.test.js`: every project has the required fields; slugs are unique; every PDF and figure exists;
  `build.js --check` passes (pages match the data); each generated page has its own title, description and og tags.
- `tests/smoke.py`: nav works on all pages; each project page loads with no console errors; PDF links return 200;
  home still fits 1280×800 and 1440×900 with no scroll; no horizontal overflow at 390 px.
- Existing tests keep passing.

## Out of scope

- Writing, collections, notes sections like the reference site.
- A blog or CMS. Search on the site.
- Links for NeRF faster / Synthetic SFT data beyond what the resume supports.
