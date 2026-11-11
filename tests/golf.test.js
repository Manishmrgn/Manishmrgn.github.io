/* Tests for js/golf-core.js — run with:  node tests/golf.test.js
 * No frameworks. Deterministic: the windy hole's noise comes from a seeded PRNG. */
'use strict';

// ───────────────────────── CONFIG ─────────────────────────
const LR_MIN = 0.002, LR_PER_DECADE = 20, LR_STEPS = 54;   // the learning-rate slider, as in js/golf.js
const GOOD = [                                             // one well-tuned swing per hole: it must make par
  { opt: 'sgd', lr: 0.3 },
  { opt: 'momentum', lr: 0.2, beta: 0.9 },
  { opt: 'adam', lr: 0.56 },
  { opt: 'adam', lr: 0.63 },
  { opt: 'momentum', lr: 0.08, beta: 0.5 }
];
const SLOPPY = [                                           // … and one careless swing per hole: it must not
  { opt: 'sgd', lr: 0.1 },
  { opt: 'sgd', lr: 0.2 },
  { opt: 'sgd', lr: 0.2 },
  { opt: 'sgd', lr: 0.2 },
  { opt: 'sgd', lr: 0.2 }
];
const PAR_SLACK = 3;            // par is at most this many steps above the good swing
const FAKE_R = 0.3;             // stuck this close to the fake hole = stuck in it (FAKE_R in js/golf.js)
const GRAD_H = 1e-5, GRAD_TOL = 1e-6;
// ───────────────────────────────────────────────────────────

const assert = require('assert');
const path = require('path');
const G = require(path.join(__dirname, '..', 'js', 'golf-core.js'));
const [bowl, fake, ravine, plateau, windy] = G.HOLES;
const D = G.CONFIG.D, DEF = G.CONFIG.DEFAULTS;
const sliderLrs = Array.from({ length: LR_STEPS + 1 }, (_, p) => LR_MIN * Math.pow(10, p / LR_PER_DECADE));
const end = r => r.path[r.path.length - 1];
/** mean angle between consecutive steps, degrees: how jagged a path is */
function meanTurn(r) {
  let sum = 0, n = 0;
  for (let i = 2; i < r.path.length; i++) {
    const u = [r.path[i - 1][0] - r.path[i - 2][0], r.path[i - 1][1] - r.path[i - 2][1]], v = [r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]];
    const d = Math.hypot(...u) * Math.hypot(...v);
    if (d) { sum += Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / d))); n++; }
  }
  return sum / n * 180 / Math.PI;
}

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

console.log('\nholes');
test('five holes; each cup is the lowest point on the course, with loss 0 and no gradient', () => {
  assert.deepStrictEqual(G.HOLES.map(h => h.name), ['bowl', 'fake hole', 'ravine', 'plateau', 'windy']);
  for (const h of G.HOLES) {
    assert.ok(Math.abs(h.f(h.cup[0], h.cup[1])) < 1e-12, `${h.name}: f(cup) = ${h.f(h.cup[0], h.cup[1])}`);
    assert.ok(Math.hypot(...h.grad(h.cup[0], h.cup[1])) < 1e-3, `${h.name}: gradient at the cup ${h.grad(h.cup[0], h.cup[1])}`);
    for (let x = -D; x <= D; x += 0.1) for (let y = -D; y <= D; y += 0.1) assert.ok(h.f(x, y) > -1e-9, `${h.name}: f(${x}, ${y}) = ${h.f(x, y)} is below the cup`);
    assert.ok(G.height(h, h.cup[0], h.cup[1]) === 0, `${h.name}: the cup's column is not the lowest`);
    assert.ok(Math.abs(h.tee[0]) < D && Math.abs(h.tee[1]) < D && G.dist(h.tee, h.cup) > 1, `${h.name}: tee off the course or on the cup`);
  }
});
test('the analytic gradient matches finite differences', () => {
  for (const h of G.HOLES) for (const [x, y] of [[-1.5, -1.5], [0.3, -0.7], [-0.4, -0.45], [1.2, 0.9], [0.9, 0.6]]) {
    const g = h.grad(x, y), n = [(h.f(x + GRAD_H, y) - h.f(x - GRAD_H, y)) / (2 * GRAD_H), (h.f(x, y + GRAD_H) - h.f(x, y - GRAD_H)) / (2 * GRAD_H)];
    assert.ok(Math.hypot(g[0] - n[0], g[1] - n[1]) < GRAD_TOL * (1 + Math.hypot(...n)), `${h.name} at ${x}, ${y}: ${g} vs ${n}`);
  }
});
test('the fake hole is a local minimum between the tee and the cup, higher than the cup', () => {
  const m = fake.fake, here = fake.f(m[0], m[1]);
  assert.ok(Math.hypot(...fake.grad(m[0], m[1])) < 1e-3, `gradient there: ${fake.grad(m[0], m[1])}`);
  for (let a = 0; a < 6.28; a += 0.4) assert.ok(fake.f(m[0] + 0.1 * Math.cos(a), m[1] + 0.1 * Math.sin(a)) > here, 'not a minimum');
  assert.ok(here > 0.5, `only ${here} above the cup`);
  assert.ok(G.dist(fake.tee, m) < G.dist(fake.tee, fake.cup) && G.dist(m, fake.cup) < G.dist(fake.tee, fake.cup), 'not between tee and cup');
});
test('contour segments lie on their level', () => {
  for (const h of G.HOLES) {
    const level = 0.22 * h.top, segs = G.contour(h, level, 24);
    assert.ok(segs.length > 8, `${h.name}: ${segs.length} segments`);
    for (const s of segs) for (const p of [[s[0], s[1]], [s[2], s[3]]]) assert.ok(Math.abs(h.f(p[0], p[1]) - level) < 0.08 * h.top, `${h.name}: f = ${h.f(p[0], p[1])} on the ${level} contour`);
  }
});

