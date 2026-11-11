/* Tests for js/sfm-core.js — run with:  node tests/sfm.test.js
 * No frameworks. Deterministic: all noise comes from seeded PRNGs. */
'use strict';

// ───────────────────────── CONFIG ─────────────────────────
const DEG = Math.PI / 180;
const NOISE_SEEDS = [11, 12, 13, 14, 15, 16, 17, 18];   // one per camera
const WIDE_DEG = 60;            // baseline (azimuth gap) that should triangulate well
const NARROW_DEG = 4;           // … and one that should not
const JITTER = [[0, 0, 0], [7, -6, 0.7], [-7, 6, -0.6], [6, 7, 0.6]];   // pose error per camera: az°, el°, r (up to JITTER_DEG, JITTER_R in js/sfm.js)
const REFINE_ITERS = 6;
const FRAMES = 24, FILM_EL = 22;   // as FILM_FRAMES, FILM_EL in js/sfm.js
const ROUND_MS_MAX = 60;          // one refine round at 16 cameras + 24 frames; generous: CI machines vary (sfm.js caps a frame's chunk at 12 ms)
// ───────────────────────────────────────────────────────────

const assert = require('assert');
const path = require('path');
const S = require(path.join(__dirname, '..', 'js', 'sfm-core.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    passed++;
    console.log(`  ok    ${name}  (${Date.now() - t0}ms)`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n').join('\n        ')}`);
  }
}

const fs = require('fs');
const loadModel = (file, name) => { const win = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', 'assets', 'models', file), 'utf8'))(win); return win[name]; };
const tModel = loadModel('temple.js', 'TEMPLE_MODEL'), catModel = loadModel('lucky-cat.js', 'LUCKY_CAT_MODEL'), snackModel = loadModel('snack-machine.js', 'SNACK_MACHINE_MODEL');
const temple = S.buildModel(tModel), cat = S.buildModel(catModel), snack = S.buildModel(snackModel);   // the snack machine is the default scene of the showcase; the temple and the cat are in the picker
const R = S.CONFIG.RADIUS;
const cam = (az, el) => ({ az: az * DEG, el: el * DEG, r: R });
const noise = i => S.makeNoise(NOISE_SEEDS[i], temple.landmarks.length * 2);
const catNoise = i => S.makeNoise(NOISE_SEEDS[i], cat.landmarks.length * 2);
/** mean distance between triangulated points and their true landmarks */
function meanError(rec) {
  return rec.points.reduce((s, pt) => s + S.dist(pt.X, temple.landmarks[pt.id].p), 0) / rec.points.length;
}

console.log('\ncamera');
test('projection round-trip: the ray through a projected pixel passes through the point', () => {
  const P = S.pose(cam(40, 25));
  for (const X of [[0, 0, 2.5], [3, -3, 0], [-2.2, 1.4, 5.5], [1, 2, 3]]) {
    const uv = S.project(P, X), d = S.ray(P, uv[0], uv[1]), depth = S.dist(X, P.c);
    const back = [P.c[0] + d[0] * depth, P.c[1] + d[1] * depth, P.c[2] + d[2] * depth];
    assert.ok(S.dist(back, X) < 1e-9, `off by ${S.dist(back, X)}`);
  }
  const centre = S.project(P, S.CONFIG.TARGET);
  assert.ok(Math.abs(centre[0] - S.CONFIG.IMG_W / 2) < 1e-9 && Math.abs(centre[1] - S.CONFIG.IMG_H / 2) < 1e-9, 'the target is not at the image centre');
});
test('occlusion hides back-facing landmarks', () => {
  const P = S.pose(cam(90, 15));                       // out along +y, looking back at the temple
  const front = temple.landmarks.filter(lm => lm.n[1] === 1), back = temple.landmarks.filter(lm => lm.n[1] === -1);
  assert.ok(front.length > 5 && back.length > 5, 'not enough wall landmarks to test with');
  assert.ok(front.filter(lm => S.visible(temple, P, lm)).length > front.length * 0.5, 'most +y landmarks should be visible from +y (eaves hide a few)');
  assert.ok(back.every(lm => !S.visible(temple, P, lm)), 'a -y landmark is visible through the temple');
  const obs = S.observe(temple, P, null);
  assert.ok(obs.some(o => o) && obs.some(o => !o), 'observe() should see some landmarks and not others');
});

console.log('\ntriangulation');
test('noiseless triangulation recovers the landmarks to < 1e-6', () => {
  const params = [cam(20, 15), cam(80, 30), cam(140, 20)];
  const rec = S.reconstruct(params, params.map(p => S.observe(temple, S.pose(p), null)));
  assert.ok(rec.points.length > 20, `only ${rec.points.length} points`);
  const worst = Math.max(...rec.points.map(pt => S.dist(pt.X, temple.landmarks[pt.id].p)));
  assert.ok(worst < 1e-6, `worst error ${worst}`);
  assert.ok(rec.rms < 1e-6, `reprojection error ${rec.rms}`);
});
test('with pixel noise, a wide baseline beats a narrow one', () => {
  const run = gap => {
    const params = [cam(45 - gap / 2, 20), cam(45 + gap / 2, 20)];
    return meanError(S.reconstruct(params, params.map((p, i) => S.observe(temple, S.pose(p), noise(i)))));
  };
  const wide = run(WIDE_DEG), narrow = run(NARROW_DEG);
  assert.ok(wide < 0.3, `wide-baseline error ${wide.toFixed(3)} voxels`);
  assert.ok(narrow > 3 * wide, `narrow ${narrow.toFixed(3)} is not clearly worse than wide ${wide.toFixed(3)}`);
});

console.log('\nrefine');
test('refine lowers the reprojection error of jittered poses', () => {
  const truth = [cam(45, 12), cam(165, 25), cam(285, 25), cam(100, 35)];
  const obs = truth.map((p, i) => S.observe(temple, S.pose(p), noise(i)));
  const start = truth.map((p, i) => ({ az: p.az + JITTER[i][0] * DEG, el: p.el + JITTER[i][1] * DEG, r: p.r + JITTER[i][2] }));
  const before = S.reconstruct(start, obs).rms;
  const one = S.refine(start, obs, 1, 0).rec.rms, after = S.refine(start, obs, REFINE_ITERS, 0).rec.rms;
  assert.ok(one < before, `one step: ${before.toFixed(2)} -> ${one.toFixed(2)} px`);
  assert.ok(after < before * 0.6 && after < 2 * S.CONFIG.NOISE_PX, `${REFINE_ITERS} steps: ${before.toFixed(2)} -> ${after.toFixed(2)} px`);
  console.log(`        ${before.toFixed(2)} px -> ${one.toFixed(2)} -> ${after.toFixed(2)} px`);
});


console.log('\nmore views: 16 cameras + a 24-frame film');
// the film: FRAMES views a frame every 360/FRAMES degrees at one elevation, from az0 (what sfm.js's "film it" records). Frames are views like any other.
const film = (az0, seed0) => Array.from({ length: FRAMES }, (_, i) => ({ p: cam(az0 + i * 360 / FRAMES, FILM_EL), seed: seed0 + i }));
const views = (cams, frames) => {
  const all = cams.map((p, i) => ({ p, seed: 300 + i })).concat(frames);
  return { params: all.map(v => v.p), obs: all.map(v => S.observe(temple, S.pose(v.p), S.makeNoise(v.seed, temple.landmarks.length * 2))) };
};
const sixteen = Array.from({ length: 16 }, (_, i) => cam(i * 22.5 + 5, 12 + (i % 4) * 9));
test('16 cameras + 24 frames triangulate more points than 4 cameras, from more matches', () => {
  const few = views(sixteen.filter((_, i) => i % 4 === 0), []), many = views(sixteen, film(0, 1000));
  const a = S.reconstruct(few.params, few.obs), b = S.reconstruct(many.params, many.obs);
  assert.ok(b.points.length > a.points.length, `${b.points.length} points is not more than ${a.points.length}`);
  assert.ok(b.matches > a.matches, 'no more matches');
  assert.ok(b.points.some(pt => pt.views.length > 12), 'no landmark is seen by a dozen views: not multi-view');
  const err = rec => rec.points.reduce((t, pt) => t + S.dist(pt.X, temple.landmarks[pt.id].p), 0) / rec.points.length;
  assert.ok(err(b) <= err(a) * 1.1, `mean error ${err(b).toFixed(3)} vs ${err(a).toFixed(3)} voxels`);
  console.log(`        4 cams: ${a.points.length} points, ${a.matches} matches · 16 + film: ${b.points.length} points, ${b.matches} matches`);
});
test('refine still lowers the error with 16 cameras + 24 frames, and one round stays cheap', () => {
  const v = views(sixteen, film(0, 1000));
  const start = v.params.map((p, i) => i ? { az: p.az + JITTER[i % 4][0] * DEG, el: p.el + JITTER[i % 4][1] * DEG, r: p.r + JITTER[i % 4][2] } : p);
  const rec0 = S.reconstruct(start, v.obs);
  const t0 = process.hrtime.bigint();
  const one = S.refine(start, v.obs, 1, 0, rec0);                       // rec0 given: one reconstruct + one step per round
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const after = S.refine(start, v.obs, REFINE_ITERS, 0, rec0).rec.rms;
  assert.ok(one.rec.rms < rec0.rms, `one round: ${rec0.rms.toFixed(2)} -> ${one.rec.rms.toFixed(2)} px`);
  assert.ok(after < rec0.rms / 2, `${REFINE_ITERS} rounds: ${rec0.rms.toFixed(2)} -> ${after.toFixed(2)} px`);
  assert.ok(ms < ROUND_MS_MAX, `one round took ${ms.toFixed(1)} ms`);
  console.log(`        ${rec0.rms.toFixed(2)} px -> ${one.rec.rms.toFixed(2)} -> ${after.toFixed(2)} px; one round ${ms.toFixed(1)} ms (${v.params.length} views)`);
});
test('film replace semantics: a new film replaces the old one, same film is the same views', () => {
  const base = sixteen.slice(0, 3), f1 = film(10, 1000), f2 = film(17, 1000);
  const count = (frames) => { const v = views(base, frames), r = S.reconstruct(v.params, v.obs); return [r.points.length, r.matches]; };
  assert.deepStrictEqual(count(f1), count(film(10, 1000)), 'filming twice from the same spot gave different views');
  assert.notDeepStrictEqual(count(f2), count(f1), 'a different film gave identical results');
  assert.ok(count(f2)[1] < count(f1.concat(f2))[1], 'replacing should drop the old frames, not add to them');
  assert.ok(count(f1)[0] > count([])[0], 'the film added no points');
});

console.log('\ndensify');
test('densify fills voxels inside the temple bounds', () => {
  const params = [0, 45, 90, 135, 180, 225, 270, 315].map(az => cam(az, 25));
  const rec = S.reconstruct(params, params.map((p, i) => S.observe(temple, S.pose(p), noise(i))));
  const vox = S.densify(rec.points, temple.landmarks.map(lm => lm.color), temple.dense);
  const cells = Object.keys(vox).map(k => k.split(',').map(Number));
  assert.ok(cells.length > 40, `only ${cells.length} voxels`);
  const out = cells.filter(c => c.some((v, a) => v * temple.dense < temple.min[a] - temple.dense || v * temple.dense > temple.max[a] + temple.dense));
  assert.ok(out.length <= cells.length * 0.05, `${out.length} of ${cells.length} voxels outside the temple: ${out.slice(0, 3).join(' | ')}`);
  const real = cells.filter(c => temple.vox[c.join(',')]).length;
  assert.ok(real / cells.length > 0.5, `only ${real}/${cells.length} voxels are real temple voxels`);
  assert.ok(Object.values(vox).every(c => /^#[0-9a-f]{6}$/.test(c)), 'unknown voxel colour');
  console.log(`        ${rec.points.length} points -> ${cells.length} voxels, ${real} on the real temple (${Object.keys(temple.vox).length} voxels, ${temple.landmarks.length} landmarks)`);
});

console.log('\ntemple model');
test('the temple model loads: voxels, palette, unit, 20 voxels tall', () => {
  assert.ok(tModel && tModel.vox.length > 500 && tModel.palette.length > 3 && tModel.unit > 0, 'model missing or empty');
  assert.ok(tModel.vox.every(v => v[3] >= 0 && v[3] < tModel.palette.length && v[2] >= 0), 'bad palette index or voxel below the ground');
  assert.ok(Math.max(...tModel.vox.map(v => v[2])) + 1 === 20, 'not 20 voxels tall');
  assert.ok(tModel.palette.every(c => /^#[0-9a-f]{6}$/.test(c)), 'palette entries must be #rrggbb');
});
test('the temple has more landmarks per exposed face than the cat (coloured trim)', () => {
  const r = m => m.landmarks.length / m.faces.length;
  assert.ok(temple.landmarks.length > 100 && r(temple) > r(cat), `temple ${r(temple).toFixed(2)} vs cat ${r(cat).toFixed(2)}`);
  console.log(`        ${Object.keys(temple.vox).length} voxels, ${temple.faces.length} faces, ${temple.landmarks.length} landmarks (${r(temple).toFixed(2)}/face; cat ${r(cat).toFixed(2)})`);
});
console.log('\nlucky cat model');
test('the cat model loads: voxels, palette, unit, 16 voxels tall', () => {
  assert.ok(catModel && catModel.vox.length > 500 && catModel.palette.length > 3 && catModel.unit > 0, 'model missing or empty');
  assert.ok(catModel.vox.every(v => v[3] >= 0 && v[3] < catModel.palette.length && v[2] >= 0), 'bad palette index or voxel below the ground');
  assert.ok(Math.max(...catModel.vox.map(v => v[2])) + 1 === 16, 'not 16 voxels tall');
  assert.ok(catModel.palette.every(c => /^#[0-9a-f]{6}$/.test(c)), 'palette entries must be #rrggbb');
});
test('the cat scene has faces and landmarks on its visible surface', () => {
  assert.ok(cat.faces.length > 300 && cat.landmarks.length > 100, `${cat.faces.length} faces, ${cat.landmarks.length} landmarks`);
  assert.ok(cat.landmarks.length < cat.faces.length * 0.6, 'plain fur should be thin on landmarks');
  const P = S.pose(cam(40, 25)), seen = S.observe(cat, P, null).filter(Boolean).length;
  assert.ok(seen > 30 && seen < cat.landmarks.length * 0.8, `${seen} of ${cat.landmarks.length} landmarks seen from one side`);
  console.log(`        ${Object.keys(cat.vox).length} voxels, ${cat.faces.length} faces, ${cat.landmarks.length} landmarks`);
});
test('cat occlusion: landmarks facing away from the camera are hidden', () => {
  const P = S.pose(cam(90, 15));                       // out along +y: the cat's face looks this way
  const front = cat.landmarks.filter(lm => lm.n[1] === 1), back = cat.landmarks.filter(lm => lm.n[1] === -1);
  assert.ok(front.length > 5 && back.length > 5);
  assert.ok(back.every(lm => !S.visible(cat, P, lm)), 'a -y landmark is visible through the cat');
  assert.ok(front.filter(lm => S.visible(cat, P, lm)).length > front.length * 0.5, 'most +y landmarks should be visible from +y');
});
test('noiseless triangulation of the cat is exact', () => {
  const params = [0, 70, 140, 210, 280].map(az => cam(az, 20));
  const rec = S.reconstruct(params, params.map(p => S.observe(cat, S.pose(p), null)));
  assert.ok(rec.points.length > 50, `only ${rec.points.length} points`);
  const err = rec.points.reduce((m, pt) => Math.max(m, S.dist(pt.X, cat.landmarks[pt.id].p)), 0);
  assert.ok(err < 1e-6, `max error ${err}`);
  assert.ok(rec.rms < 1e-6, `rms ${rec.rms}`);
});
test('noisy cat: refine lowers reprojection error; densify gives cat voxels inside its box', () => {
  const params = [0, 60, 120, 180, 240, 300].map(az => cam(az, 25));
  const obs = params.map((p, i) => S.observe(cat, S.pose(p), catNoise(i)));
  const jit = params.map((p, i) => ({ az: p.az + JITTER[i % 4][0] * DEG * (i ? 1 : 0), el: p.el + JITTER[i % 4][1] * DEG * (i ? 1 : 0), r: R + JITTER[i % 4][2] * (i ? 1 : 0) }));
  const rec0 = S.reconstruct(jit, obs), after = S.refine(jit, obs, REFINE_ITERS, 0, rec0).rec.rms;
  assert.ok(after < rec0.rms, `${rec0.rms.toFixed(2)} -> ${after.toFixed(2)} px`);
  const rec = S.reconstruct(params, obs);
  const vox = S.densify(rec.points, cat.landmarks.map(lm => lm.color), cat.dense);
  const cells = Object.keys(vox).map(k => k.split(',').map(Number));
  assert.ok(cells.length > 20, `only ${cells.length} voxels`);
  const out = cells.filter(c => c.some((v, a) => v * cat.dense < cat.min[a] - cat.dense || v * cat.dense > cat.max[a] + cat.dense));
  assert.ok(out.length <= cells.length * 0.05, `${out.length} of ${cells.length} voxels outside the cat's box`);
  assert.ok(Object.values(vox).every(c => /^#[0-9a-f]{6}$/.test(c)), 'unexpected voxel colour');
  console.log(`        refine ${rec0.rms.toFixed(2)} -> ${after.toFixed(2)} px; ${rec.points.length} points -> ${cells.length} voxels`);
});


console.log('\nsnack machine model');
test('the snack machine model loads: voxels, palette, unit, 22 voxels tall, at most 1500 voxels', () => {
  assert.ok(snackModel && snackModel.vox.length > 500 && snackModel.vox.length <= 1500 && snackModel.palette.length > 3 && snackModel.unit > 0, 'model missing, empty or too big');
  assert.ok(snackModel.vox.every(v => v[3] >= 0 && v[3] < snackModel.palette.length && v[2] >= 0), 'bad palette index or voxel below the ground');
  assert.ok(Math.max(...snackModel.vox.map(v => v[2])) + 1 === 22, 'not 22 voxels tall');
  assert.ok(snackModel.palette.every(c => /^#[0-9a-f]{6}$/.test(c)), 'palette entries must be #rrggbb');
});
test('the snack machine has landmarks on every side (coloured shading, not plain white)', () => {
  assert.ok(snack.landmarks.length > 100, `${snack.landmarks.length} landmarks`);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, y]) => assert.ok(snack.landmarks.filter(lm => lm.n[0] === x && lm.n[1] === y).length > 20, `side ${x},${y} has too few landmarks`));
  const r = m => m.landmarks.length / m.faces.length;
  console.log(`        ${Object.keys(snack.vox).length} voxels, ${snack.faces.length} faces, ${snack.landmarks.length} landmarks (${r(snack).toFixed(2)}/face; temple ${r(temple).toFixed(2)}, cat ${r(cat).toFixed(2)})`);
});
test('noiseless triangulation of the snack machine is exact', () => {
  const params = [0, 70, 140, 210, 280].map(az => cam(az, 20));
  const rec = S.reconstruct(params, params.map(p => S.observe(snack, S.pose(p), null)));
  assert.ok(rec.points.length > 50, `only ${rec.points.length} points`);
  const err = rec.points.reduce((m, pt) => Math.max(m, S.dist(pt.X, snack.landmarks[pt.id].p)), 0);
  assert.ok(err < 1e-6, `max error ${err}`);
  assert.ok(rec.rms < 1e-6, `rms ${rec.rms}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
