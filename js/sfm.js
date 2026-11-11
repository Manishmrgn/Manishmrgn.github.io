/* sfm.js — "sfm in a box": draws the voxel scene, the cameras, their thumbnails and the reconstruction.
 * The object being scanned is the snack machine (the default), the temple or the lucky cat (assets/models/*.js, if loaded).
 * All geometry lives in sfm-core.js (window.SfmCore). Nothing runs while idle: every recompute and
 * redraw is caused by a drag, a key, a button, or a step of "film it" / "refine". */
(function () {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var DEG = Math.PI / 180;
  var PANE_MAX = 480, PANE_MIN = 220;   // each of the two panels is as wide as the column allows, between these (px); narrower than 2 × min they stack
  var PANE_GAP = 14;
  var SPLIT_MQ = '(min-width: 1100px)';   // keep in step with css/style.css and js/split.js
  var TILE_AT_MAX = 29;            // iso px per voxel at PANE_MAX (a voxel is TILE wide, TILE/2 tall on screen); everything scales with the pane
  var SCENE_H_AT_MAX = 372;
  var ORIGIN_Y_AT_MAX = 246;       // screen y of the scene's centre on the ground
  var GROUND = 5;                  // ground tile half-size, voxels
  var MATCH_LINES = 150;           // match lines drawn between the selected camera and its partner, sampled evenly: thousands paint the thumbnails solid green
  var THUMB_MAX_W = 92, THUMB_MIN_W = 42, THUMB_GAP = 4;   // the camera strip: one row, thumbnails shrink to fit, then the strip scrolls sideways; the selected one and its partner come first
  var MAX_CAMS = 16;               // draggable cameras (film frames are not cameras you can drag)
  var START_CAMS = [[15, 14], [100, 28], [205, 22]];   // azimuth°, elevation°: spread enough that all four walls are seen
  var EL_MIN = -35, EL_MAX = 80;   // elevation clamp, degrees: below 0 the camera is under the ground plate, looking up at the underside
  var NEW_CAM_EL = 20;             // "+ camera" drops it at this elevation, in the widest gap on the ring
  var KEY_STEP = 5;                // degrees per arrow key
  var FRUSTUM = 1.6;               // drawn camera size, voxels
  var JITTER_DEG = 7, JITTER_R = 0.7;   // a fresh camera's pose estimate is off by up to this (degrees; voxels of radius)
  var JITTER_SEED = 100, NOISE_SEED = 200;
  var REFINE_ITERS = 6;            // bundle adjustment rounds per refine …
  var REFINE_STEP_MS = 120;        // … shown one at a time, this far apart (reduced motion: all at once, in chunks of at most …)
  var REFINE_BUDGET_MS = 12;       // … this long, so a big scan never freezes a frame
  var REFINE_DELAY_MS = 700;       // auto-refine this long after the last change
  var REFINE_WORTH_PX = 0.05;      // only announce a refine that lowered the error by at least this
  var FILM_FRAMES = 24, FILM_EL = 22, FILM_MS = 4000;   // a phone walked once round the scene: a frame every 360 / FILM_FRAMES degrees
  var FILM_STEP_DEG = 360 / FILM_FRAMES;
  var FILM_SEED = 1000;            // frames' jitter and noise seeds start here, so re-filming gives the same frames
  var SCAN_VIEWS = 20;             // this many cameras + frames, all the way round, is "a real scan"
  var BAD_PARALLAX_DEG = 10;       // a point whose rays meet at less than this is poorly triangulated …
  var BAD_FRACTION = 0.3;          // … and this share of such points means "cameras too close"
  var SIDE_COS = 0.2;              // a wall counts as seen if some camera is within ~78° of facing it
  var CONTEXT_MIN_MS = 4000;       // a context message stays at least this long
  var CONTEXT_EVENT_MS = 6000;     // the "refined" message holds this long
  var TEACH_MS = 7000;             // each line of the opening teaching sequence
  var VIEW_AZ0 = 35, VIEW_EL0 = 28;     // the reconstruction view's starting angles, degrees
  var VIEW_EL_MIN = -35, VIEW_EL_MAX = 80;   // the reconstruction can be spun to look from below too
  var SPIN_DEG_S = 12;             // slow auto-spin of the reconstruction
  var SPIN_HOLD_MS = 2500;         // after a drag or key, leave it alone this long
  var DRAG_DEG_PX = 0.6;           // degrees per pixel dragged on the reconstruction
  var POINT_R_FAR = 1.5, POINT_R_NEAR = 3.2;   // dot radius (px) by depth, far to near
  var VIEW_RADIUS = 5.6;           // voxels from the scene's centre to its far corner: sets the reconstruction's scale
  var MODES = ['points', 'voxels', 'compare'];
  var OBJECTS = ['snack', 'temple', 'cat'];  // the scene picker, default first; a model needs its window global (assets/models/*.js), else it is skipped
  var OBJECT_NAMES = { cat: 'lucky cat', temple: 'temple', snack: 'snack machine' };
  var SHADE = { top: 1, left: 0.82, right: 0.66 };   // face brightness for models with their own colours (hex), by face direction
  var CONTEXT = {
    one: "one view can't tell depth. add another camera.",
    close: 'rotate it: two close cameras smear points in depth.',
    back: "spin the reconstruction: nobody saw the back, so it's empty.",
    scan: "that's a real scan now: more views, denser points.",
    refined: function (px) { return 'refined: reprojection error down to ' + px + ' px.'; },
    scene: {
      cat: 'scanning the lucky cat. smooth white fur has fewer corners to match.',
      temple: 'scanning the temple. coloured trim and roof edges give plenty to match.',
      snack: 'scanning the snack machine. shaded panels and snack rows give plenty to match, all round.'
    },
    below: {
      temple: 'cameras from below see under the eaves.'
    },
    teach: ['drag the cameras. points seen twice become 3D.',
            'each green point = two rays crossing.',
            "try 'film it' to scan it like a phone."]
  };
  // ═══════════════════════════════════════════════════════════════════════════

  var S = window.SfmCore;
  var root = document.getElementById('sfm');
  var canvas = document.getElementById('sfm-canvas'), thumbs = document.getElementById('sfm-thumbs'), rcanvas = document.getElementById('sfm-recon');
  if (!S || !canvas || !canvas.getContext) return;   // .dog-fallback stays visible until .js-ready
  var ctx = canvas.getContext('2d'), tctx = thumbs.getContext('2d'), rctx = rcanvas.getContext('2d');
  if (!ctx || !tctx || !rctx) return;
  var $ = function (id) { return document.getElementById(id); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var R = S.CONFIG.RADIUS, IW = S.CONFIG.IMG_W, IH = S.CONFIG.IMG_H;
  var SCENE_W = PANE_MAX, SCENE_H = SCENE_H_AT_MAX, TILE = TILE_AT_MAX, OX = SCENE_W / 2, OY = ORIGIN_Y_AT_MAX;   // set by fit()
  var THUMB_W = THUMB_MAX_W, THUMB_H = Math.round(THUMB_W * IH / IW), FILM_W = 2 * THUMB_W, THUMBS_W = 0, AVAIL = 0, stripKey = '';

  // ─────────────────────────────── state ───────────────────────────────
  var scenes = {};
  try { if (window.SNACK_MACHINE_MODEL) scenes.snack = S.buildModel(window.SNACK_MACHINE_MODEL); } catch (e) { /* no snack machine: the temple is the default */ }
  try { if (window.TEMPLE_MODEL) scenes.temple = S.buildModel(window.TEMPLE_MODEL); } catch (e) { /* no temple: its picker button stays hidden (the cat is next in line) */ }
  try { if (window.LUCKY_CAT_MODEL) scenes.cat = S.buildModel(window.LUCKY_CAT_MODEL); } catch (e) { /* no cat: its picker button stays hidden */ }
  var objName = OBJECTS.filter(function (o) { return scenes[o]; })[0];
  if (!objName) { root.querySelector('.dog-fallback').textContent = "the 3D models didn't load, so there is nothing to scan here. try reloading the page."; return; }
  var scene = scenes[objName];
  var colors = scene.landmarks.map(function (lm) { return lm.color; });
  var isoFaces = sortIso(scene.faces);
  var cams = [], sel = 0, serial = 0;     // cams: { az, el, noise, jit, off, btn, pose, obs }; cams[0] is the fixed reference
  var frames = [], views = [], filmAz0 = 0, scrub = 0, scrubOn = false, scrubRaf = 0;   // frames: the film, same fields as cams but no button; views = cams then frames
  var obs = [], rec = { poses: [], points: [], matches: 0, rms: 0 }, est = [], slots = [], partner = -1;
  var showRays = false, mode = MODES[0], denseFaces = null, denseCount = 0;   // denseFaces: voxel faces, only while mode is 'voxels'
  var film = null, filmRaf = 0;           // film: { t0, az } while "film it" is animating
  var drag = null;                        // { cam, dx, dy }: pointer offset from the camera's screen position
  var base = null, baseKey = null;        // match/point counts before the change being logged
  var shown = !root.hidden, raf = 0, refineTimer = 0, teachTimer = 0, ctxTimer = 0;
  var ctxText = '', ctxSince = -Infinity, teachIdx = 0, refinedMsg = '', refinedUntil = 0, sceneUntil = 0, started = false;
  var rv = { az: VIEW_AZ0 * DEG, el: VIEW_EL0 * DEG };   // the reconstruction's view
  var rdrag = null, rraf = 0, spinRaf = 0, spinLast = 0, spinHold = 0, spinTimer = 0, onScreen = true, focused = true;
  var C = {};

  // ─────────────────────────────── sizing + colours ───────────────────────────────
  function readColors() {
    var cs = getComputedStyle(root);
    ['paper', 'ink', 'ink-2', 'ink-3', 'ink-4', 'line', 'accent', 'dog', 'tile-line',
     'tile-top', 'tile-left', 'tile-right'].forEach(function (n) {
      C[n] = cs.getPropertyValue('--' + n).trim();
    });
    C.mono = cs.getPropertyValue('--mono');
  }
  function fitCanvas(c, cx, w, h) {
    var dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function fit() {
    var avail = root.clientWidth || 2 * PANE_MAX + PANE_GAP;   // 0 while the tab is hidden
    var side = avail >= 2 * PANE_MIN + PANE_GAP || (avail > 0 && window.matchMedia(SPLIT_MQ).matches);   // two-column desktop: never stack, just shrink (the column is resizable, js/split.js)
    var w = side ? Math.floor((avail - PANE_GAP - 2) / 2) : avail, k;   // -2: clientWidth rounds, a sub-pixel overshoot would wrap the panes
    SCENE_W = Math.max(128, Math.min(PANE_MAX, w));
    k = SCENE_W / PANE_MAX;
    SCENE_H = Math.round(SCENE_H_AT_MAX * k); TILE = TILE_AT_MAX * k; OX = SCENE_W / 2; OY = ORIGIN_Y_AT_MAX * k;
    AVAIL = avail; stripKey = '';
    fitCanvas(canvas, ctx, SCENE_W, SCENE_H); fitCanvas(rcanvas, rctx, SCENE_W, SCENE_H);   // the strip is sized by layoutStrip(), as the cameras come and go
  }

  // ─────────────────────────────── cameras ───────────────────────────────
  function clampEl(el) { return Math.min(EL_MAX * DEG, Math.max(EL_MIN * DEG, el)); }
  function addCam(az, el) {
    var n = serial++, rnd = S.mulberry32(JITTER_SEED + n), j = function (s) { return (rnd() * 2 - 1) * s; };
    var cam = { az: az, el: el, nseed: NOISE_SEED + n, noise: S.makeNoise(NOISE_SEED + n, scene.landmarks.length * 2),
                jit: { az: j(JITTER_DEG * DEG), el: j(JITTER_DEG * DEG), r: j(JITTER_R) } };
    cam.off = cam.jit;
    cam.btn = camButton(cam);
    cams.push(cam);
    sel = cams.length - 1;
  }
  function makeFrame(i) {
    var n = FILM_SEED + i, rnd = S.mulberry32(JITTER_SEED + n), j = function (s) { return (rnd() * 2 - 1) * s; };
    var f = { az: filmAz0 + i * FILM_STEP_DEG * DEG, el: FILM_EL * DEG, nseed: NOISE_SEED + n, noise: S.makeNoise(NOISE_SEED + n, scene.landmarks.length * 2),
              jit: { az: j(JITTER_DEG * DEG), el: j(JITTER_DEG * DEG), r: j(JITTER_R) } };
    f.off = f.jit;
    return f;
  }
  function removeCam(i) {
    var hadFocus = document.activeElement === cams[i].btn || document.activeElement === xBtn;
    cams[i].btn.remove();
    cams.splice(i, 1);
    sel = Math.min(sel, cams.length - 1);
    if (hadFocus) cams[sel].btn.focus();
  }
  /** Azimuth in the middle of the widest gap between cameras. */
  function widestGap() {
    var az = cams.map(function (c) { return ((c.az % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }).sort(function (a, b) { return a - b; });
    var best = 0, at = az[0] + Math.PI;
    az.forEach(function (a, i) {
      var gap = (i + 1 < az.length ? az[i + 1] : az[0] + 2 * Math.PI) - a;
      if (gap > best) { best = gap; at = a + gap / 2; }
    });
    return at;
  }

  // ─────────────────────────────── the pipeline ───────────────────────────────
  /** observe → triangulate → (densify), then stats, flags and a redraw. The only place results are computed. */
  function compute() {
    var t0 = performance.now();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    views = cams.concat(frames);
    views.forEach(function (c) {                               // re-observe only the views that moved
      var k = c.az + ',' + c.el;
      if (c.key === k) return;
      c.key = k; c.pose = S.pose({ az: c.az, el: c.el, r: R }); c.obs = S.observe(scene, c.pose, c.noise);
    });
    obs = views.map(function (c) { return c.obs; });
    est = views.map(function (c, i) {                           // what SfM believes: the true pose plus its error (camera 1 pins the gauge)
      return i ? { az: c.az + c.off.az, el: c.el + c.off.el, r: R + c.off.r } : { az: c.az, el: c.el, r: R };
    });
    rec = S.reconstruct(est, obs);
    denseFaces = null;
    if (mode === 'voxels') { var dv = S.densify(rec.points, colors, scene.dense); denseCount = Object.keys(dv).length; denseFaces = S.facesOf(dv, scene.dense); }   // on demand only

    var ids = [], bestN = 0;                                   // best partner = the camera sharing the most features with the selected one: one pass over the cameras
    obs[sel].forEach(function (o, id) { if (o) ids.push(id); });
    partner = -1;
    cams.forEach(function (c, i) {
      if (i === sel) return;
      for (var k = 0, n = 0; k < ids.length; k++) if (c.obs[ids[k]]) n++;
      if (n > bestN) { bestN = n; partner = i; }
    });
    slots = [sel].concat(partner >= 0 ? [partner] : [], cams.map(function (c, i) { return i; }).filter(function (i) { return i !== sel && i !== partner; }));

    $('sfm-stat-cams').textContent = cams.length;
    $('sfm-stat-frames').textContent = frames.length;
    $('sfm-stat-matches').textContent = rec.matches;
    $('sfm-stat-points').textContent = rec.points.length;
    $('sfm-stat-err').textContent = rec.points.length ? rec.rms.toFixed(1) + ' px' : '—';
    $('sfm-add').disabled = cams.length >= MAX_CAMS;
    contextUpdate();
    draw();
    drawRecon();
    root.dataset.object = objName;
    root.dataset.landmarks = scene.landmarks.length;
    root.dataset.computeMs = (performance.now() - t0).toFixed(1);   // for the curious (and the tests)
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; compute(); }); }   // at most one recompute per frame while dragging

  function tooClose() {
    var thin = rec.points.filter(function (p) { return p.parallax < BAD_PARALLAX_DEG * DEG; }).length;
    return rec.points.length > 0 && thin / rec.points.length > BAD_FRACTION;
  }
  function wallUnseen() {
    return [0, 90, 180, 270].some(function (side) {
      return !views.some(function (c) { return Math.cos(c.az - side * DEG) > SIDE_COS; });
    });
  }

  /** Swap the object being scanned. The cameras stay where they are; their features, points and the film start over. */
  function setObject(name) {
    if (name === objName || !scenes[name]) return;
    begin();
    frames = []; scrub = 0; scrubOn = false;
    objName = name; scene = scenes[name];
    colors = scene.landmarks.map(function (lm) { return lm.color; });
    isoFaces = sortIso(scene.faces);
    cams.forEach(function (c) { c.noise = S.makeNoise(c.nseed, scene.landmarks.length * 2); c.key = null; });   // new landmarks: new features to observe
    denseFaces = null;
    OBJECTS.forEach(function (o) { var b = $('sfm-obj-' + o); if (b) b.setAttribute('aria-pressed', String(o === name)); });
    sceneUntil = performance.now() + CONTEXT_EVENT_MS;
    compute();
    say('scene: ' + OBJECT_NAMES[name], 'scene');
    refineTimer = setTimeout(refine, REFINE_DELAY_MS);
    announce('scanning the ' + OBJECT_NAMES[name] + '. ' + rec.points.length + ' points.');
  }

  /** Call before a change: stops any film/refine in progress and remembers the counts the log line compares against.
   *  key: set for camera moves, so a run of them (held arrow key) is logged as one change. */
  function begin(key) {
    endFilm();
    clearTimeout(refineTimer);
    if (!key || key !== baseKey) base = { m: rec.matches, p: rec.points.length };
    baseKey = key || null;
  }
  /** Call after a change: recompute now, log what it did, and queue a refine. */
  function commit(what, signal) {
    compute();
    var delta = function (n, word) { return n >= 0 ? n + ' new ' + word : '−' + -n + ' ' + word; };
    say(what + ': ' + delta(rec.matches - base.m, 'matches') + ', ' + delta(rec.points.length - base.p, 'points') + '.', signal || 'triangulate');
    refineTimer = setTimeout(refine, REFINE_DELAY_MS);
  }
  function moved(cam) {
    cam.off = cam.jit;                                         // a new photo: its pose estimate is rough again
    commit('cam ' + (cams.indexOf(cam) + 1) + ' moved');
    announce('camera ' + (cams.indexOf(cam) + 1) + ': azimuth ' + deg(cam.az) + '°, elevation ' + Math.round(cam.el / DEG) + '°');
  }
  function deg(a) { return ((Math.round(a / DEG) % 360) + 360) % 360; }

  /** Bundle adjustment, a round at a time so the points can be seen settling (cameras and film frames alike). */
  function refine() {
    endFilm();
    clearTimeout(refineTimer);
    if (views.length < 2 || !rec.points.length) return;
    var before = rec.rms, animate = shown && !reduced.matches, left = REFINE_ITERS, cur = { params: est, rec: rec };
    (function round() {
      var t0 = performance.now();
      do { cur = S.refine(cur.params, obs, 1, 0, cur.rec); left--; }   // one round at a time; unanimated, as many as fit the budget
      while (!animate && left > 0 && performance.now() - t0 < REFINE_BUDGET_MS);
      root.dataset.refineMs = (performance.now() - t0).toFixed(1);
      cur.params.forEach(function (p, i) { if (i) views[i].off = { az: p.az - views[i].az, el: p.el - views[i].el, r: p.r - R }; });
      compute();
      if (left > 0) { refineTimer = setTimeout(round, animate ? REFINE_STEP_MS : 0); return; }
      baseKey = null;
      if (before - rec.rms < REFINE_WORTH_PX) return;
      say('error ' + before.toFixed(1) + ' → ' + rec.rms.toFixed(1) + ' px.', 'refine');
      refinedMsg = CONTEXT.refined(rec.rms.toFixed(1));
      refinedUntil = performance.now() + CONTEXT_EVENT_MS;
      contextUpdate();
    })();
  }

  // ─────────────────────────────── film it ───────────────────────────────
  // A film is FILM_FRAMES views walked once round the scene. Frames are observations, not cameras: they triangulate and refine,
  // but they have no button, no number and no place in the strip except the one filmstrip thumbnail. Filming again replaces it.
  function addFrame() { frames.push(makeFrame(frames.length)); scrub = frames.length - 1; }
  function startFilm() {
    if (film) { cancelAnimationFrame(filmRaf); film = null; }
    begin();                                                   // the log line compares against the old film
    filmAz0 = cams[sel].az;
    frames = []; scrub = 0;
    film = { t0: performance.now(), az: filmAz0 };
    addFrame();
    if (reduced.matches || !shown) { endFilm(); return; }      // reduced motion: all the frames at once
    compute();
    filmRaf = requestAnimationFrame(filmTick);
  }
  function filmTick(now) {
    var sweep = Math.min(1, (now - film.t0) / FILM_MS) * (FILM_FRAMES - 1) * FILM_STEP_DEG * DEG, added = false;
    film.az = filmAz0 + sweep;
    while (frames.length < FILM_FRAMES && sweep >= frames.length * FILM_STEP_DEG * DEG - 1e-9) { addFrame(); added = true; }
    if (frames.length >= FILM_FRAMES) { endFilm(); return; }
    if (added) compute(); else draw();
    filmRaf = requestAnimationFrame(filmTick);
  }
  /** Finish a film in progress at once (also how it ends normally). */
  function endFilm() {
    if (!film) return;
    cancelAnimationFrame(filmRaf);
    while (frames.length < FILM_FRAMES) addFrame();
    film = null; scrub = 0;
    commit('filmed ' + FILM_FRAMES + ' frames', 'film');
  }
  function removeFilm() {
    if (!frames.length) return;
    var hadFocus = strip.contains(document.activeElement);
    begin();
    frames = []; scrub = 0; scrubOn = false;
    commit('film removed');
    announce('film removed. ' + cams.length + ' cameras left.');
    if (hadFocus) cams[sel].btn.focus();
  }

  // ─────────────────────────────── step record, context, announcements ───────────────────────────────
  /** Record the latest step in data attributes (data-event = pipeline step, data-event-text = what changed) for the tests: nothing is drawn. */
  function say(text, signal) { root.dataset.event = signal; root.dataset.eventText = text; }
  function announce(text) { $('sfm-live').textContent = text; }
  /** The one-sentence context line. Highest priority wins; a message stays CONTEXT_MIN_MS before the next replaces it. */
  function contextUpdate() {
    var now = performance.now(), want;
    if (views.length < 2) want = CONTEXT.one;
    else if (tooClose()) want = CONTEXT.close;
    else if (now < sceneUntil) want = CONTEXT.scene[objName];
    else if (wallUnseen()) want = CONTEXT.back;
    else if (now < refinedUntil) want = refinedMsg;
    else if (views.length >= SCAN_VIEWS) want = CONTEXT.scan;
    else if (CONTEXT.below[objName] && views.some(function (v) { return v.el < 0; })) want = CONTEXT.below[objName];
    else want = CONTEXT.teach[teachIdx];
    clearTimeout(ctxTimer);
    if (!shown) return;
    var wait = want === ctxText ? 0 : CONTEXT_MIN_MS - (now - ctxSince);
    if (want !== ctxText && wait <= 0) { ctxText = want; ctxSince = now; $('sfm-context').textContent = want; }
    var next = wait > 0 ? wait : Math.max(0, refinedUntil - now, sceneUntil - now);      // come back when the hold ends, or when the event message expires
    if (next) ctxTimer = setTimeout(contextUpdate, next + 20);
  }
  function teach() {
    clearTimeout(teachTimer);
    if (teachIdx >= CONTEXT.teach.length - 1) return;          // the last line stays as the resting hint
    teachTimer = setTimeout(function () { teachIdx++; contextUpdate(); teach(); }, TEACH_MS);
  }

  // ─────────────────────────────── drawing: scene ───────────────────────────────
  function iso(p) { return [OX + (p[0] - p[1]) * TILE / 2, OY + (p[0] + p[1]) * TILE / 4 - p[2] * TILE / 2]; }
  /** The faces an iso viewer can see (+x, +y, +z), back to front. */
  function sortIso(faces) {
    return faces.filter(function (f) { return f.n[0] + f.n[1] + f.n[2] > 0; })
      .sort(function (a, b) { return (a.c[0] + a.c[1] + a.c[2]) - (b.c[0] + b.c[1] + b.c[2]); });
  }
  var tones = {};
  /** A face's fill: the model's own hex colour, shaded by direction. */
  function tone(color, side) {
    var k = color + side, n;
    if (!tones[k]) {
      n = parseInt(color.slice(1), 16);
      tones[k] = 'rgb(' + [n >> 16, (n >> 8) & 255, n & 255].map(function (v) { return Math.round(v * SHADE[side]); }).join(',') + ')';
    }
    return tones[k];
  }
  function shade(f) { return tone(f.color, f.n[2] ? 'top' : f.n[1] ? 'left' : 'right'); }
  function poly(c, pts, fill, stroke) {
    c.beginPath();
    pts.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.stroke(); }
  }
  function line(c, a, b) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  function drawFaces(faces) {
    faces.forEach(function (f) { var col = shade(f); poly(ctx, f.quad.map(iso), col, col); });
  }
  /** A camera as a small frustum, with a stalk down to its spot on the ring. */
  function drawCam(P, label, color, fill) {
    var c = P.c, f = P.R[2], w = FRUSTUM * IW / 2 / S.CONFIG.FOCAL, h = FRUSTUM * IH / 2 / S.CONFIG.FOCAL;
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (s) {
      return iso([0, 1, 2].map(function (a) { return c[a] + f[a] * FRUSTUM + P.R[0][a] * w * s[0] + P.R[1][a] * h * s[1]; }));
    });
    var apex = iso(c);
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.line;
    var foot = iso([c[0], c[1], 0]);
    line(ctx, foot, apex);
    if (c[2] < 0) { ctx.fillStyle = C['ink-3']; ctx.beginPath(); ctx.arc(foot[0], foot[1], 1.6, 0, Math.PI * 2); ctx.fill(); }   // below the ground: a dot where the stalk meets the ring
    ctx.strokeStyle = color;
    poly(ctx, corners, fill, color);
    corners.forEach(function (p) { line(ctx, apex, p); });
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(apex[0], apex[1], 2, 0, Math.PI * 2); ctx.fill();
    if (label) { ctx.font = '9px ' + C.mono; ctx.textAlign = 'center'; ctx.fillText(label, apex[0], apex[1] + (f[0] + f[1] > 0 ? -6 : 13)); }
  }
  /** The film's path: a dot on the ring for each frame (the scrubbed one gets its frustum while the strip is hovered or focused). */
  function drawFrames(front) {
    ctx.fillStyle = C.accent;
    frames.forEach(function (f, i) {
      var c = f.pose.c;
      if ((c[0] + c[1] > 0) !== front) return;
      var p = iso([c[0], c[1], 0]);
      ctx.beginPath(); ctx.arc(p[0], p[1], i === scrub && scrubOn ? 3 : 1.6, 0, Math.PI * 2); ctx.fill();
    });
    if (front && scrubOn && frames[scrub]) drawCam(frames[scrub].pose, '', C.accent, rgba(C.accent, 0.3));
  }
  function drawCams(front) {
    drawFrames(front);
    cams.forEach(function (cam, i) {
      if ((cam.pose.c[0] + cam.pose.c[1] > 0) !== front) return;
      drawCam(cam.pose, String(i + 1), i === sel ? C.ink : C['ink-3'], i === sel ? rgba(C.accent, 0.3) : null);
    });
  }
  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function draw() {
    var i, G = GROUND, ring = [];
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);
    ctx.lineWidth = 1;
    var under = cams.some(function (c) { return c.el < 0; });   // a camera below the ground: the plate is only a display plate, so let the underside show through
    ctx.globalAlpha = under ? 0.3 : 1;
    poly(ctx, [[-G, G, 0], [G, G, 0], [G, G, -0.4], [-G, G, -0.4]].map(iso), C['tile-left'], C['tile-left']);
    poly(ctx, [[G, -G, 0], [G, G, 0], [G, G, -0.4], [G, -G, -0.4]].map(iso), C['tile-right'], C['tile-right']);
    poly(ctx, [[-G, -G, 0], [G, -G, 0], [G, G, 0], [-G, G, 0]].map(iso), C['tile-top'], C['tile-line']);
    ctx.globalAlpha = 1;
    if (under) poly(ctx, [[-G, -G, 0], [G, -G, 0], [G, G, 0], [-G, G, 0]].map(iso), null, C['ink-3']);   // outline stays crisp
    for (i = 0; i < 64; i++) ring.push(iso([R * Math.cos(i * Math.PI / 32), R * Math.sin(i * Math.PI / 32), 0]));
    ctx.setLineDash([3, 4]);
    poly(ctx, ring, null, C['ink-4']);                       // the orbit, on the ground
    ctx.setLineDash([]);

    drawCams(false);
    drawFaces(isoFaces);                                     // the real scene only: what was reconstructed lives in the other panel
    if (showRays) {                                          // rays from the selected camera and its partner to the points both see
      ctx.strokeStyle = rgba(C.accent, 0.3);
      rec.points.forEach(function (pt) {
        if (pt.views.indexOf(sel) < 0) return;
        [sel, partner].forEach(function (ci) { if (pt.views.indexOf(ci) >= 0) line(ctx, iso(rec.poses[ci].c), iso(pt.X)); });
      });
    }
    drawCams(true);
    if (film) drawCam(S.pose({ az: film.az, el: FILM_EL * DEG, r: R }), '', C.accent, rgba(C.accent, 0.3));   // the phone

    cams.forEach(function (cam, k) {                         // the real buttons ride on top of the drawn cameras
      var p = iso(cam.pose.c);
      cam.btn.style.left = p[0] + 'px'; cam.btn.style.top = p[1] + 'px';
      cam.btn.setAttribute('aria-label', 'camera ' + (k + 1) + ': azimuth ' + deg(cam.az) + '°, elevation ' + Math.round(cam.el / DEG) + '°. arrow keys move it, delete removes it.');
      cam.btn.setAttribute('aria-pressed', String(k === sel));
    });
    var sp = iso(cams[sel].pose.c);
    xBtn.hidden = cams.length < 2 || !!film || !!drag;
    xBtn.style.left = sp[0] + 'px'; xBtn.style.top = sp[1] + 'px';
    xBtn.setAttribute('aria-label', 'remove camera ' + (sel + 1));
    drawThumbs();
  }

  // ─────────────────────────────── drawing: the reconstruction ───────────────────────────────
  function setAttr(el, k, v) { v = String(v); if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
  /** Orthographic orbit view of the points / voxels (and, in compare mode, a ghost of the true scene). Rotation: azimuth about z, then elevation. */
  function drawRecon() {
    var W = SCENE_W, H = SCENE_H, ca = Math.cos(rv.az), sa = Math.sin(rv.az), ce = Math.cos(rv.el), se = Math.sin(rv.el);
    var tz = S.CONFIG.TARGET[2], rs = (Math.min(W, H) / 2 - 6) / VIEW_RADIUS;
    var v3 = function (p) {                                  // world → [screen x, screen y, depth towards the viewer]
      var x = p[0], y = p[1], z = p[2] - tz, d = x * ca + y * sa;
      return [W / 2 + (x * sa - y * ca) * rs, H / 2 + (d * se - z * ce) * rs, d * ce + z * se];
    };
    var facing = function (f) { return (f.n[0] * ca + f.n[1] * sa) * ce + f.n[2] * se > 1e-6; };
    var back2front = function (faces) {
      return faces.filter(facing).map(function (f) { return { f: f, d: v3(f.c)[2] }; })
        .sort(function (a, b) { return a.d - b.d; }).map(function (o) { return o.f; });
    };
    rctx.clearRect(0, 0, W, H);
    rctx.lineWidth = 1;
    if (mode === 'compare') {                                // the truth, faint: gaps and smear show against it
      rctx.strokeStyle = rgba(C['ink-3'], 0.4); rctx.lineWidth = 0.75;
      back2front(scene.faces).forEach(function (f) { poly(rctx, f.quad.map(v3), null, rctx.strokeStyle); });
    }
    if (mode === 'voxels') {
      if (denseFaces) back2front(denseFaces).forEach(function (f) {
        var col = tone(f.color, f.n[2] ? 'top' : (f.n[0] * sa - f.n[1] * ca) < 0 ? 'left' : 'right');
        poly(rctx, f.quad.map(v3), col, col);
      });
    } else {
      rctx.strokeStyle = C.paper; rctx.fillStyle = C.accent; rctx.lineWidth = 0.75;
      rec.points.map(function (pt) { return v3(pt.X); }).sort(function (a, b) { return a[2] - b[2]; }).forEach(function (q) {
        var t = Math.max(0, Math.min(1, (q[2] / VIEW_RADIUS + 1) / 2));
        rctx.beginPath(); rctx.arc(q[0], q[1], POINT_R_FAR + (POINT_R_NEAR - POINT_R_FAR) * t, 0, Math.PI * 2); rctx.fill(); rctx.stroke();
      });
    }
    if (!rec.points.length) {
      rctx.font = '11px ' + C.mono; rctx.textAlign = 'center'; rctx.fillStyle = C['ink-3'];
      rctx.fillText('nothing yet: needs 2+ views', W / 2, H / 2);
    }
    setAttr(rcanvas, 'data-mode', mode);
    setAttr(rcanvas, 'data-ghost', mode === 'compare' ? 1 : 0);   // the true scene is drawn only in compare mode
    setAttr(rcanvas, 'data-az', deg(rv.az));
    setAttr(rcanvas, 'data-el', Math.round(rv.el / DEG));
    setAttr(rcanvas, 'aria-label', '3D reconstruction, ' + rec.points.length + ' points, shown as ' + mode + '. Drag or use the arrow keys to rotate it.');
  }
  function rschedule() { if (!rraf) rraf = requestAnimationFrame(function () { rraf = 0; drawRecon(); }); }

  /** The slow spin runs only while it can be seen: tab shown, panel on screen, page visible and focused, motion allowed, not being dragged. */
  function spinWanted() { return shown && onScreen && !document.hidden && focused && !reduced.matches && !rdrag && performance.now() >= spinHold; }
  function updateSpin() {
    var want = spinWanted();
    if (want && !spinRaf) { spinLast = performance.now(); spinRaf = requestAnimationFrame(spinTick); }
    else if (!want && spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = 0; }
  }
  function spinTick(now) {
    rv.az += SPIN_DEG_S * DEG * Math.min(100, now - spinLast) / 1000; spinLast = now;
    drawRecon();
    spinRaf = requestAnimationFrame(spinTick);
  }
  function holdSpin() { spinHold = performance.now() + SPIN_HOLD_MS; clearTimeout(spinTimer); spinTimer = setTimeout(updateSpin, SPIN_HOLD_MS + 20); updateSpin(); }
  function turn(daz, del) {
    rv.az += daz; rv.el = Math.min(VIEW_EL_MAX * DEG, Math.max(VIEW_EL_MIN * DEG, rv.el + del));
  }
  rcanvas.addEventListener('pointerdown', function (e) {
    rdrag = { x: e.clientX, y: e.clientY };
    rcanvas.setPointerCapture(e.pointerId);
    updateSpin();
  });
  rcanvas.addEventListener('pointermove', function (e) {
    if (!rdrag) return;
    turn((e.clientX - rdrag.x) * DRAG_DEG_PX * DEG, (e.clientY - rdrag.y) * DRAG_DEG_PX * DEG);
    rdrag.x = e.clientX; rdrag.y = e.clientY;
    rschedule();
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    rcanvas.addEventListener(ev, function () { if (rdrag) { rdrag = null; holdSpin(); } });
  });
  rcanvas.addEventListener('keydown', function (e) {
    var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    turn(d[0] * KEY_STEP * DEG, d[1] * KEY_STEP * DEG);
    holdSpin(); drawRecon();
    announce('reconstruction: azimuth ' + deg(rv.az) + '°, elevation ' + Math.round(rv.el / DEG) + '°');
  });

  // ─────────────────────────────── drawing: thumbnails ───────────────────────────────
  /** Slot s's top-left. The film sits right after the selected camera and its partner, so it is always in view and the match lines stay between neighbours. */
  function filmAt() { return Math.min(slots.length, 2); }
  function slotXY(s) {
    var f = frames.length && s >= filmAt() ? FILM_W + THUMB_GAP : 0;
    return [s * (THUMB_W + THUMB_GAP) + f, 0];
  }
  function filmAria() {
    filmBtn.setAttribute('aria-valuemax', String(frames.length));
    filmBtn.setAttribute('aria-valuenow', String(scrub + 1));
    filmBtn.setAttribute('aria-valuetext', 'frame ' + (scrub + 1) + ' of ' + frames.length);
    filmBtn.setAttribute('aria-label', 'film · ' + frames.length + ' frames. left and right arrows scrub, delete removes the film.');
  }
  /** Size the strip for the cameras (the film takes two thumbnails' width): all fit if they legibly can; else they shrink to a minimum and the strip scrolls. */
  function layoutStrip() {
    var c = cams.length, f = frames.length > 0, units = c + (f ? 2 : 0), gaps = c - 1 + (f ? 1 : 0);
    THUMB_W = Math.max(THUMB_MIN_W, Math.min(THUMB_MAX_W, Math.floor((AVAIL - gaps * THUMB_GAP) / units)));
    THUMB_H = Math.round(THUMB_W * IH / IW); FILM_W = 2 * THUMB_W;
    THUMBS_W = c * THUMB_W + gaps * THUMB_GAP + (f ? FILM_W : 0);
    var k = THUMBS_W + 'x' + THUMB_H;
    if (k !== stripKey) { stripKey = k; fitCanvas(thumbs, tctx, THUMBS_W, THUMB_H); }
    filmBtn.hidden = !f; filmX.hidden = !f || !!film;
    if (f) {
      var fx = filmAt() * (THUMB_W + THUMB_GAP);
      filmBtn.style.cssText = 'left:' + fx + 'px;width:' + FILM_W + 'px;height:' + THUMB_H + 'px';
      filmX.style.left = (fx + FILM_W - 15) + 'px';
      filmAria();
    }
    if (strip.scrollWidth > strip.clientWidth + 1) strip.setAttribute('tabindex', '0'); else strip.removeAttribute('tabindex');   // a scroller must be reachable by keyboard
  }
  /** What a camera (or film frame) sees: the scene by painter's algorithm, plus its detected features. edge: { color, w, sel } or null. */
  function drawThumb(v, x, y, label, edge) {
    var c = tctx, P = v.pose, k = THUMB_W / IW, G = GROUND;
    var px = function (X) { var uv = S.project(P, X); return [x + uv[0] * k, y + uv[1] * k]; };
    c.save();
    c.beginPath(); c.rect(x, y, THUMB_W, THUMB_H); c.clip();
    c.fillStyle = C.paper; c.fillRect(x, y, THUMB_W, THUMB_H);
    c.lineWidth = 0.5;
    var plate = [[-G, -G, 0], [G, -G, 0], [G, G, 0], [-G, G, 0]].map(px), below = v.el < 0;
    if (!below) poly(c, plate, C['tile-top'], C['tile-line']);
    scene.faces.filter(function (f) { return S.dot(f.n, S.sub(P.c, f.c)) > 0; })                 // facing the camera …
      .map(function (f) { return { f: f, d: S.dist(P.c, f.c) }; })
      .sort(function (a, b) { return b.d - a.d; })                                               // … far to near
      .forEach(function (o) { var col = shade(o.f); poly(c, o.f.quad.map(px), col, col); });
    if (below) { c.globalAlpha = 0.3; poly(c, plate, C['tile-top'], null); c.globalAlpha = 1; poly(c, plate, null, C['ink-4']); }   // seen from under the plate: faint, over the model
    c.fillStyle = C.dog;
    v.obs.forEach(function (o) {
      if (o) { c.beginPath(); c.arc(x + o[0] * k, y + o[1] * k, 1.2, 0, Math.PI * 2); c.fill(); }
    });
    c.restore();
    if (edge) {
      c.strokeStyle = edge.color; c.lineWidth = edge.w;
      c.strokeRect(x + edge.w / 2, y + edge.w / 2, THUMB_W - edge.w, THUMB_H - edge.w);
    }
    if (!label) return;
    c.font = '9px ' + C.mono; c.textAlign = 'left';
    c.fillStyle = C.paper; c.fillRect(x + 2, y + 2, label.length * 6 + 3, 12);                   // number plate, so the scene never runs under it
    c.fillStyle = edge && edge.sel ? C.ink : C['ink-3']; c.fillText(label, x + 5, y + 11);
  }
  /** The film: two consecutive frames side by side (the scrubbed one and the next), perforations top and bottom, and its label. */
  function drawFilm(x) {
    var c = tctx, n = frames.length, a = scrub, b = (scrub + 1) % n, w = c.lineWidth = scrubOn ? 2 : 1;
    drawThumb(frames[a], x, 0, '', null);
    drawThumb(frames[b], x + THUMB_W, 0, '', null);
    c.fillStyle = C['ink-3'];
    for (var px = x + 3; px < x + FILM_W - 2; px += 7) { c.fillRect(px, 0, 3, 2); c.fillRect(px, THUMB_H - 2, 3, 2); }
    var text = FILM_W >= 84 ? 'film · ' + n + ' frames' : 'film · ' + n;        // a paper halo, not a plate: the frames stay visible behind it
    c.font = '8px ' + C.mono; c.textAlign = 'center'; c.lineJoin = 'round'; c.lineWidth = 3;
    c.strokeStyle = C.paper; c.strokeText(text, x + FILM_W / 2, THUMB_H - 4);
    c.fillStyle = C.ink; c.fillText(text, x + FILM_W / 2, THUMB_H - 4);
    c.strokeStyle = scrubOn ? C.accent : C['ink-3']; c.lineWidth = w;
    c.strokeRect(x + w / 2, w / 2, FILM_W - w, THUMB_H - w);
  }
  function drawThumbs() {
    layoutStrip();
    var k = THUMB_W / IW;
    tctx.clearRect(0, 0, THUMBS_W, THUMB_H);
    slots.forEach(function (ci, s) {
      var p = slotXY(s), isSel = ci === sel;
      drawThumb(cams[ci], p[0], p[1], String(ci + 1), { color: isSel ? C.ink : ci === partner ? C.accent : C.line, w: isSel ? 2 : 1, sel: isSel });
    });
    if (frames.length) drawFilm(filmAt() * (THUMB_W + THUMB_GAP));
    if (partner < 0) return;
    var a = slotXY(0), b = slotXY(1);                        // matches: the same landmark in both views
    tctx.strokeStyle = rgba(C.accent, 0.6); tctx.lineWidth = 0.75;
    var pairs = [];
    obs[sel].forEach(function (o, id) { var q = obs[partner][id]; if (o && q) pairs.push([o, q]); });
    var step = Math.max(1, pairs.length / MATCH_LINES);
    for (var i = 0; i < pairs.length; i += step) {
      var o = pairs[Math.floor(i)][0], q = pairs[Math.floor(i)][1];
      line(tctx, [a[0] + o[0] * k, a[1] + o[1] * k], [b[0] + q[0] * k, b[1] + q[1] * k]);
    }
    thumbs.dataset.matchLines = Math.ceil(pairs.length / step);   // read by tests/smoke.py
  }

  // ─────────────────────────────── input ───────────────────────────────
  var sceneEl = document.getElementById('sfm-scene'), xBtn = $('sfm-x'), strip = $('sfm-strip'), filmBtn = $('sfm-film-thumb'), filmX = $('sfm-film-x');
  function select(i) { if (i !== sel) { sel = i; compute(); } }
  function camButton(cam) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'sfm-cam';
    sceneEl.insertBefore(b, xBtn);
    b.addEventListener('focus', function () { select(cams.indexOf(cam)); });
    b.addEventListener('pointerdown', function (e) {
      var r = canvas.getBoundingClientRect(), p = iso(cam.pose.c);
      begin('move' + cams.indexOf(cam));
      sel = cams.indexOf(cam);
      drag = { cam: cam, dx: e.clientX - r.left - p[0], dy: e.clientY - r.top - p[1], moved: false };
      b.setPointerCapture(e.pointerId);
      schedule();
    });
    b.addEventListener('pointermove', function (e) {
      if (!drag || drag.cam !== cam) return;
      var r = canvas.getBoundingClientRect();
      follow(cam, e.clientX - r.left - drag.dx, e.clientY - r.top - drag.dy);
      drag.moved = true;
      schedule();
    });
    ['pointerup', 'pointercancel'].forEach(function (ev) {
      b.addEventListener(ev, function () {
        if (!drag || drag.cam !== cam) return;
        var did = drag.moved;
        drag = null;
        if (did) moved(cam); else { compute(); refineTimer = setTimeout(refine, REFINE_DELAY_MS); }
      });
    });
    b.addEventListener('keydown', function (e) {
      var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key], i = cams.indexOf(cam);
      if (d) {
        begin('move' + i);
        cam.az += d[0] * KEY_STEP * DEG; cam.el = clampEl(cam.el + d[1] * KEY_STEP * DEG);
        moved(cam);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && cams.length > 1) remove(i);
      else return;
      e.preventDefault();
    });
    return b;
  }
  /** Move a camera so it sits under the pointer: two damped Gauss–Newton steps on (azimuth, elevation) → screen position. */
  function follow(cam, tx, ty) {
    var at = function (az, el) { return iso(S.pose({ az: az, el: el, r: R }).c); }, H = 0.01, LAMBDA = 100;
    for (var n = 0; n < 2; n++) {
      var p = at(cam.az, cam.el), a = at(cam.az + H, cam.el), b = at(cam.az, cam.el + H);
      var ja = [(a[0] - p[0]) / H, (a[1] - p[1]) / H], jb = [(b[0] - p[0]) / H, (b[1] - p[1]) / H], d = [tx - p[0], ty - p[1]];
      var m00 = ja[0] * ja[0] + ja[1] * ja[1] + LAMBDA, m01 = ja[0] * jb[0] + ja[1] * jb[1], m11 = jb[0] * jb[0] + jb[1] * jb[1] + LAMBDA;
      var g0 = ja[0] * d[0] + ja[1] * d[1], g1 = jb[0] * d[0] + jb[1] * d[1], det = m00 * m11 - m01 * m01;
      cam.az += (m11 * g0 - m01 * g1) / det;
      cam.el = clampEl(cam.el + (m00 * g1 - m01 * g0) / det);
    }
  }
  function remove(i) {
    begin();
    removeCam(i);
    commit('cam ' + (i + 1) + ' removed');
    announce('camera ' + (i + 1) + ' removed. ' + cams.length + ' left.');
  }
  xBtn.addEventListener('click', function () { if (cams.length > 1) remove(sel); });
  thumbs.addEventListener('click', function (e) {
    var x = e.clientX - thumbs.getBoundingClientRect().left;
    if (film) return;
    slots.forEach(function (ci, s) { var p = slotXY(s); if (x >= p[0] && x < p[0] + THUMB_W) select(ci); });
  });

  // the filmstrip thumbnail: a slider over the frames. Hover (or drag) along it, or use the arrow keys, to scrub.
  function scrubTo(i) {
    i = Math.max(0, Math.min(frames.length - 1, i));
    if (i === scrub && scrubOn) return;
    scrub = i; scrubOn = true; filmAria();
    if (!scrubRaf) scrubRaf = requestAnimationFrame(function () { scrubRaf = 0; if (frames.length) draw(); });
  }
  function scrubOff() { if (scrubOn) { scrubOn = false; if (frames.length) draw(); } }
  filmBtn.addEventListener('pointermove', function (e) {
    var r = filmBtn.getBoundingClientRect();
    scrubTo(Math.floor((e.clientX - r.left) / r.width * frames.length));
  });
  filmBtn.addEventListener('pointerleave', function () { if (document.activeElement !== filmBtn) scrubOff(); });
  filmBtn.addEventListener('focus', function () { scrubTo(scrub); });
  filmBtn.addEventListener('blur', scrubOff);
  filmBtn.addEventListener('keydown', function (e) {
    var to = { ArrowLeft: scrub - 1, ArrowDown: scrub - 1, ArrowRight: scrub + 1, ArrowUp: scrub + 1, Home: 0, End: frames.length - 1 }[e.key];
    if (to !== undefined) scrubTo(to);
    else if (e.key === 'Delete' || e.key === 'Backspace') removeFilm();
    else return;
    e.preventDefault();
  });
  filmX.addEventListener('click', removeFilm);

  $('sfm-add').addEventListener('click', function () {
    if (cams.length >= MAX_CAMS) return;
    begin();
    addCam(widestGap(), NEW_CAM_EL * DEG);
    commit('cam ' + cams.length + ' added');
  });
  $('sfm-film').addEventListener('click', startFilm);
  $('sfm-refine').addEventListener('click', refine);
  function toggle(id, fn) {
    $(id).addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', String(on));
      fn(on);
      compute();
    });
  }
  toggle('sfm-rays', function (on) { showRays = on; });
  MODES.forEach(function (m) {                               // points · voxels · compare; voxels are densified only when asked for
    $('sfm-mode-' + m).addEventListener('click', function () {
      if (mode === m) return;
      mode = m;
      MODES.forEach(function (n) { $('sfm-mode-' + n).setAttribute('aria-pressed', String(n === m)); });
      compute();
      if (m === 'voxels') say(rec.points.length + ' points → ' + denseCount + ' voxels.', 'densify');
      announce('reconstruction shown as ' + m);
    });
  });

  OBJECTS.forEach(function (o) {                             // snack machine · temple · lucky cat
    var b = $('sfm-obj-' + o);
    if (!scenes[o]) { b.hidden = true; if (b.previousSibling) b.previousSibling.hidden = true; return; }   // also hides its " · " separator
    b.addEventListener('click', function () { setObject(o); });
  });
  if (Object.keys(scenes).length < 2) $('sfm-objs').hidden = true;

  var head0 = $('sfm-head'), helpBtn = $('sfm-help'), helpPop = $('sfm-pop');   // same pattern as the dog lab's "?"
  function helpOpen(open) { helpPop.hidden = !open; helpBtn.setAttribute('aria-expanded', String(open)); }
  helpBtn.addEventListener('click', function () { helpOpen(helpPop.hidden); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || helpPop.hidden) return;
    if (head0.contains(document.activeElement)) helpBtn.focus();
    helpOpen(false);
  });
  document.addEventListener('click', function (e) { if (!head0.contains(e.target)) helpOpen(false); });
  head0.addEventListener('focusout', function (e) { if (!head0.contains(e.relatedTarget)) helpOpen(false); });

  // ─────────────────────────────── show / hide ───────────────────────────────
  // site.js tells a showcase when its tab is hidden or shown; hidden = no timers, no frames, state kept
  root.addEventListener('showcase:hide', function () {
    endFilm();                                               // shown is still true here, so the film's own log line lands; then stop
    shown = false;
    [refineTimer, teachTimer, ctxTimer].forEach(clearTimeout);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (rraf) { cancelAnimationFrame(rraf); rraf = 0; }
    clearTimeout(spinTimer);
    updateSpin();
  });
  root.addEventListener('showcase:show', function () {
    shown = true;
    fit();
    compute();
    if (!started) {
      started = true;
      say(cams.length + ' cameras: ' + rec.matches + ' matches, ' + rec.points.length + ' points.', 'triangulate');
    }
    teach();
    updateSpin();
  });
  window.addEventListener('blur', function () { focused = false; updateSpin(); });
  window.addEventListener('focus', function () { focused = true; updateSpin(); });
  document.addEventListener('visibilitychange', updateSpin);
  reduced.addEventListener('change', updateSpin);
  if (window.IntersectionObserver) new IntersectionObserver(function (es) { onScreen = es[es.length - 1].isIntersecting; updateSpin(); }).observe(root);
  window.addEventListener('resize', function () { if (shown) { fit(); schedule(); } });   // devicePixelRatio may have changed (zoom)
  function recolor() { readColors(); if (shown) compute(); root.setAttribute('data-theme-seen', document.documentElement.dataset.theme || 'auto'); }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  window.addEventListener('themechange', recolor);

  readColors();
  fit();
  START_CAMS.forEach(function (c) { addCam(c[0] * DEG, c[1] * DEG); });
  sel = 0;
  compute();
  root.classList.add('js-ready');                            // init succeeded: hide the fallback, show the widget
})();