console.log('\nplay');
test('deterministic: the same settings give the same path, on every hole', () => {
  for (const h of G.HOLES) for (const set of [DEF, GOOD[4], { opt: 'adam', lr: 0.3 }]) assert.deepStrictEqual(G.play(h, set), G.play(h, set));
});
test('a swing starts where it is told to and counts its steps', () => {
  const r = G.play(bowl, DEF, [1, -1]);
  assert.deepStrictEqual(r.path[0], [1, -1]);
  assert.ok(r.steps === r.path.length - 1 && r.losses.length === r.path.length && r.steps <= G.CONFIG.MAX_STEPS);
  assert.ok(Math.abs(r.losses[0] - bowl.f(1, -1)) < 1e-12);
});
test('plain sgd takes exactly θ − lr · gradient', () => {
  const r = G.play(bowl, { opt: 'sgd', lr: 0.05 }), g = bowl.grad(bowl.tee[0], bowl.tee[1]);
  assert.ok(G.dist(r.path[1], [bowl.tee[0] - 0.05 * g[0], bowl.tee[1] - 0.05 * g[1]]) < 1e-12);
});
test("adam's first step is lr in each direction (bias correction)", () => {
  const r = G.play(plateau, { opt: 'adam', lr: 0.1 });
  assert.ok(Math.abs(Math.abs(r.path[1][0] - r.path[0][0]) - 0.1) < 1e-4 && Math.abs(Math.abs(r.path[1][1] - r.path[0][1]) - 0.1) < 1e-4, String(r.path[1]));
});

console.log('\npar');
test('a good setting makes par on every hole, and par is not generous', () => {
  G.HOLES.forEach((h, i) => {
    const r = G.play(h, GOOD[i]);
    console.log(`        ${i + 1} ${h.name}: ${GOOD[i].opt} lr ${GOOD[i].lr}${GOOD[i].beta ? ' β ' + GOOD[i].beta : ''} → ${r.status} in ${r.steps}, par ${h.par}`);
    assert.ok(r.status === 'cup' && r.steps <= h.par, `${h.name}: ${r.status} in ${r.steps}, par ${h.par}`);
    assert.ok(h.par - r.steps <= PAR_SLACK, `${h.name}: par ${h.par} is ${h.par - r.steps} above a good swing`);
  });
});
test('a sloppy setting misses par on every hole', () => {
  G.HOLES.forEach((h, i) => {
    const r = G.play(h, SLOPPY[i]);
    assert.ok(r.status !== 'cup' || r.steps > h.par, `${h.name}: ${SLOPPY[i].opt} lr ${SLOPPY[i].lr} made par (${r.steps})`);
  });
});
test('the default settings sink hole 1 within par', () => {
  const r = G.play(bowl, DEF);
  assert.ok(r.status === 'cup' && r.steps <= bowl.par, `${r.status} in ${r.steps}`);
});

