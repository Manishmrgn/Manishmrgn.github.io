# Manish Murugan — portfolio

A one-screen personal site. On the left: who I am and four projects. On the right: my dog, as a
voxel sprite, learning to reach a bone with reinforcement learning — live, in your browser.
Visitors can drop blocks, treats, ice, mud and a small bone on the map and watch it relearn.
A second tab, "sfm in a box", rebuilds a voxel snack machine (or a temple, or a lucky cat) in 3D from cameras you drag around it.
A third, "gradient golf", is gradient descent played as mini-golf on a voxel loss surface.

Plain HTML, CSS and JavaScript. No build step, no frameworks, no dependencies. The only external
resource is Google Fonts (Newsreader, JetBrains Mono); without a connection it falls back to
system serif and monospace.

## Run it

Double-click `index.html`. Or serve the folder:

```
python3 -m http.server
```

then open http://localhost:8000.

## Edit it

| What | Where |
| --- | --- |
| Name, tagline, intro paragraphs | `index.html` (look for the `INTRO` comment) |
| Projects (title, one-liner, tags, overview, figures, pdf) | `PROJECTS` in `js/projects.js`; then run `node tools/build.js` to regenerate `projects/*.html` and `sitemap.xml` |
| GitHub / LinkedIn links | `LINKS` at the top of `js/site.js` |
| Email | `EMAIL` at the top of `js/site.js` — it ships as the placeholder `you@example.com` |
| Footer clock time zone | `TIME_ZONE` at the top of `js/site.js` |
| Colours (light and dark) | the `:root` tokens at the top of `css/style.css` |
| The left/right split: default, range, expand target, storage key | the config block at the top of `js/split.js` (desktop only; `--l`/`--r` in `css/style.css`) |
| The dog's lines, speed, tile size | the `CONFIG` block at the top of `js/dog.js` |
| Map, rewards, learning hyperparameters | `CONFIG` at the top of `js/brain.js` |
| sfm: start cameras, timings, the context lines | the `CONFIG` block at the top of `js/sfm.js` |
| sfm: camera image size, focal length, pixel noise | `CONFIG` at the top of `js/sfm-core.js` |
| golf: the five holes, pars, default settings, cup size | `CONFIG` and `HOLES` at the top of `js/golf-core.js` |
| golf: context lines, props, hop height | the `CONFIG` block at the top of `js/golf.js` |
| golf: hop timing (√ of hop length, whole swing ≤ 3s) | `HOP_MS`, `SWING_MS` in `CONFIG` in `js/golf-core.js` |

## How the dog learns

The world is a 6×6 grid. The dog starts at (0,1); the bone is at (5,1); a river of gaps at x=3
blocks the direct route, so the only way is the long way round through (3,5) — 13 moves.

- Rewards: −0.02 per step, +1 for the bone, −1 for falling in a gap (both end the attempt),
  −0.05 extra for bumping a wall, +0.3 for a treat. 50 steps is a timeout.
- The brain is a small DQN written by hand in `js/brain.js`: 61 inputs (one-hot position, what is
  next to the dog in each direction, whether it is on ice) → 24 ReLU units → 4 Q-values, one per
  move. Adam, learning rate 0.005, discount 0.95, a 3,000-transition replay buffer, batches of 16,
  a target network copied every 150 updates, TD error clipped to ±1.
- It explores with epsilon-greedy: 90% random moves at first ("zoomies"), decaying to 5%.
- The dog you see moves about four times a second. Behind it, four practice dogs run the same
  policy on the same map (~12 steps per frame) and feed the same network and replay buffer, which
  is why it gets good in roughly ten seconds rather than ten minutes.
- When you change the map, the replay buffer is cleared and exploration is lifted to at least
  30%, but the weights are kept — so you can watch old habits fail and get replaced.
  "↺ new day" resets the map and the weights.
- Green on screen is what the model believes: the tile tint is each tile's value (max Q), the
  dashed line is the greedy plan from where the dog stands, the green node is the chosen move.
  A coral node means that move was random exploration.

### Pieces

| Piece | What it does | What the dog has to work out |
| --- | --- | --- |
| block | bridges a gap, or walls off ground | a shorter route, or a lost one |
| treat | +0.3; grows back 6 steps after it is eaten | a ring of treats far from the bone pays better than the bone, so it farms them until the timeout: reward hacking |
| ice | 35% chance to slide sideways when leaving it | risk next to gaps |
| mud | walkable, −0.08 extra to step in | wade through or take the detour |
| bone (small) | ends the attempt for +0.4; only one on the map | near and small against far and big (+1) |
| erase | removes a piece you placed | |

Clicking the dog's own tile (or Enter on it with the keyboard cursor) pets it. It sits. Nothing is
learned from this.

After 5 attempts in a row without a bone the dog says so in the log ("stuck ×5") and digs at the
start tile; after 9 the hint under the map suggests a bridge or a new day. Both clear the next
time it reaches a bone. The counter is `brain.attemptsSinceGoal` in `js/brain.js`.

It is a real, small, somewhat unstable DQN: now and then the greedy plan wobbles for a moment
even after it has learned the route.

## sfm in a box

The second showcase (`#sfm`) teaches structure from motion. A voxel snack machine (or a temple or a lucky cat, from the picker) sits on a tile,
ringed by cameras. Drag a camera along the ring and up or down (or Tab to it and use the arrow
keys; Delete removes it), add up to 8, or press "film it" to walk one around like a phone.

