/* sfm-core.js — structure from motion on a voxel model. Pure maths, no DOM.
 *
 * Scene:    a voxel model from buildModel() (the temple, the lucky cat), centred on the origin (z up) with surface landmarks.
 *           A scene = { vox, unit, dense, faces, landmarks, min, max }.
 * Cameras:  pinhole, on an orbit around the scene, always looking at TARGET. params = { az, el, r } in radians.
 * Pipeline: observe (project + occlusion + pixel noise) → triangulate (least-squares ray midpoint)
 *           → refine (alternating bundle adjustment: resect each camera, re-triangulate) → densify (voxel grid).
 * Simplification: matching is by landmark identity. Everything after that is computed from the noisy 2D points.
 *
 * Browser:  window.SfmCore      Node:  require('./js/sfm-core.js')
 */
(function (root) {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var CONFIG = {
    IMG_W: 100, IMG_H: 66,    // camera image, px (thumbnails are drawn from this)
    FOCAL: 62,                // px (about 78° across: the whole model fits from the orbit)
    RADIUS: 10,               // orbit radius, voxels
    TARGET: [0, 0, 2.5],      // every camera looks here
    NOISE_PX: 0.5,            // std dev of the feature detector's pixel noise
    SEED: 7,                  // landmark placement
    RAY_STEP: 0.1,            // occlusion ray-march step, voxels
    VOLUME: 6,                // densify ignores points further than this from the z axis (or above 9)
    DILATE_MIN: 3,            // an empty cell with this many filled neighbours (of 6) gets filled
    PLAIN_PROB: 0.3           // buildModel: chance a face of plain (white, texture-less) colour carries a landmark; coloured faces always do
  };
  // ═══════════════════════════════════════════════════════════════════════════

  var DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

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
  /** n unit gaussians from a seed (Box–Muller). Two per landmark make a camera's pixel noise. */
  function makeNoise(seed, n) {
    var rnd = mulberry32(seed), out = [];
    for (var i = 0; i < n; i++) out.push(Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()));
    return out;
  }

  // ─────────────────────────────── vectors ───────────────────────────────
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function unit(a) { var n = Math.sqrt(dot(a, a)) || 1; return [a[0] / n, a[1] / n, a[2] / n]; }
  function dist(a, b) { var d = sub(a, b); return Math.sqrt(dot(d, d)); }
  /** Solve the 3x3 system A x = b by Cramer's rule; null when A is (nearly) singular. */
  function solve3(A, b) {
    var c0 = cross(A[1], A[2]), det = dot(A[0], c0);
    if (Math.abs(det) < 1e-12) return null;
    var c1 = cross(A[2], A[0]), c2 = cross(A[0], A[1]);
    return [(c0[0] * b[0] + c1[0] * b[1] + c2[0] * b[2]) / det,
            (c0[1] * b[0] + c1[1] * b[1] + c2[1] * b[2]) / det,
            (c0[2] * b[0] + c1[2] * b[1] + c2[2] * b[2]) / det];
  }

  // ─────────────────────────────── the model ───────────────────────────────
  function key(i, j, k) { return i + ',' + j + ',' + k; }
  /** Exposed faces of a voxel map { 'i,j,k': colour }: [{ quad: 4 corners, n, c: centre, color }], in world units
   *  (a voxel is `unit` wide, default 1). Undersides at z=0 are skipped. */
  function facesOf(vox, unit) {
    var faces = [], u = unit || 1;
    Object.keys(vox).forEach(function (kk) {
      var p = kk.split(',').map(Number);
      DIRS.forEach(function (n) {
        if (vox[key(p[0] + n[0], p[1] + n[1], p[2] + n[2])] || (n[2] < 0 && p[2] === 0)) return;
        var a = n[0] ? 0 : n[1] ? 1 : 2, b = (a + 1) % 3, c = (a + 2) % 3, quad = [];
        [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(function (uv) {
          var q = p.slice();
          q[a] += n[a] > 0 ? 1 : 0; q[b] += uv[0]; q[c] += uv[1];
          quad.push([q[0] * u, q[1] * u, q[2] * u]);
        });
        var ctr = [(p[0] + 0.5 + n[0] / 2) * u, (p[1] + 0.5 + n[1] / 2) * u, (p[2] + 0.5 + n[2] / 2) * u];
        faces.push({ quad: quad, n: n, c: ctr, color: vox[kk] });
      });
    });
    return faces;
  }
  /** Plain = pale and nearly grey (white fur, say): nothing a feature detector would lock on to. */
  function isPlain(hex) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return Math.min(r, g, b) >= 0xb0 && Math.max(r, g, b) - Math.min(r, g, b) <= 0x30;
  }
  /** Any voxel model: { unit, dense, palette: ['#rrggbb'], vox: [[i, j, k, palette index]] } (i, j centred on 0, k up from the ground).
   *  Landmarks sit on exposed faces: always on coloured ones (eyes, collar), with PLAIN_PROB on plain ones, so smooth white areas are thin on features. */
  function buildModel(model) {
    var u = model.unit, vox = {}, i, rnd = mulberry32(CONFIG.SEED), landmarks = [], min = [Infinity, Infinity, 0], max = [-Infinity, -Infinity, -Infinity];
    model.vox.forEach(function (v) {
      vox[key(v[0], v[1], v[2])] = model.palette[v[3]];
      for (i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i] * u); max[i] = Math.max(max[i], (v[i] + 1) * u); }
    });
    var faces = facesOf(vox, u);
    faces.forEach(function (f) {
      var plain = isPlain(f.color);
      if (plain && rnd() > CONFIG.PLAIN_PROB) return;
      var p = f.c.slice();
      for (var a = 0; a < 3; a++) if (!f.n[a]) p[a] += (rnd() - 0.5) * 0.6 * u;
      landmarks.push({ p: p, n: f.n, color: f.color });
    });
    return { vox: vox, unit: u, dense: model.dense || u, faces: faces, landmarks: landmarks, min: min, max: max };
  }
  function solidAt(scene, p) { var u = scene.unit || 1; return !!scene.vox[key(Math.floor(p[0] / u), Math.floor(p[1] / u), Math.floor(p[2] / u))]; }

  // ─────────────────────────────── cameras ───────────────────────────────
  /** Camera pose from orbit params: centre c and rotation rows R = [right, down, forward]. */
  function pose(p) {
    var T = CONFIG.TARGET, ce = Math.cos(p.el);
    var c = [T[0] + p.r * ce * Math.cos(p.az), T[1] + p.r * ce * Math.sin(p.az), T[2] + p.r * Math.sin(p.el)];
    var f = unit(sub(T, c)), right = unit(cross(f, [0, 0, 1]));
    return { c: c, R: [right, cross(f, right), f] };
  }
  /** World point → [u, v, depth] in pixels; null behind the camera. */
  function project(P, X) {
    var d = sub(X, P.c), z = dot(P.R[2], d);
    if (z <= 1e-6) return null;
    return [CONFIG.IMG_W / 2 + CONFIG.FOCAL * dot(P.R[0], d) / z, CONFIG.IMG_H / 2 + CONFIG.FOCAL * dot(P.R[1], d) / z, z];
  }
  /** Pixel → unit ray direction in the world. */
  function ray(P, u, v) {
    var a = (u - CONFIG.IMG_W / 2) / CONFIG.FOCAL, b = (v - CONFIG.IMG_H / 2) / CONFIG.FOCAL, R = P.R;
    return unit([R[0][0] * a + R[1][0] * b + R[2][0], R[0][1] * a + R[1][1] * b + R[2][1], R[0][2] * a + R[1][2] * b + R[2][2]]);
  }
  /** Can the camera see this landmark? Marches from just off the surface towards the camera through the voxels. */
  function visible(scene, P, lm) {
    var s = [lm.p[0] + lm.n[0] * 0.05, lm.p[1] + lm.n[1] * 0.05, lm.p[2] + lm.n[2] * 0.05];
    var d = unit(sub(P.c, s)), a;
    for (var t = 0; ; t += CONFIG.RAY_STEP) {
      var q = [s[0] + d[0] * t, s[1] + d[1] * t, s[2] + d[2] * t];
      for (a = 0; a < 3; a++) if (q[a] < scene.min[a] - 0.1 || q[a] > scene.max[a] + 0.1) return true;   // clear of the scene's box: nothing else to hit
      if (solidAt(scene, q)) return false;
    }
  }
  /** One camera's detected features: per landmark, [u, v] (with noise) or null if hidden or out of frame. */
  function observe(scene, P, noise) {
    return scene.landmarks.map(function (lm, i) {
      var uv = project(P, lm.p);
      if (!uv || uv[0] < 0 || uv[0] > CONFIG.IMG_W || uv[1] < 0 || uv[1] > CONFIG.IMG_H || !visible(scene, P, lm)) return null;
      var s = noise ? CONFIG.NOISE_PX : 0;
      return [uv[0] + (s && s * noise[2 * i]), uv[1] + (s && s * noise[2 * i + 1])];
    });
  }

  // ─────────────────────────────── triangulate ───────────────────────────────
  /** The point closest (least squares) to every ray { c, d }: solve Σ(I − ddᵀ) X = Σ(I − ddᵀ) c. Null if the rays are parallel. */
  function triangulate(rays) {
    var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    rays.forEach(function (r) {
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
        var m = (i === j ? 1 : 0) - r.d[i] * r.d[j];
        A[i][j] += m; b[i] += m * r.c[j];
      }
    });
    return solve3(A, b);
  }
  /** RMS pixel distance between where the points project and where their features were detected. */
  function reprojRms(poses, obs, points) {
    var sum = 0, n = 0;
    points.forEach(function (pt) {
      pt.views.forEach(function (ci) {
        var uv = project(poses[ci], pt.X), o = obs[ci][pt.id];
        if (!uv) return;
        sum += (uv[0] - o[0]) * (uv[0] - o[0]) + (uv[1] - o[1]) * (uv[1] - o[1]); n++;
      });
    });
    return n ? Math.sqrt(sum / n) : 0;
  }
  /** Triangulate every landmark seen by 2+ cameras. params: [{az, el, r}], obs: observe() per camera.
   *  Returns { poses, points: [{ id, X, views, parallax }], matches, rms }. parallax = widest angle between two of its rays. */
  function reconstruct(params, obs) {
    var poses = params.map(pose), points = [], matches = 0, n = obs.length ? obs[0].length : 0;
    for (var id = 0; id < n; id++) {
      var views = [], rays = [];
      for (var ci = 0; ci < obs.length; ci++) {
        if (!obs[ci][id]) continue;
        views.push(ci);
        rays.push({ c: poses[ci].c, d: ray(poses[ci], obs[ci][id][0], obs[ci][id][1]) });
      }
      if (views.length < 2) continue;
      matches += views.length * (views.length - 1) / 2;
      var X = triangulate(rays), par = 0;
      if (!X || views.some(function (v) { return !project(poses[v], X); })) continue;   // parallel rays, or behind a camera
      for (var a = 0; a < rays.length; a++) for (var b = a + 1; b < rays.length; b++) {
        par = Math.max(par, Math.acos(Math.min(1, dot(rays[a].d, rays[b].d))));
      }
      points.push({ id: id, X: X, views: views, parallax: par });
    }
    return { poses: poses, points: points, matches: matches, rms: reprojRms(poses, obs, points) };
  }

  // ─────────────────────────────── refine (bundle adjustment, the cheap kind) ───────────────────────────────
  /** One alternation: with the points held, move each camera (except `fixed`, which pins the gauge) by a damped
   *  Gauss–Newton step on its reprojection error; then the caller re-triangulates. Returns new params. */
  function refineStep(params, obs, points, fixed) {
    var KEYS = ['az', 'el', 'r'], EPS = 1e-4, byView = params.map(function () { return []; });
    points.forEach(function (pt) { pt.views.forEach(function (v) { byView[v].push(pt); }); });   // one pass, not a filter per view
    return params.map(function (p, ci) {
      var mine = byView[ci];
      if (ci === fixed || mine.length < 3) return p;
      function resid(q) {
        var P = pose(q), r = [];
        mine.forEach(function (pt) {
          var uv = project(P, pt.X) || [1e3, 1e3], o = obs[ci][pt.id];
          r.push(uv[0] - o[0], uv[1] - o[1]);
        });
        return r;
      }
      function cost(r) { return r.reduce(function (s, v) { return s + v * v; }, 0); }
      var r0 = resid(p), J = KEYS.map(function (k) {
        var q = { az: p.az, el: p.el, r: p.r }; q[k] += EPS;
        return resid(q).map(function (v, i) { return (v - r0[i]) / EPS; });
      });
      var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0], i, j;
      for (i = 0; i < 3; i++) {
        for (j = 0; j < 3; j++) A[i][j] = J[i].reduce(function (s, v, n) { return s + v * J[j][n]; }, 0);
        g[i] = -J[i].reduce(function (s, v, n) { return s + v * r0[n]; }, 0);
      }
      for (i = 0; i < 3; i++) A[i][i] *= 1.001;                  // Levenberg damping
      var d = solve3(A, g);
      if (!d) return p;
      var q = { az: p.az + d[0], el: p.el + d[1], r: p.r + d[2] };
      return cost(resid(q)) < cost(r0) ? q : p;                  // never accept a step that makes it worse
    });
  }
  /** iters rounds of refineStep + re-triangulation. Returns { params, rec }. rec0: the reconstruction of params, if the caller has it. */
  function refine(params, obs, iters, fixed, rec0) {
    var rec = rec0 || reconstruct(params, obs);
    for (var i = 0; i < iters; i++) {
      params = refineStep(params, obs, rec.points, fixed || 0);
      rec = reconstruct(params, obs);
    }
    return { params: params, rec: rec };
  }

  // ─────────────────────────────── densify ───────────────────────────────
  /** Sparse points → coarse voxel map { 'i,j,k': colour }. colors[id] is each landmark's colour.
   *  Surface points sit on cell borders, so each is pulled half a cell towards the cloud's centroid before binning. */
  function densify(points, colors, cellSize) {
    var u = cellSize || 1, vox = {}, best = {}, c = [0, 0, 0], inside = points.filter(function (pt) {
      return Math.abs(pt.X[0]) < CONFIG.VOLUME && Math.abs(pt.X[1]) < CONFIG.VOLUME && pt.X[2] >= 0 && pt.X[2] < 9;
    });
    if (!inside.length) return vox;
    inside.forEach(function (pt) { for (var a = 0; a < 3; a++) c[a] += pt.X[a] / inside.length; });
    inside.forEach(function (pt) {
      var d = unit(sub(c, pt.X)), q = [pt.X[0] + d[0] * u / 2, pt.X[1] + d[1] * u / 2, Math.max(0, pt.X[2] + d[2] * u / 2)];
      var cell = q.map(function (v) { return Math.floor(v / u); }), kk = key(cell[0], cell[1], cell[2]);
      var off = dist(q, [(cell[0] + 0.5) * u, (cell[1] + 0.5) * u, (cell[2] + 0.5) * u]);
      if (!(off >= best[kk])) { best[kk] = off; vox[kk] = colors[pt.id]; }   // nearest point to the cell centre names the colour
    });
    var add = {};
    Object.keys(vox).forEach(function (kk) {                     // one dilation pass: plug holes in walls
      var p = kk.split(',').map(Number);
      DIRS.forEach(function (n) {
        var q = [p[0] + n[0], p[1] + n[1], p[2] + n[2]], qk = key(q[0], q[1], q[2]);
        if (vox[qk] || add[qk] || q[2] < 0) return;
        var filled = DIRS.filter(function (m) { return vox[key(q[0] + m[0], q[1] + m[1], q[2] + m[2])]; });
        if (filled.length >= CONFIG.DILATE_MIN) add[qk] = vox[kk];
      });
    });
    Object.keys(add).forEach(function (kk) { vox[kk] = add[kk]; });
    return vox;
  }

  var api = {
    CONFIG: CONFIG, mulberry32: mulberry32, makeNoise: makeNoise, dist: dist, dot: dot, unit: unit, sub: sub,
    buildModel: buildModel, facesOf: facesOf, pose: pose, project: project, ray: ray, visible: visible, observe: observe,
    triangulate: triangulate, reconstruct: reconstruct, reprojRms: reprojRms, refineStep: refineStep, refine: refine,
    densify: densify
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SfmCore = api;
})(typeof window !== 'undefined' ? window : this);