console.log('\nwhat each hole teaches');
test('bowl: a learning rate that is too big oscillates, then flies off the course', () => {
  const r = G.play(bowl, { opt: 'sgd', lr: 0.56 });
  assert.strictEqual(r.status, 'out');
  assert.ok(r.steps >= 3, `gone in ${r.steps}`);
  const side = r.path.slice(1).map(p => Math.sign(p[1] - bowl.cup[1]));
  assert.ok(side.every((s, i) => !i || s === -side[i - 1]), `no oscillation across the cup: ${side}`);
  assert.ok(r.losses[r.steps] > r.losses[1], 'the loss did not grow');
});
test('bowl: a learning rate that is too small does not get there', () => {
  assert.notStrictEqual(G.play(bowl, { opt: 'sgd', lr: 0.004 }).status, 'cup');
});
test('fake hole: sgd settles in the local minimum; momentum rolls through to the cup', () => {
  const sgd = G.play(fake, DEF), mom = G.play(fake, { opt: 'momentum', lr: DEF.lr, beta: DEF.beta });
  assert.ok(sgd.status === 'stuck' && G.dist(end(sgd), fake.fake) < FAKE_R, `sgd: ${sgd.status} at ${end(sgd)}`);
  assert.ok(mom.status === 'cup' && mom.steps <= fake.par, `momentum: ${mom.status} in ${mom.steps}`);
  const trapped = sliderLrs.filter(lr => lr >= 0.03 && lr <= 0.4).every(lr => { const r = G.play(fake, { opt: 'sgd', lr }); return r.status === 'stuck' && G.dist(end(r), fake.fake) < FAKE_R; });
  assert.ok(trapped, 'some modest sgd learning rate escaped the fake hole');
});
test('fake hole: nothing leaves the local minimum from rest (hence the restart from the tee)', () => {
  const lie = end(G.play(fake, DEF));
  for (const opt of ['sgd', 'momentum']) assert.strictEqual(G.play(fake, { opt, lr: DEF.lr, beta: DEF.beta }, lie).status, 'stuck', opt);
});
test('ravine: sgd zig-zags wall to wall and never arrives; adam slides down it', () => {
  const zig = G.play(ravine, DEF), adam = G.play(ravine, GOOD[2]);
  const side = zig.path.slice(0, 8).map(p => Math.sign(p[1] - ravine.cup[1]));
  assert.ok(side.every((s, i) => !i || s === -side[i - 1]), `sgd is not zig-zagging: ${side}`);
  assert.ok(sliderLrs.every(lr => G.play(ravine, { opt: 'sgd', lr }).status !== 'cup'), 'some sgd learning rate sank the ravine in one swing');
  assert.ok(adam.status === 'cup' && adam.steps <= ravine.par, `adam: ${adam.status} in ${adam.steps}`);
});
test('plateau: sgd crawls on the flat shelf; adam crosses it', () => {
  const sgd = G.play(plateau, DEF), adam = G.play(plateau, GOOD[3]);
  assert.notStrictEqual(sgd.status, 'cup');
  const step = G.dist(sgd.path[0], sgd.path[1]);
  assert.ok(step < 0.03, `sgd's first step is ${step}`);
  assert.ok(Math.hypot(...plateau.grad(plateau.tee[0], plateau.tee[1])) < 0.1, 'the shelf is not flat');
  assert.ok(G.dist(adam.path[0], adam.path[1]) > 10 * step, 'adam does not step further than sgd on the shelf');
  assert.ok(adam.status === 'cup' && adam.steps <= plateau.par, `adam: ${adam.status} in ${adam.steps}`);
  assert.ok(sliderLrs.filter(lr => lr <= 0.4).every(lr => G.play(plateau, { opt: 'sgd', lr }).status !== 'cup'), 'a modest sgd learning rate crossed the plateau');
});
test('windy: the noise sums to zero over an epoch, so it moves the path but not the average gradient', () => {
  const lr = 0.01, calm = Object.assign({}, windy, { noise: 0 }), B = G.CONFIG.BATCHES;
  const a = G.play(windy, { opt: 'sgd', lr }), b = G.play(calm, { opt: 'sgd', lr });
  const off = Math.max(...a.path.slice(1, B).map((p, i) => G.dist(p, b.path[i + 1])));
  assert.ok(off > 0.02, `the noise only moved the path by ${off}`);
  assert.ok(G.dist(a.path[B], b.path[B]) < 0.25 * off, `after an epoch the paths still differ by ${G.dist(a.path[B], b.path[B])}`);
});
test('windy: sgd is thrown about, momentum averages the gusts and makes par', () => {
  const sgd = G.play(windy, DEF), mom = G.play(windy, GOOD[4]);
  assert.ok(meanTurn(sgd) > 2 * meanTurn(mom), `turn per step: sgd ${meanTurn(sgd).toFixed(0)}°, momentum ${meanTurn(mom).toFixed(0)}°`);
  assert.ok(mom.status === 'cup' && mom.steps <= windy.par, `momentum: ${mom.status} in ${mom.steps}`);
  const best = Math.min(...sliderLrs.map(lr => { const r = G.play(windy, { opt: 'sgd', lr }); return r.status === 'cup' ? r.steps : Infinity; }));
  assert.ok(best > windy.par, `sgd can make par (${best}) on the windy hole`);
});

test('pace: a longer hop takes longer, a whole swing stays short, and times only go up', () => {
  const cell = 2 * D / G.CONFIG.CELLS, T = G.pace([[0, 0], [0.1 * cell, 0], [0.1 * cell, 2 * cell]]);
  assert.strictEqual(T[0], 0);
  assert.ok(T[2] - T[1] > T[1] - T[0], `hops of 0.1 and 2 cells: ${T}`);
  assert.ok(T[1] >= G.CONFIG.HOP_MIN_MS, `a tiny hop is never shorter than HOP_MIN_MS: ${T[1]}`);
  const crawl = G.play(ravine, { opt: 'sgd', lr: 0.2 }), C = G.pace(crawl.path);   // 60 small steps
  assert.strictEqual(C.length, crawl.path.length);
  assert.ok(C[C.length - 1] <= G.CONFIG.SWING_MS + 1e-9, `a ${crawl.steps}-step swing lasts ${C[C.length - 1]}ms`);
  assert.ok(C.every((t, i) => !i || t > C[i - 1]));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