- Each camera is a pinhole (100×66 px) looking at it. Its thumbnail is a painter's-algorithm
  render; the coral dots are surface landmarks it can actually see (occlusion is ray-marched through
  the voxels), each with 0.5 px of noise.
- Matching is given: a landmark knows which landmark it is. Real SfM matches by appearance
  (descriptors). Everything after that is computed from the noisy 2D points.
- Every landmark seen by two or more cameras is triangulated as the least-squares meeting point of
  its rays. Cameras close together make those rays nearly parallel, and the depth visibly scatters.
- Each camera's estimated pose starts a few degrees off. "refine" (it also runs by itself after a
  change) is a small bundle adjustment: a damped Gauss–Newton step on each camera's pose, then
  re-triangulate, six rounds. Camera 1 is held fixed as the reference. Reprojection error drops.
- "densify → voxels" bins the points into a 1-voxel grid, colours each cell from its nearest
  point, and plugs holes with one dilation pass.

The maths is in `js/sfm-core.js` (no DOM, loads in Node); the drawing and input are in `js/sfm.js`.
Nothing runs while it is idle: it recomputes only when something changes.

## gradient golf

The third showcase (`#golf`) is gradient descent as mini-golf. The course is the loss, drawn as voxel columns; the ball is
the parameters θ; each hop is one optimizer step. Pick sgd, momentum or adam, set the learning rate (and β), press swing.
The score is the number of steps; leaving the course costs 2 and puts the ball back on the tee.

- Five holes, one lesson each: bowl (learning rate), fake hole (a local minimum; momentum rolls through), ravine
  (ill-conditioning; adam), plateau (vanishing gradients), windy (noisy minibatch gradients; the noise sums to zero
  over an epoch of 4, so a little momentum averages it out).
- Every loss is a bowl around the cup minus Gaussian dips, with an analytic gradient. The ball is in the cup when a step
  ends within 0.17 of the minimum, or rolls past that close at no more than 0.5 a step.
- A ball stuck in the fake hole has no gradient to leave by, so its next swing starts from the tee again (strokes kept).
- The red dots and the corner map are the textbook figure: the path of θ over the contour lines. The green arrow is −gradient.

The maths is in `js/golf-core.js` (no DOM, loads in Node); drawing and input are in `js/golf.js`. The props are in
`assets/models/golf-props.js`; without them the course still plays.

## Adding a showcase

1. In `index.html`, add a `<section class="dog" id="my-demo" role="tabpanel">` inside `.showcases`, after the others.
2. Add its script (classic `<script defer>`) before `js/site.js`.
3. Add `{ id: 'my-demo', label: 'my demo' }` to `SHOWCASES` at the top of `js/site.js`. `#my-demo` then links to it.
4. Pause your loop on the section's `showcase:hide` event and resume on `showcase:show` (see the end of `js/dog.js`). Keep it within one screen, no scroll.

## Tests

```
node tests/brain.test.js
```

No test framework needed. The tests cover the world rules (mud, the small bone, treats growing
back, the stuck counter) and, with a seeded random number generator, that the dog learns the long
way round, switches to a bridge once one is placed, and farms a ring of treats.

```
node tests/sfm.test.js
```

Covers the SfM maths: projection round-trip, exact triangulation without noise, a wide baseline
beating a narrow one with noise, refine lowering reprojection error, occlusion, and densify
staying inside the temple.

```
node tests/golf.test.js
```

Covers the golf maths: gradients against finite differences, each cup being the true minimum, par being reachable by a
good setting and missed by a sloppy one, and what each hole teaches (sgd stuck in the fake hole while momentum escapes,
sgd zig-zagging in the ravine, stalling on the plateau, thrown about by the wind).

```
uv run --with playwright python tests/smoke.py
```

Needs Chrome (it drives your installed one) and `uv`, which fetches Playwright into its own cache;
`pip install playwright` then plain `python3 tests/smoke.py` works too. Opens `index.html` over `file://` and checks console
errors, overflow, that the sprites load, the procedural fallback, placing pieces, petting and the
credits popover; then the sfm tab: switching pauses the dog, dragging a camera changes the 3D
points, refine, film it, densify and the context messages; then the golf tab: a swing on hole 1, the
optimizer chips, a round by keyboard, and one screen at both splits in light and dark. Its settings
are constants at the top of the file.

## Art and credits

The sprites live in `assets/sprites/` and `assets/tiles/`; `js/dog.js` scales them from their
128px tile to the tile size on screen. If any of them fails to load, the widget draws the old
procedural voxels instead. Full details are in `LICENSES.md`.

- Dog: [Stylized Dog](https://sketchfab.com/3d-models/stylized-dog-f8197b0813aa4d9cacb7c3939459950b)
  by Sod's Low, CC BY 4.0, rendered to sprite frames. This licence requires the credit, which is
  why the footer has a "credits" link. Keep it.
- Blocks: Isometric Blocks by Kenney (www.kenney.nl), CC0.
- Bones, treat, gap and shadow were made for this project.

## Deploy free on GitHub Pages

1. Create a repository and push this folder's contents to it (`index.html` at the root).
2. On GitHub: Settings → Pages → Build and deployment → Source: "Deploy from a branch".
3. Pick your branch (`main`) and the `/ (root)` folder, then Save.
4. A minute later the site is live at `https://<username>.github.io/<repo>/`.
