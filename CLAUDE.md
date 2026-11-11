# portfolio-voxel: context for Claude Code

Carried over on 2026-11-10 from the claude.ai Chat project "portfolio", chat "Voxel portfolio direction".
How the site works, what to edit where and how to test is in README.md; this file only holds what lives in that chat.

## Where it stands

Three showcase tabs on the right: dog lab (RL dog + lucky cat), sfm in a box (snack machine default, temple, cat),
and gradient golf (`#golf`, newest). All three test suites pass:

```
node tests/brain.test.js
node tests/sfm.test.js
node tests/golf.test.js
```

Gradient golf: 5 holes, total par 38 (bowl 5 / fake hole 6 / ravine 8 / plateau 10 / windy 9). Score = steps (hops),
not swings. Ball stopping in the fake hole restarts from the tee and keeps the step count. Tab labels were made a bit
smaller on all three tabs so three tabs + "expand" fit at narrow widths.

Golf props (`assets/models/golf-props.js`): Kenney minigolf windmill (default green/terracotta colours, not the purple
variant), NZFawkes golf cart (CC BY, credited in footer + LICENSES.md), Kytric tree-3, tree-5, stone-3.
Deliberately skipped: brown bushes, Kenney flag (custom drooping flag instead), castle.
VoxelVillagePack (in ../portfolio-voxel-design) has no licence file: keep it out until its source is known.

Source assets live in ../portfolio-voxel-design; screenshots in ../portfolio-voxel-shots.

## Done in Claude Code (2026-11-10)

- Hop timing: `GolfCore.pace()` — hop time ∝ √length (clamped 40–450ms), whole swing ≤ 3s; arc height ∝ length, so the
  fall looks like constant gravity. Tested in tests/golf.test.js.
- Golf speech bubble removed (dog lab keeps its bubble). Context line resets to the hole's line when a swing starts.
- Columns in front of the ball and taller than it are redrawn over it. −gradient arrow is ink on a paper halo.
- After the cup: "swing again" (fresh try from the tee, hole score cleared) + a separate "next hole →" (#golf-next);
  "reset hole" hides then, since two buttons just fit the 212px side column.
- Smoke test runs with `uv run --with playwright python tests/smoke.py` (uses installed Chrome; no Chromium download).

- Resume at assets/Manishwaran-Murugan-Resume.pdf (header link on every page). Papers live in assets/papers/ and show on each project page (projects/<slug>.html): raster-poster.pdf (IISc RASTER
  poster, as-is) and uav-debris-paper.pdf (VIT UAV debris paper — a copy with all four authors' emails redacted; the
  original is in ~/Documents/Resume/Context/IISC; not found on IEEE Xplore as of 2026-11-10, so this is its first public copy).

## Project pages (2026-11-10)

- Home lists all 6 projects from `js/projects.js` (NeRF + SfM folded into raster: same project); each row opens `projects/<slug>.html`.
- `node tools/build.js` writes `projects/<slug>.html`, `projects/index.html` and `sitemap.xml` from `js/projects.js`;
  `node tools/build.js --check` fails if they are stale. Generated files are committed. `demos.html` is hand-written.
- Add a project: add an entry to `js/projects.js` (slug, title, oneLiner, tags, where, year, overview, figures, optional
  `pdf` + `pdfLabel`, optional `media`), put figures in `assets/projects/<slug>/`, run `node tools/build.js` (it also deletes pages of removed projects), run the tests.
- Add a showcase: add it to both `index.html` and `demos.html` (see README).
- Tests: `node tests/{brain,sfm,golf,projects}.test.js` and `uv run --with playwright python tests/smoke.py`.

## Still open

- Hole 5: a lucky momentum setting can sink it in 3 (par 9). Left as is: under par is fine.
