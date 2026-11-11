/* golf.js — "gradient golf": gradient descent as voxel mini-golf. The course is the loss, the ball is θ, each hop is one optimizer step.
 * The maths lives in golf-core.js (window.GolfCore); the props come from assets/models/golf-props.js (window.GOLF_PROPS, optional).
 * The course, the props and the minimap's contours are drawn once into an offscreen canvas; a frame only adds the moving parts.
 * The loop runs only while the tab can be seen: a swing at full rate, the flag / sails / wind a few times a second (not at all under reduced motion). */
(function () {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var TILE_MAX = 40, TILE_MIN = 14;   // iso px per course cell (a cell is TILE wide, TILE/2 tall on screen); the largest that fits is used
  var PAD = 4;                        // canvas padding, px
  var TOP_TILES = 2, BOTTOM_TILES = 0.9;   // room above the back corner (tall columns, the flag) and below the front corner (props, minimap), in tiles
  var LEVEL_Z = 0.28;                 // height of one column level, in cells
  var WIDE_MIN = 500, SIDE_W = 212, SIDE_GAP = 24;   // from this panel width the controls sit beside the course; keep in step with .golf[data-wide] in css/style.css
  var FIT_SLACK = 8;                  // px kept free above the footer
  var HOP_Z = 0.35, HOP_Z_MAX = 2.5;  // a hop arcs this high per cell it travels (hop time is G.pace: √length, so gravity is constant)
  var AMBIENT_MS = 80;                // flag, sails and wind redraw this often between swings
  var LR_MIN = 0.002, LR_PER_DECADE = 20, LR_STEPS = 54;   // learning-rate slider: log scale, 0.002 … 1.0
  var BETA_MIN = 0.5, BETA_MAX = 0.95, BETA_STEP = 0.05;
  var OPTS = ['sgd', 'momentum', 'adam'];
  var SHADE = { top: 1, left: 0.82, right: 0.66 };   // face brightness by direction
  var BALL = 0.36;                    // ball size, cells
  var BALL_TONES = ['#ffffff', '#dcdcd4', '#bdbdb4'];
  var ARROW_PER_G = 0.5, ARROW_MIN = 0.3, ARROW_MAX = 2.5;   // −gradient arrow: cells per unit of gradient, clamped
  var LABELS = 3, LABEL_GAP = 14;     // θ₀ θ₁ θ₂ get a label, while they are at least this many px apart
  var FLAG_Z = 1.6;                   // flagpole height, cells
  var FAKE_R = 0.3;                   // stuck this close to the fake hole = stuck in it
  var OUT_SHOW = 1.12;                // a ball that leaves is drawn this far out (× the course half-width)
  var MAP_TILES = 2.5, MAP_GRID = 24; // the top-down minimap: size in tiles, contour grid
  var WIND = 9, WIND_PX_S = 60;       // wind streaks on the windy hole
  var SAIL_RPM = 9;
  var SAIL = { j: -7, k: 5, hub: [0, 14], tower: [9, 13, 14, 18, 20, 21, 22, 23, 24] };   // windmill voxels with j <= SAIL.j, k >= SAIL.k and a colour not in `tower` are sails; they turn about `hub` (i, k)
  var CART = ['cart', 12.7, 8.2];
  // edge decor per hole: [prop, x, y] in cells; the course is 0..12, so y > 12 is the grass in front of it
  var DECOR = [
    [['tree5', 4.2, 13.3], ['stone', 7.6, 13]],
    [['tree3', 3.8, 13.2], ['tree5', 6.4, 13.4]],
    [['stone', 4, 13], ['tree3', 6.3, 13.3], ['stone', 8.6, 13.1]],
    [['tree5', 5, 13.3], ['tree3', 7.8, 13.2]],
    [['windmill', 4.6, 13.5]]
  ];
  var TEACH_MS = 7000;                // each opening line
  var CONTEXT = {
    intro: ['the ball is the model, the hill is the loss. each hop = one gradient step.',
            'too big a step overshoots. too small never gets there.'],
    hole: ['a plain bowl. only the learning rate matters here.',
           'a dip on the way traps careful steps. momentum rolls through it.',
           'a steep narrow valley. sgd zig-zags wall to wall; adam evens out the steps.',
           'nearly flat up here, so gradients vanish. adam keeps its step size anyway.',
           'every gradient is a noisy minibatch. a little momentum averages the gusts.'],
    cup: function (n, par) { return n <= par ? 'in the cup in ' + n + ' (par ' + par + '). nicely tuned.' : 'in the cup in ' + n + ', par is ' + par + '. a better setting gets there sooner.'; },
    fake: 'a local minimum: flat, so nothing pulls it out. next swing is from the tee: try momentum.',
    stuck: 'the steps got too small to matter. try a bigger learning rate, or adam.',
    cap: 'still rolling after all those steps. a bigger learning rate, momentum or adam.',
    out: 'diverged: the step was too big and it flew off. +2, back to the tee.'
  };
  // ═══════════════════════════════════════════════════════════════════════════

  var G = window.GolfCore, PROPS = window.GOLF_PROPS || {};
  var root = document.getElementById('golf'), canvas = document.getElementById('golf-canvas');
  if (!G || !canvas || !canvas.getContext) return;   // .dog-fallback stays visible until .js-ready
  var ctx = canvas.getContext('2d'), stat = document.createElement('canvas'), sctx = stat.getContext('2d');
  if (!ctx || !sctx) return;
  var $ = function (id) { return document.getElementById(id); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var N = G.CONFIG.CELLS, D = G.CONFIG.D, HOLES = G.HOLES;
  var live = root.querySelector('.dog-live'), view = root.querySelector('.golf-view'), foot = document.querySelector('.foot');
  var T = TILE_MAX, W = 0, H = 0, OX = 0, OY = 0, MS = 0, MX = 0, MY = 0;   // set by fit()

  // ─────────────────────────────── state ───────────────────────────────
  var hole = 0, HOLE = HOLES[0], set = { opt: G.CONFIG.DEFAULTS.opt, lr: G.CONFIG.DEFAULTS.lr, beta: G.CONFIG.DEFAULTS.beta };
  var S = HOLES.map(fresh);               // per hole: where the ball lies, strokes so far, whether it lies in the fake hole, the last swing and the one before (the ghost)
  var anim = null;                        // { t0, k, at }: the swing being played back, k = steps shown so far, at = G.pace start times
  var hmap = [], segs = {}, ramp = [], C = {}, tones = {};
  var mill = PROPS.windmill && splitMill(PROPS.windmill);
  var shown = !root.hidden, onScreen = true, focused = true, raf = 0, lastDraw = 0, teachTimer = 0, started = false;

  function fresh(h) { return { at: h.tee, strokes: 0, done: false, sad: false, swing: null, ghost: null }; }
  function cellOf(p) { return [(p[0] + D) * N / (2 * D), (p[1] + D) * N / (2 * D)]; }
  /** Height of the course surface under a point, in cells (0 off the course). */
  function zAt(p) {
    var c = cellOf(p), i = Math.floor(c[0]), j = Math.floor(c[1]);
    return i < 0 || j < 0 || i >= N || j >= N ? 0 : hmap[j * N + i] * LEVEL_Z;
  }

  // ─────────────────────────────── sizing + colours ───────────────────────────────
  function readColors() {
    var cs = getComputedStyle(root), stops = [];
    ['paper', 'ink', 'ink-3', 'line', 'accent', 'dog', 'gap', 'collar'].forEach(function (n) { C[n] = cs.getPropertyValue('--' + n).trim(); });
    C.mono = cs.getPropertyValue('--mono');
    for (var i = 0; i < 5; i++) stops.push(rgb(cs.getPropertyValue('--golf-' + i).trim()));
    ramp = [];
    for (var h = 0; h <= G.CONFIG.LEVELS; h++) {             // low = teal, high = pale
      var t = h / G.CONFIG.LEVELS * 4, a = Math.min(3, Math.floor(t));
      ramp.push('#' + stops[a].map(function (v, n) { return Math.round(v + (stops[a + 1][n] - v) * (t - a)).toString(16).padStart(2, '0'); }).join(''));
    }
  }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function rgba(hex, a) { return 'rgba(' + rgb(hex).join(',') + ',' + a + ')'; }
  function tone(hex, side) {
    var k = hex + side;
    if (!tones[k]) tones[k] = 'rgb(' + rgb(hex).map(function (v) { return Math.round(v * SHADE[side]); }).join(',') + ')';
    return tones[k];
  }
  function fitCanvas(c, cx) {
    var dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** The largest tile that fits the column's width and, where the page is one screen, the height left above the footer. */
  function fit() {
    var avail = root.clientWidth;
    if (!avail) return;                                      // the tab is hidden
    var wide = avail >= WIDE_MIN, rows = TOP_TILES + N / 2 + BOTTOM_TILES;
    root.toggleAttribute('data-wide', wide);
    var t = ((wide ? avail - SIDE_W - SIDE_GAP : avail) - 2 * PAD) / N;
    if (getComputedStyle(document.body).overflowY === 'hidden') {
      var c = canvas.getBoundingClientRect(), below = (wide ? view : live).getBoundingClientRect().bottom - c.bottom;
      t = Math.min(t, (foot.getBoundingClientRect().top - c.top - below - FIT_SLACK - 2 * PAD) / rows);
    }
    T = Math.max(TILE_MIN, Math.min(TILE_MAX, Math.floor(t)));
    W = N * T + 2 * PAD; H = Math.round(rows * T) + 2 * PAD;
    OX = W / 2; OY = PAD + TOP_TILES * T;
    MS = Math.round(MAP_TILES * T); MX = W - PAD - MS; MY = H - PAD - MS;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    fitCanvas(canvas, ctx); fitCanvas(stat, sctx);
  }

  // ─────────────────────────────── drawing: the parts that don't move ───────────────────────────────
  function iso(x, y, z) { return [OX + (x - y) * T / 2, OY + (x + y) * T / 4 - z * T / 2]; }
  function mapPt(p) { return [MX + (p[0] + D) / (2 * D) * MS, MY + (p[1] + D) / (2 * D) * MS]; }
  function poly(c, pts, fill, stroke) {
    c.beginPath();
    pts.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.stroke(); }
  }
  function line(c, a, b) { c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  function dot(c, p, r) { c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.fill(); }
  /** An axis-aligned box seen from the iso corner: its +y, +x and top faces. x, y, z = the low corner; cols = [top, left, right]. */
  function box(c, x, y, z, w, d, h, cols, edge) {
    var x1 = x + w, y1 = y + d, z1 = z + h;
    poly(c, [iso(x, y1, z1), iso(x1, y1, z1), iso(x1, y1, z), iso(x, y1, z)], cols[1], edge || cols[1]);
    poly(c, [iso(x1, y, z1), iso(x1, y1, z1), iso(x1, y1, z), iso(x1, y, z)], cols[2], edge || cols[2]);
    poly(c, [iso(x, y, z1), iso(x1, y, z1), iso(x1, y1, z1), iso(x, y1, z1)], cols[0], edge || cols[1]);
  }
  /** Prop voxels [i, j, k, colour], back to front, standing at (x, y) on the ground. */
  function voxels(c, prop, vox, x, y) {
    var u = prop.unit;
    c.lineWidth = 0.5;
    vox.slice().sort(function (a, b) { return a[0] + a[1] + a[2] - b[0] - b[1] - b[2]; }).forEach(function (v) {
      var hex = prop.palette[v[3]];
      box(c, x + (v[0] - 0.5) * u, y + (v[1] - 0.5) * u, v[2] * u, u, u, u, [hex, tone(hex, 'left'), tone(hex, 'right')]);
    });
  }
  function mirror(vox) { return vox.map(function (v) { return [v[0], -v[1], v[2], v[3]]; }); }
  /** The windmill, mirrored so its sails face the viewer, split into the part that stands still and the sails. */
  function splitMill(prop) {
    var out = { body: [], sails: [] };
    prop.vox.forEach(function (v) {
      (v[1] <= SAIL.j && v[2] >= SAIL.k && SAIL.tower.indexOf(v[3]) < 0 ? out.sails : out.body).push(v);
    });
    return { body: mirror(out.body), sails: mirror(out.sails) };
  }
  /** One course column (i, j) with its contour lines on top. */
  function column(c, i, j) {
    var k = j * N + i, hex = ramp[hmap[k]], z = hmap[k] * LEVEL_Z;
    c.lineWidth = 1;
    box(c, i, j, 0, 1, 1, z, [hex, tone(hex, 'left'), tone(hex, 'right')]);
    c.strokeStyle = rgba(C.ink, 0.35);
    (segs[k] || []).forEach(function (s) { line(c, iso(s[0][0], s[0][1], z), iso(s[1][0], s[1][1], z)); });
  }
  function renderStatic() {
    var c = sctx, i, j, d, top = HOLE.top;
    segs = {};
    c.clearRect(0, 0, W, H);
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) hmap[j * N + i] = G.height(HOLE, -D + (i + 0.5) * 2 * D / N, -D + (j + 0.5) * 2 * D / N);
    G.CONFIG.CONTOURS.forEach(function (f) {                 // contour segments, filed under the column they cross
      G.contour(HOLE, f * top, N).forEach(function (s) {
        var a = cellOf(s), b = cellOf(s.slice(2)), k = Math.floor((a[1] + b[1]) / 2) * N + Math.floor((a[0] + b[0]) / 2);
        (segs[k] = segs[k] || []).push([a, b]);
      });
    });
    for (d = 0; d <= 2 * N - 2; d++) for (i = Math.max(0, d - N + 1); i <= Math.min(d, N - 1); i++) column(c, i, d - i);   // back to front
    [[HOLE.cup, C.gap, 0.3], [HOLE.fake, C['ink-3'], 0.22]].forEach(function (h) {   // the cup, and the fake hole's dimple
      if (!h[0]) return;
      var q = cellOf(h[0]), p = iso(q[0], q[1], zAt(h[0]));
      c.fillStyle = h[1];
      c.beginPath(); c.ellipse(p[0], p[1], T * h[2], T * h[2] / 2, 0, 0, Math.PI * 2); c.fill();
    });
    DECOR[hole].concat([CART]).sort(function (a, b) { return a[1] + a[2] - b[1] - b[2]; }).forEach(function (p) {
      var prop = PROPS[p[0]];
      if (prop) voxels(c, prop, p[0] === 'windmill' ? mill.body : prop.vox, p[1], p[2]);
    });
    c.fillStyle = C.paper; c.fillRect(MX, MY, MS, MS);       // minimap: the same loss from above
    c.lineWidth = 0.75; c.strokeStyle = C['ink-3'];
    G.CONFIG.CONTOURS.forEach(function (f) {
      G.contour(HOLE, f * top, MAP_GRID).forEach(function (s) { line(c, mapPt(s), mapPt(s.slice(2))); });
    });
    if (HOLE.fake) { c.fillStyle = C['ink-3']; dot(c, mapPt(HOLE.fake), 2); }
    c.fillStyle = C.accent; dot(c, mapPt(HOLE.cup), 3);
    c.strokeStyle = C.line; c.lineWidth = 1; c.strokeRect(MX + 0.5, MY + 0.5, MS - 1, MS - 1);
  }

  // ─────────────────────────────── drawing: the parts that move ───────────────────────────────
  function at3(p, z) { var c = cellOf(p); return iso(c[0], c[1], z); }
  /** A flag on a pole: flying (the cup's waves a little) or drooping. */
  function flag(p, color, droop, now) {
    var z = zAt(p), a = at3(p, z), b = at3(p, z + FLAG_Z), w = T * 0.5, h = T * 0.3;
    var wave = droop || reduced.matches ? 0 : Math.sin(now / 280) * T * 0.06;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
    line(ctx, a, b);
    poly(ctx, droop ? [b, [b[0] + w * 0.3, b[1] + h * 1.7], [b[0], b[1] + h * 1.3]] : [b, [b[0] + w, b[1] + h / 2 + wave], [b[0], b[1] + h]], color);
  }
  function sails(now) {
    var a = reduced.matches ? 0 : now / 60000 * SAIL_RPM * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a), spot = DECOR[hole][0];
    voxels(ctx, PROPS.windmill, mill.sails.map(function (v) {
      var di = v[0] - SAIL.hub[0], dk = v[2] - SAIL.hub[1];
      return [SAIL.hub[0] + di * ca - dk * sa, v[1], SAIL.hub[1] + di * sa + dk * ca, v[3]];
    }), spot[1], spot[2]);
  }
  /** Gusts: short streaks drifting across the sky of the windy hole. */
  function wind(now) {
    var rnd = G.mulberry32(HOLE.seed), t = reduced.matches ? 0 : now / 1000;
    ctx.strokeStyle = rgba(C['ink-3'], 0.55); ctx.lineWidth = 1;
    for (var i = 0; i < WIND; i++) {
      var x = (rnd() * W + t * WIND_PX_S * (0.6 + rnd())) % (W + 30) - 15, y = PAD + rnd() * H * 0.5, len = 8 + rnd() * 10;
      line(ctx, [x, y], [x + len, y]);
    }
  }
  /** A path of steps: a line through n + 1 screen points, and a dot on each. */
  function trail(P, n, color, dash, r) {
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (var i = 0; i <= n; i++) { if (i) ctx.lineTo(P[i][0], P[i][1]); else ctx.moveTo(P[i][0], P[i][1]); }
    ctx.stroke();
    ctx.setLineDash([]);
    for (i = 0; i <= n; i++) dot(ctx, P[i], r);
  }
  function surface(sw) { return sw.pts.map(function (p, i) { return at3(p, sw.zs[i] + 0.06); }); }
  /** −gradient at p: which way is downhill, and how steep. */
  function arrow(p) {
    var g = HOLE.grad(p[0], p[1]), m = Math.hypot(g[0], g[1]);
    if (m < 1e-6) return;
    var len = Math.max(ARROW_MIN, Math.min(ARROW_MAX, m * ARROW_PER_G)), c = cellOf(p), z = zAt(p) + 0.1;
    var a = iso(c[0], c[1], z), b = iso(c[0] - g[0] / m * len, c[1] - g[1] / m * len, z);
    var ux = (b[0] - a[0]), uy = (b[1] - a[1]), l = Math.hypot(ux, uy) || 1, hx = ux / l * 6, hy = uy / l * 6;
    var head = [b, [b[0] - hx - hy * 0.6, b[1] - hy + hx * 0.6], [b[0] - hx + hy * 0.6, b[1] - hy - hx * 0.6]];
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.paper; ctx.lineWidth = 4; line(ctx, a, b); poly(ctx, head, null, C.paper);   // ink on a paper halo: green vanished on the low green columns
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; line(ctx, a, b); poly(ctx, head, C.ink);
  }
  function draw(now) {
    var s = S[hole], sw = s.swing, n = sw ? sw.pts.length - 1 : 0, k = anim ? anim.k : n;
    var u = anim && k < n ? Math.max(0, Math.min(1, (now - anim.t0 - anim.at[k]) / (anim.at[k + 1] - anim.at[k]))) : 0;
    var p = s.at, z = zAt(p), P, i, d;
    lastDraw = now;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(stat, 0, 0, W, H);
    if (HOLE.noise) wind(now);
    if (mill && DECOR[hole][0][0] === 'windmill') sails(now);
    if (s.ghost) trail(surface(s.ghost), s.ghost.pts.length - 1, rgba(C['ink-3'], 0.7), [1, 3], 1.2);
    if (sw) {
      P = surface(sw);
      trail(P, k, C.dog, [3, 3], 2.2);
      ctx.font = '9px ' + C.mono; ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = C.paper;
      for (i = 0; i < LABELS && i <= k; i++) {
        if (i && Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) < LABEL_GAP) break;   // tiny steps: the labels would pile up
        var label = 'θ' + String.fromCharCode(0x2080 + i);
        ctx.strokeText(label, P[i][0] + 5, P[i][1] - 4); ctx.fillStyle = C.ink; ctx.fillText(label, P[i][0] + 5, P[i][1] - 4);
      }
    }
    if (HOLE.fake) flag(HOLE.fake, C['ink-3'], s.sad, now);
    flag(HOLE.cup, C.collar, false, now);
    if (anim) {
      p = [sw.pts[k][0] + (sw.pts[k + (u ? 1 : 0)][0] - sw.pts[k][0]) * u, sw.pts[k][1] + (sw.pts[k + (u ? 1 : 0)][1] - sw.pts[k][1]) * u];
      var arc = Math.min(HOP_Z_MAX, HOP_Z * G.dist(sw.pts[k], sw.pts[k + (u ? 1 : 0)]) * N / (2 * D));
      z = sw.zs[k] + (sw.zs[k + (u ? 1 : 0)] - sw.zs[k]) * u + arc * 4 * u * (1 - u);
    }
    if (!s.done) {
      arrow(anim ? sw.pts[k] : p);
      var q = cellOf(p), bi = Math.floor(q[0]), bj = Math.floor(q[1]);
      ctx.lineWidth = 0.75;
      box(ctx, q[0] - BALL / 2, q[1] - BALL / 2, z, BALL, BALL, BALL, BALL_TONES, rgba(C.ink, 0.6));
      var bl = iso(q[0] - BALL / 2, q[1] + BALL / 2, z)[0], br = iso(q[0] + BALL / 2, q[1] - BALL / 2, z)[0];
      var bt = iso(q[0] - BALL / 2, q[1] - BALL / 2, z + BALL)[1], bb = iso(q[0] + BALL / 2, q[1] + BALL / 2, z)[1];
      ctx.save();                                            // columns in front of the ball and taller than it hide it: draw them again,
      ctx.beginPath(); ctx.rect(bl - 1, bt - 1, br - bl + 2, bb - bt + 2); ctx.clip();   // only over the ball, or they cover props and flags too
      for (d = bi + bj + 1; d <= bi + bj + 8; d++) {
        for (i = Math.max(0, bi - 1, d - N + 1); i <= Math.min(N - 1, d - bj + 1, d); i++) if (hmap[(d - i) * N + i] * LEVEL_Z > z) column(ctx, i, d - i);
      }
      ctx.restore();
    }
    ctx.save();                                              // minimap: the classic top-down figure, same path
    ctx.beginPath(); ctx.rect(MX + 1, MY + 1, MS - 2, MS - 2); ctx.clip();
    if (s.ghost) trail(s.ghost.pts.map(mapPt), s.ghost.pts.length - 1, rgba(C['ink-3'], 0.7), [1, 3], 0.8);
    if (sw) trail(sw.pts.map(mapPt), k, C.dog, [], 1.3);
    if (!s.done) { ctx.fillStyle = BALL_TONES[0]; ctx.strokeStyle = C.ink; ctx.lineWidth = 1; dot(ctx, mapPt(p), 2.5); ctx.stroke(); }
    ctx.restore();
  }
  function redraw() { if (shown) draw(performance.now()); }

  // ─────────────────────────────── the game ───────────────────────────────
  function say(text) { clearTimeout(teachTimer); $('golf-context').textContent = text; }
  /** The points a swing is drawn through: its path, with a ball that left the course stopped just outside it. */
  function shownPath(res) {
    var pts = res.path.slice(), n = pts.length - 1, a = pts[n - 1], b = pts[n], lim = D * OUT_SHOW, t = 1;
    if (res.status !== 'out') return pts;
    [0, 1].forEach(function (i) { if (Math.abs(b[i]) > lim) t = Math.min(t, ((b[i] > 0 ? lim : -lim) - a[i]) / (b[i] - a[i])); });
    pts[n] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return pts;
  }
  function swing() {
    var s = S[hole], res = G.play(HOLE, set, s.sad ? HOLE.tee : s.at), pts = shownPath(res);   // no gradient in the fake hole, so no optimizer leaves it: start over
    s.ghost = s.swing; s.sad = false;
    s.swing = { res: res, pts: pts, zs: pts.map(zAt) };
    anim = { t0: performance.now(), k: 0, at: G.pace(pts) };
    delete root.dataset.status;
    say(CONTEXT.hole[hole]);                                 // not the last swing's result while this one flies
    if (reduced.matches) finish(); else { showStats(); wake(); }
  }
  /** One frame of a swing: show the steps taken so far; end it after the last. */
  function advance(now) {
    var res = S[hole].swing.res, k = anim.k;
    while (k < res.steps && now - anim.t0 >= anim.at[k + 1]) k++;
    if (k === anim.k) return;
    anim.k = k;
    if (k >= res.steps) { finish(); return; }
    showStats();
  }
  /** The swing is over (or skipped): score it, and say what happened. */
  function finish() {
    var s = S[hole], res = s.swing.res, st = res.status;
    anim = null;
    s.strokes += res.steps + (st === 'out' ? G.CONFIG.OUT_PENALTY : 0);
    s.at = st === 'out' ? HOLE.tee : res.path[res.steps];
    s.done = st === 'cup';
    s.sad = st === 'stuck' && !!HOLE.fake && G.dist(s.at, HOLE.fake) < FAKE_R;
    say(s.done ? CONTEXT.cup(s.strokes, HOLE.par) : s.sad ? CONTEXT.fake : CONTEXT[st]);
    root.dataset.status = st;
    showStats();
    redraw();
  }
  function setHole(i) {
    if (anim) finish();
    hole = i; HOLE = HOLES[i];
    delete root.dataset.status;
    renderStatic();
    say(CONTEXT.hole[i]);
    showStats();
    redraw();
  }
  function showStats() {
    var s = S[hole], k = anim ? anim.k : 0, total = 0, last = hole === HOLES.length - 1;
    S.forEach(function (h) { total += h.strokes; });
    $('golf-loss0').textContent = HOLE.f(HOLE.tee[0], HOLE.tee[1]).toFixed(2);
    $('golf-loss').textContent = (anim ? s.swing.res.losses[k] : HOLE.f(s.at[0], s.at[1])).toFixed(2);
    $('golf-steps').textContent = s.strokes + k;
    $('golf-par').textContent = HOLE.par;
    $('golf-line').textContent = 'hole ' + (hole + 1) + ' · ' + (s.strokes + k) + ' steps (par ' + HOLE.par + ') · total ' + (total + k);
    S.forEach(function (h, i) { $('golf-you-' + i).textContent = h.strokes + (i === hole ? k : 0) || '–'; });
    $('golf-you-total').textContent = total + k;
    HOLES.forEach(function (h, i) { $('golf-hole-' + i).setAttribute('aria-pressed', String(i === hole)); });
    $('golf-swing').textContent = anim ? 'skip' : s.done ? 'swing again' : 'swing';
    $('golf-next').hidden = anim || !s.done || last;
    $('golf-reset').hidden = !$('golf-next').hidden;         // "swing again" already resets; two buttons fit beside the course
    root.dataset.hole = hole + 1;
    root.dataset.steps = s.strokes + k;
  }
  function showSettings() {
    OPTS.forEach(function (o) { $('golf-opt-' + o).setAttribute('aria-pressed', String(o === set.opt)); });
    $('golf-lr-val').textContent = set.lr.toPrecision(2);
    $('golf-lr').setAttribute('aria-valuetext', set.lr.toPrecision(2));
    $('golf-beta').disabled = set.opt !== 'momentum';
    $('golf-beta-val').textContent = set.opt === 'momentum' ? set.beta.toFixed(2) : set.opt === 'adam' ? 'β₁ ' + G.CONFIG.BETA1 : 'off';
  }

  // ─────────────────────────────── controls ───────────────────────────────
  var holesEl = $('golf-holes'), card = $('golf-card'), lr = $('golf-lr'), beta = $('golf-beta');
  HOLES.forEach(function (h, i) {                            // 1 bowl · 2 fake hole · …
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'golf-hole-' + i; b.textContent = (i + 1) + ' ' + h.name;
    b.addEventListener('click', function () { setHole(i); });
    if (i) holesEl.appendChild(document.createElement('span')).textContent = ' · ';
    holesEl.appendChild(b);
  });
  [['hole', function (h, i) { return i + 1; }, 'total'],     // the full card, shown when the panel is wide
   ['par', function (h) { return h.par; }, HOLES.reduce(function (n, h) { return n + h.par; }, 0)],
   ['you', function () { return '–'; }, 0]].forEach(function (row) {
    var tr = card.insertRow(), cell = function (text, id) {
      var el = tr.appendChild(document.createElement(row[0] === 'hole' || !tr.cells.length ? 'th' : 'td'));
      el.textContent = text;
      if (row[0] === 'you' && id !== undefined) el.id = 'golf-you-' + id;
    };
    cell(row[0]);
    HOLES.forEach(function (h, i) { cell(row[1](h, i), i); });
    cell(row[2], 'total');
  });
  OPTS.forEach(function (o) {
    $('golf-opt-' + o).addEventListener('click', function () { set.opt = o; showSettings(); });
  });
  lr.max = LR_STEPS; lr.value = Math.round(Math.log10(set.lr / LR_MIN) * LR_PER_DECADE);
  lr.addEventListener('input', function () { set.lr = LR_MIN * Math.pow(10, lr.value / LR_PER_DECADE); showSettings(); });
  beta.min = BETA_MIN; beta.max = BETA_MAX; beta.step = BETA_STEP; beta.value = set.beta;
  beta.addEventListener('input', function () { set.beta = +beta.value; showSettings(); });
  $('golf-swing').addEventListener('click', function () {
    if (anim) finish();
    else { if (S[hole].done) S[hole] = fresh(HOLE); swing(); }   // after the cup: a fresh try from the tee with the new settings
  });
  $('golf-next').addEventListener('click', function () { setHole(hole + 1); $('golf-swing').focus(); });   // focus would be lost on the now-hidden button
  $('golf-reset').addEventListener('click', function () {
    anim = null;
    S[hole] = fresh(HOLE);
    setHole(hole);
  });

  var head0 = $('golf-head'), helpBtn = $('golf-help'), helpPop = $('golf-pop');   // same pattern as the dog lab's "?"
  function helpOpen(open) { helpPop.hidden = !open; helpBtn.setAttribute('aria-expanded', String(open)); }
  helpBtn.addEventListener('click', function () { helpOpen(helpPop.hidden); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || helpPop.hidden) return;
    if (head0.contains(document.activeElement)) helpBtn.focus();
    helpOpen(false);
  });
  document.addEventListener('click', function (e) { if (!head0.contains(e.target)) helpOpen(false); });
  head0.addEventListener('focusout', function (e) { if (!head0.contains(e.relatedTarget)) helpOpen(false); });

  // ─────────────────────────────── loop, show / hide ───────────────────────────────
  function running() { return shown && onScreen && focused && !document.hidden; }
  function frame(now) {
    raf = 0;
    if (anim) advance(now);
    if (anim || now - lastDraw >= AMBIENT_MS) draw(now);
    if (running() && (anim || !reduced.matches)) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && running()) raf = requestAnimationFrame(frame); }
  function refit() { if (shown) { fit(); renderStatic(); redraw(); } }

  // site.js tells a showcase when its tab is hidden or shown; hidden = no frames, the round is kept
  root.addEventListener('showcase:hide', function () {
    if (anim) finish();
    shown = false;
    clearTimeout(teachTimer);
  });
  root.addEventListener('showcase:show', function () {
    shown = true;
    refit();
    if (!started) {
      started = true;
      teachTimer = setTimeout(function () {
        say(CONTEXT.intro[1]);
        teachTimer = setTimeout(function () { say(CONTEXT.hole[hole]); }, TEACH_MS);
      }, TEACH_MS);
    }
    wake();
  });
  window.addEventListener('blur', function () { focused = false; });
  window.addEventListener('focus', function () { focused = true; wake(); });
  document.addEventListener('visibilitychange', wake);
  reduced.addEventListener('change', wake);
  if (window.IntersectionObserver) new IntersectionObserver(function (es) { onScreen = es[es.length - 1].isIntersecting; wake(); }).observe(root);
  window.addEventListener('resize', refit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);   // late fonts re-wrap the lines around the course
  function recolor() { readColors(); refit(); root.setAttribute('data-theme-seen', document.documentElement.dataset.theme || 'auto'); }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  window.addEventListener('themechange', recolor);

  readColors();
  $('golf-context').textContent = CONTEXT.intro[0];
  showSettings();
  showStats();
  root.classList.add('js-ready');                            // init succeeded: hide the fallback, show the widget
  refit();
})();
