/* golf-core.js — gradient descent as mini-golf. Pure maths, no DOM.
 *
 * Course:  the square [-D, D]². A hole is a loss f(x, y) = bowl around the cup − Gaussian dips, shifted so f(cup) = 0,
 *          with its analytic gradient, a tee, a par and (hole 5) gradient noise.
 * Ball:    the parameters θ = [x, y]. play() runs an optimizer from a start point until the ball is in the cup,
 *          stuck (several tiny steps), out of bounds, or out of steps.
 *
 * Browser:  window.GolfCore      Node:  require('./js/golf-core.js')
 */
(function (root) {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var CONFIG = {
    D: 2,                     // half-width of the course
    CELLS: 12,                // voxel columns per side
    LEVELS: 10,               // column heights run 0..LEVELS
    CUP_R: 0.17,              // in the cup = within this of the minimum (about half a cell) …
    SINK_SPEED: 0.5,          // … at the end of a step, or anywhere along a step no longer than this (a slow ball drops in, a fast one skips over)
    STILL: 0.01,              // a step shorter than this …
    STILL_STEPS: 3,           // … this many times running = stuck
    MAX_STEPS: 60,            // one swing gives up after this many steps
    OUT_PENALTY: 2,           // strokes for leaving the course
    BATCHES: 4,               // windy hole: minibatches per epoch; their noise sums to zero over an epoch
    BETA1: 0.9, BETA2: 0.999, EPS: 1e-8,                 // adam
    CONTOURS: [0.03, 0.1, 0.22, 0.4, 0.62, 0.88],        // contour lines, as fractions of a hole's `top`
    DEFAULTS: { opt: 'sgd', lr: 0.2, beta: 0.9 },
    HOP_MS: 170,              // on screen, a hop one cell long takes this long; time grows as √length, as a fall from a height ∝ length …
    HOP_MIN_MS: 40, HOP_MAX_MS: 450,   // … clamped to this …
    SWING_MS: 3000            // … and a whole swing is squeezed into this, so a tiny learning rate doesn't crawl
  };
  // quad: [a, b] in a·u² + b·v² around the cup. dips: [x, y, depth, width]. top: the loss drawn at full column height.
  // fake: where to start looking for the local minimum. noise: std dev added to each gradient component.
  var HOLES = [
    { name: 'bowl', tee: [-1.5, -1.1667], cup: [0.5, 0.1667], quad: [1, 2], dips: [], top: 12, par: 5 },
    { name: 'fake hole', tee: [-1.5, -0.5], cup: [0.5, 0.5], quad: [0.15, 0.15], dips: [[0.5, 0.5, 1, 0.5], [-0.74, -0.12, 0.5, 0.3]], fake: [-0.74, -0.12], top: 3, par: 6 },
    { name: 'ravine', tee: [-1.8333, -0.5], cup: [1.1667, 0.1667], quad: [0.1, 4], dips: [], top: 6, par: 8 },
    { name: 'plateau', tee: [-1.5, -1.1667], cup: [0.8333, 0.8333], quad: [0.01, 0.01], dips: [[0.8333, 0.8333, 1, 0.6]], top: 1.1, par: 10 },
    { name: 'windy', tee: [-1.5, -1.5], cup: [0.5, 0.5], quad: [1, 1.5], dips: [], top: 12, par: 9, noise: 4, seed: 5 }
  ];
  // ═══════════════════════════════════════════════════════════════════════════

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dist(p, q) { return Math.hypot(p[0] - q[0], p[1] - q[1]); }

  /** Give a hole definition its f(x, y) and grad(x, y); f is 0 at the cup. */
  function build(def) {
    var c = def.cup, a = def.quad[0], b = def.quad[1];
    function raw(x, y) {
      var u = x - c[0], v = y - c[1], s = a * u * u + b * v * v;
      def.dips.forEach(function (d) { s -= d[2] * Math.exp(-((x - d[0]) * (x - d[0]) + (y - d[1]) * (y - d[1])) / (2 * d[3] * d[3])); });
      return s;
    }
    var f0 = raw(c[0], c[1]);
    def.f = function (x, y) { return raw(x, y) - f0; };
    def.grad = function (x, y) {
      var gx = 2 * a * (x - c[0]), gy = 2 * b * (y - c[1]);
      def.dips.forEach(function (d) {
        var k = d[2] * Math.exp(-((x - d[0]) * (x - d[0]) + (y - d[1]) * (y - d[1])) / (2 * d[3] * d[3])) / (d[3] * d[3]);
        gx += k * (x - d[0]); gy += k * (y - d[1]);
      });
      return [gx, gy];
    };
    if (def.fake) {                                            // slide to the bottom of the dip: that is where the sad flag goes
      for (var p = def.fake, i = 0, g; i < 400; i++) { g = def.grad(p[0], p[1]); p = [p[0] - 0.02 * g[0], p[1] - 0.02 * g[1]]; }
      def.fake = p;
    }
    return def;
  }
  HOLES.forEach(build);

  /** One epoch of minibatch noise: n random offsets that sum to zero, as the batches of an epoch average to the full gradient. */
  function epoch(gauss, n) {
    var e = [], mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { e.push([gauss(), gauss()]); mx += e[i][0] / n; my += e[i][1] / n; }
    return e.map(function (v) { return [v[0] - mx, v[1] - my]; });
  }

  /** One swing: optimizer steps from `start` (default: the tee). set = { opt: 'sgd' | 'momentum' | 'adam', lr, beta }.
   *  Returns { path: [θ0, θ1, …], losses, status: 'cup' | 'stuck' | 'out' | 'cap', steps }. Optimizer state starts fresh each swing. */
  function play(hole, set, start) {
    var p = start || hole.tee, path = [p], losses = [hole.f(p[0], p[1])];
    var v = [0, 0], m = [0, 0], s = [0, 0], still = 0, status = 'cap', rnd = mulberry32(hole.seed || 0);
    var beta = set.opt === 'momentum' ? set.beta : 0, b1 = CONFIG.BETA1, b2 = CONFIG.BETA2;
    var gauss = function () { return (rnd() + rnd() + rnd() - 1.5) * 2; };   // close enough to a unit normal
    var B = CONFIG.BATCHES, wind = [];
    for (var t = 1; t <= CONFIG.MAX_STEPS; t++) {
      var g = hole.grad(p[0], p[1]), d;
      if (hole.noise) {
        if (t % B === 1) wind = epoch(gauss, B);
        g = [g[0] + hole.noise * wind[(t - 1) % B][0], g[1] + hole.noise * wind[(t - 1) % B][1]];
      }
      if (set.opt === 'adam') {
        d = [0, 1].map(function (i) {
          m[i] = b1 * m[i] + (1 - b1) * g[i];
          s[i] = b2 * s[i] + (1 - b2) * g[i] * g[i];
          return -set.lr * (m[i] / (1 - Math.pow(b1, t))) / (Math.sqrt(s[i] / (1 - Math.pow(b2, t))) + CONFIG.EPS);
        });
      } else {
        v = [beta * v[0] - set.lr * g[0], beta * v[1] - set.lr * g[1]];   // heavy ball; beta = 0 is plain sgd
        d = v;
      }
      var len = Math.hypot(d[0], d[1]), q = [p[0] + d[0], p[1] + d[1]];
      if (len <= CONFIG.SINK_SPEED && dist(q, hole.cup) > CONFIG.CUP_R) {   // rolling slowly past: stop at the closest point to the cup, if that is in it
        var k = Math.max(0, Math.min(1, ((hole.cup[0] - p[0]) * d[0] + (hole.cup[1] - p[1]) * d[1]) / (len * len || 1)));
        var near = [p[0] + k * d[0], p[1] + k * d[1]];
        if (dist(near, hole.cup) <= CONFIG.CUP_R) q = near;
      }
      p = q;
      path.push(p); losses.push(hole.f(p[0], p[1]));
      if (Math.abs(p[0]) > CONFIG.D || Math.abs(p[1]) > CONFIG.D) { status = 'out'; break; }
      if (dist(p, hole.cup) <= CONFIG.CUP_R) { status = 'cup'; break; }
      still = len < CONFIG.STILL ? still + 1 : 0;
      if (still >= CONFIG.STILL_STEPS) { status = 'stuck'; break; }
    }
    return { path: path, losses: losses, status: status, steps: path.length - 1 };
  }

  /** When each hop of a path starts on screen, ms: [0, t1, …, total]. See HOP_MS. */
  function pace(path) {
    var cell = 2 * CONFIG.D / CONFIG.CELLS, ms = [], sum = 0, T = [0], i;
    for (i = 1; i < path.length; i++) {
      ms.push(Math.min(CONFIG.HOP_MAX_MS, Math.max(CONFIG.HOP_MIN_MS, CONFIG.HOP_MS * Math.sqrt(dist(path[i - 1], path[i]) / cell))));
      sum += ms[i - 1];
    }
    var k = Math.min(1, CONFIG.SWING_MS / (sum || 1));
    ms.forEach(function (t) { T.push(T[T.length - 1] + t * k); });
    return T;
  }

  /** Column height (0..LEVELS) of the course at a point: the loss, quantised. */
  function height(hole, x, y) {
    return Math.round(CONFIG.LEVELS * Math.min(1, Math.max(0, hole.f(x, y) / hole.top)));
  }

  /** Contour of f at `level` by marching squares on an n × n grid: [[x0, y0, x1, y1], …], each segment inside one grid cell. */
  function contour(hole, level, n) {
    var D = CONFIG.D, w = 2 * D / n, out = [], i, j;
    var at = function (a, b, fa, fb) { var t = (level - fa) / (fb - fa); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    for (j = 0; j < n; j++) for (i = 0; i < n; i++) {
      var x = -D + i * w, y = -D + j * w, c = [[x, y], [x + w, y], [x + w, y + w], [x, y + w]], pts = [];
      var fv = c.map(function (q) { return hole.f(q[0], q[1]); });
      for (var k = 0; k < 4; k++) {
        var k2 = (k + 1) % 4;
        if ((fv[k] < level) !== (fv[k2] < level)) pts.push(at(c[k], c[k2], fv[k], fv[k2]));
      }
      for (k = 0; k + 1 < pts.length; k += 2) out.push(pts[k].concat(pts[k + 1]));
    }
    return out;
  }

  var api = { CONFIG: CONFIG, HOLES: HOLES, mulberry32: mulberry32, dist: dist, play: play, pace: pace, height: height, contour: contour };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GolfCore = api;
})(typeof window !== 'undefined' ? window : this);
