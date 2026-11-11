/* Tests for js/brain.js — run with:  node tests/brain.test.js
 * No frameworks. Deterministic: every random draw comes from a seeded PRNG. */
'use strict';

// ───────────────────────── CONFIG ─────────────────────────
const SEED = 7;                 // seed for the learning test
const TRAIN_STEPS = 30000;      // practice steps on the default map
const RETRAIN_STEPS = 20000;    // practice steps after the bridge is placed
const LONG_WAY_MOVES = 13;      // shortest route around the river
const BRIDGE_MOVES = 5;         // shortest route once (3,1) is bridged
// ───────────────────────────────────────────────────────────

const assert = require('assert');
const path = require('path');
const B = require(path.join(__dirname, '..', 'js', 'brain.js'));

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

const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
/** rng stub returning a fixed sequence, then 0.99 forever */
function seq(values) { let i = 0; return () => (i < values.length ? values[i++] : 0.99); }
function envAt(world, x, y) {
  const env = B.createEnv(world);
  env.x = x; env.y = y;
  return env;
}

console.log('\nworld');

test('default map: start (0,1), bone (5,1), river at x=3 for y=0..4, ground at (3,5)', () => {
  const w = B.createWorld();
  assert.deepStrictEqual([w.width, w.height], [6, 6]);
  assert.deepStrictEqual(w.start, { x: 0, y: 1 });
  assert.deepStrictEqual(w.goal, { x: 5, y: 1 });
  for (let y = 0; y <= 4; y++) assert.strictEqual(B.cellAt(w, 3, y), B.CELL.GAP);
  assert.strictEqual(B.cellAt(w, 3, 5), B.CELL.GROUND);
  assert.strictEqual(B.cellAt(w, 0, 0), B.CELL.GROUND);
});

test('actions move up/right/down/left and cost -0.02 per step', () => {
  const w = B.createWorld();
  const env = B.createEnv(w);
  assert.deepStrictEqual([env.x, env.y], [0, 1]);
  let r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.deepStrictEqual([env.x, env.y], [1, 1]);
  assert.ok(Math.abs(r.reward - -0.02) < 1e-9);
  B.stepEnv(w, env, DOWN, seq([]));  assert.deepStrictEqual([env.x, env.y], [1, 2]);
  B.stepEnv(w, env, LEFT, seq([]));  assert.deepStrictEqual([env.x, env.y], [0, 2]);
  B.stepEnv(w, env, UP, seq([]));    assert.deepStrictEqual([env.x, env.y], [0, 1]);
  assert.strictEqual(r.terminal, false);
});

test('stepping into a gap gives -1 and ends the episode', () => {
  const w = B.createWorld();
  const env = envAt(w, 2, 1);
  const r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.strictEqual(r.reward, -1);
  assert.strictEqual(r.terminal, true);
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.event, 'fall');
});

test('reaching the bone gives +1 and ends the episode', () => {
  const w = B.createWorld();
  const env = envAt(w, 4, 1);
  const r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.strictEqual(r.reward, 1);
  assert.strictEqual(r.terminal, true);
  assert.strictEqual(r.event, 'goal');
});

test('walls and the map edge bump: stay in place, -0.05 penalty, not terminal', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'block', 1, 1), true);
  assert.strictEqual(B.cellAt(w, 1, 1), B.CELL.WALL);
  const env = B.createEnv(w);
  let r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.deepStrictEqual([env.x, env.y], [0, 1]);
  assert.ok(Math.abs(r.reward - (-0.02 - 0.05)) < 1e-9, `reward was ${r.reward}`);
  assert.strictEqual(r.terminal, false);
  assert.strictEqual(r.event, 'bump');
  r = B.stepEnv(w, env, LEFT, seq([]));       // off the map
  assert.deepStrictEqual([env.x, env.y], [0, 1]);
  assert.strictEqual(r.event, 'bump');
});

test('a block on a gap becomes a walkable bridge', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'block', 3, 1), true);
  assert.strictEqual(B.cellAt(w, 3, 1), B.CELL.BRIDGE);
  const env = envAt(w, 2, 1);
  const r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.deepStrictEqual([env.x, env.y], [3, 1]);
  assert.strictEqual(r.terminal, false);
});

test('moving off ice slips sideways when the roll is under 0.35, and not otherwise', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'ice', 1, 2), true);
  // roll 0.1 < 0.35 → slip; second draw 0.1 < 0.5 picks the first perpendicular
  let env = envAt(w, 1, 2);
  let r = B.stepEnv(w, env, RIGHT, seq([0.1, 0.1]));
  assert.strictEqual(r.slipped, true);
  assert.strictEqual(env.x, 1, 'a slip is perpendicular to RIGHT, so x is unchanged');
  assert.notStrictEqual(env.y, 2);
  // roll 0.9 → no slip
  env = envAt(w, 1, 2);
  r = B.stepEnv(w, env, RIGHT, seq([0.9]));
  assert.strictEqual(r.slipped, false);
  assert.deepStrictEqual([env.x, env.y], [2, 2]);
  // ground never slips, whatever the roll
  env = envAt(w, 1, 3);
  r = B.stepEnv(w, env, RIGHT, seq([0.0, 0.0]));
  assert.strictEqual(r.slipped, false);
});

test('ice slips roughly 35% of the time with a real PRNG', () => {
  const w = B.createWorld();
  B.applyTool(w, 'ice', 1, 3);
  const rng = B.mulberry32(3);
  let slips = 0;
  for (let i = 0; i < 4000; i++) {
    const env = envAt(w, 1, 3);
    if (B.stepEnv(w, env, RIGHT, rng).slipped) slips++;
  }
  const rate = slips / 4000;
  assert.ok(rate > 0.31 && rate < 0.39, `slip rate ${rate}`);
});

test('a treat pays +0.3, not again straight away, and is back after a reset', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'treat', 1, 1), true);
  const env = B.createEnv(w);
  let r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.ok(Math.abs(r.reward - 0.28) < 1e-9, `reward was ${r.reward}`);
  assert.strictEqual(r.event, 'treat');
  B.stepEnv(w, env, LEFT, seq([]));
  r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.ok(Math.abs(r.reward - -0.02) < 1e-9, 'a visit two steps later pays nothing extra');
  B.resetEnv(w, env);
  r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.ok(Math.abs(r.reward - 0.28) < 1e-9, 'treat is back in a new episode');
});

test('an eaten treat grows back 6 steps later, so treats can be farmed', () => {
  const w = B.createWorld();
  B.applyTool(w, 'treat', 1, 1);
  const env = B.createEnv(w);
  B.stepEnv(w, env, RIGHT, seq([]));                       // step 1: eaten
  assert.strictEqual(env.treats, 1);
  B.stepEnv(w, env, LEFT, seq([]));                        // 2
  B.stepEnv(w, env, UP, seq([])); B.stepEnv(w, env, DOWN, seq([]));   // 3, 4
  assert.strictEqual(B.features(w, 0, 1, env.eaten)[36 + RIGHT * 6 + 3], 0, 'still eaten at step 4');
  B.stepEnv(w, env, UP, seq([])); B.stepEnv(w, env, DOWN, seq([]));   // 5, 6
  const r = B.stepEnv(w, env, RIGHT, seq([]));             // 7 = 1 + TREAT_RESPAWN
  assert.strictEqual(B.CONFIG.TREAT_RESPAWN, 6);
  assert.strictEqual(r.event, 'treat');
  assert.ok(Math.abs(r.reward - 0.28) < 1e-9, `reward was ${r.reward}`);
  assert.strictEqual(env.treats, 2, 'env.treats counts every treat eaten this episode');
  B.resetEnv(w, env);
  assert.strictEqual(env.treats, 0);
});

test('mud is walkable and costs an extra -0.08 to step into', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'mud', 1, 1), true);
  assert.strictEqual(B.cellAt(w, 1, 1), B.CELL.MUD);
  const env = B.createEnv(w);
  let r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.deepStrictEqual([env.x, env.y], [1, 1]);
  assert.ok(Math.abs(r.reward - (-0.02 - 0.08)) < 1e-9, `reward was ${r.reward}`);
  assert.strictEqual(r.mud, true);
  assert.strictEqual(r.terminal, false);
  r = B.stepEnv(w, env, RIGHT, seq([0.0, 0.0]));           // leaving mud: normal cost, never slips
  assert.ok(Math.abs(r.reward - -0.02) < 1e-9);
  assert.strictEqual(r.slipped, false);
});

test('the small bone ends the episode for +0.4; the big bone still pays +1', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'bone', 1, 1), true);
  const env = B.createEnv(w);
  const r = B.stepEnv(w, env, RIGHT, seq([]));
  assert.strictEqual(r.reward, 0.4);
  assert.strictEqual(r.terminal, true);
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.event, 'small');
  assert.strictEqual(B.stepEnv(w, envAt(w, 4, 1), RIGHT, seq([])).reward, 1);
});

test('50 steps without an ending is a timeout: done, but NOT terminal', () => {
  const w = B.createWorld();
  const env = B.createEnv(w);
  let r;
  for (let i = 0; i < 49; i++) {
    r = B.stepEnv(w, env, i % 2 ? UP : DOWN, seq([]));
    assert.strictEqual(r.done, false, `step ${i + 1} should not end the episode`);
  }
  r = B.stepEnv(w, env, UP, seq([]));
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.terminal, false);
  assert.strictEqual(r.event, 'timeout');
});

console.log('\nvisitor tools');

test('nothing can be placed on the start or the bone', () => {
  const w = B.createWorld();
  const v = w.version;
  for (const tool of ['block', 'treat', 'ice', 'mud', 'bone', 'erase']) {
    assert.strictEqual(B.applyTool(w, tool, 0, 1), false, `${tool} on start`);
    assert.strictEqual(B.applyTool(w, tool, 5, 1), false, `${tool} on bone`);
  }
  assert.strictEqual(w.version, v);
});

test('every map change bumps world.version; a no-op does not', () => {
  const w = B.createWorld();
  const v = w.version;
  B.applyTool(w, 'block', 2, 2);
  assert.strictEqual(w.version, v + 1);
  assert.strictEqual(B.applyTool(w, 'block', 2, 2), false, 'already a wall');
  assert.strictEqual(w.version, v + 1);
  B.applyTool(w, 'treat', 1, 4);
  assert.strictEqual(w.version, v + 2);
});

test('erase undoes pieces but cannot fill the default river', () => {
  const w = B.createWorld();
  B.applyTool(w, 'block', 2, 2); B.applyTool(w, 'erase', 2, 2);
  assert.strictEqual(B.cellAt(w, 2, 2), B.CELL.GROUND);
  B.applyTool(w, 'block', 3, 2); B.applyTool(w, 'erase', 3, 2);
  assert.strictEqual(B.cellAt(w, 3, 2), B.CELL.GAP);
  B.applyTool(w, 'ice', 1, 1); B.applyTool(w, 'erase', 1, 1);
  assert.strictEqual(B.cellAt(w, 1, 1), B.CELL.GROUND);
  B.applyTool(w, 'treat', 4, 4);
  assert.strictEqual(B.hasTreat(w, 4, 4), true);
  B.applyTool(w, 'erase', 4, 4);
  assert.strictEqual(B.hasTreat(w, 4, 4), false);
  assert.strictEqual(B.applyTool(w, 'erase', 3, 0), false);
  assert.strictEqual(B.cellAt(w, 3, 0), B.CELL.GAP);
  B.applyTool(w, 'mud', 1, 2); B.applyTool(w, 'erase', 1, 2);
  assert.strictEqual(B.cellAt(w, 1, 2), B.CELL.GROUND);
  B.applyTool(w, 'bone', 4, 3); B.applyTool(w, 'erase', 4, 3);
  assert.strictEqual(w.small, -1);
});

test('there is at most one small bone: placing a second moves it', () => {
  const w = B.createWorld();
  B.applyTool(w, 'bone', 1, 4);
  assert.strictEqual(w.small, B.cellKey(1, 4));
  assert.strictEqual(B.applyTool(w, 'bone', 1, 4), false, 'already there');
  assert.strictEqual(B.applyTool(w, 'bone', 4, 4), true);
  assert.strictEqual(w.small, B.cellKey(4, 4));
  assert.strictEqual(B.applyTool(w, 'treat', 4, 4), false, 'one item per tile');
  assert.strictEqual(B.applyTool(w, 'bone', 3, 0), false, 'not on a gap');
  B.applyTool(w, 'block', 4, 4);
  assert.strictEqual(w.small, -1, 'a wall on top removes it');
});

test('mud only goes on ground, like ice', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'mud', 3, 0), false);
  B.applyTool(w, 'ice', 2, 2);
  assert.strictEqual(B.applyTool(w, 'mud', 2, 2), false);
  assert.strictEqual(B.applyTool(w, 'mud', 2, 3), true);
  assert.strictEqual(B.applyTool(w, 'treat', 2, 3), true, 'treats can sit on mud');
});

test('ice only goes on ground; treats never go on gaps or walls', () => {
  const w = B.createWorld();
  assert.strictEqual(B.applyTool(w, 'ice', 3, 0), false);
  assert.strictEqual(B.applyTool(w, 'treat', 3, 0), false);
  B.applyTool(w, 'block', 2, 2);
  assert.strictEqual(B.applyTool(w, 'treat', 2, 2), false);
  assert.strictEqual(B.applyTool(w, 'ice', 2, 2), false);
});

test('resetWorld restores the default terrain and bumps the version', () => {
  const w = B.createWorld();
  B.applyTool(w, 'block', 3, 1); B.applyTool(w, 'treat', 1, 1); B.applyTool(w, 'ice', 2, 4);
  B.applyTool(w, 'mud', 1, 4); B.applyTool(w, 'bone', 4, 4);
  const v = w.version;
  B.resetWorld(w);
  assert.strictEqual(B.cellAt(w, 3, 1), B.CELL.GAP);
  assert.strictEqual(B.cellAt(w, 2, 4), B.CELL.GROUND);
  assert.strictEqual(B.hasTreat(w, 1, 1), false);
  assert.strictEqual(B.cellAt(w, 1, 4), B.CELL.GROUND);
  assert.strictEqual(w.small, -1);
  assert.ok(w.version > v);
});

console.log('\nfeatures and network');

test('state is 61 numbers: one-hot position, 4x6 neighbour flags, on-ice flag', () => {
  const w = B.createWorld();
  B.applyTool(w, 'treat', 2, 2);
  B.applyTool(w, 'ice', 2, 0);
  const f = B.features(w, 2, 1, new Set());
  assert.strictEqual(f.length, 61);
  assert.strictEqual(B.N_IN, 61);
  let ones = 0;
  for (let i = 0; i < 36; i++) ones += f[i];
  assert.strictEqual(ones, 1);
  assert.strictEqual(f[1 * 6 + 2], 1, 'position one-hot at y*6+x');
  const at = (dir, k) => f[36 + dir * 6 + k];   // k: 0 gap, 1 blocked, 2 ice, 3 treat, 4 mud, 5 small bone
  assert.strictEqual(at(RIGHT, 0), 1, 'gap to the right');
  assert.strictEqual(at(UP, 2), 1, 'ice above');
  assert.strictEqual(at(DOWN, 3), 1, 'treat below');
  assert.strictEqual(at(LEFT, 0) + at(LEFT, 1) + at(LEFT, 2) + at(LEFT, 3), 0);
  assert.strictEqual(f[60], 0);
  // eaten treats disappear from the features; standing on ice sets the flag
  assert.strictEqual(B.features(w, 2, 1, new Set([B.cellKey(2, 2)]))[36 + DOWN * 6 + 3], 0);
  assert.strictEqual(B.features(w, 2, 0, new Set())[60], 1);
  // out of bounds counts as blocked
  assert.strictEqual(B.features(w, 0, 0, new Set())[36 + UP * 6 + 1], 1);
});

test('mud and the small bone each have a flag per direction; every input sits in exactly one group', () => {
  const w = B.createWorld();
  B.applyTool(w, 'mud', 1, 1);
  B.applyTool(w, 'bone', 0, 2);
  const f = B.features(w, 0, 1, new Set());
  assert.strictEqual(f[36 + RIGHT * 6 + 4], 1, 'mud to the right');
  assert.strictEqual(f[36 + RIGHT * 6 + 2], 0, 'mud is not ice');
  assert.strictEqual(f[36 + DOWN * 6 + 5], 1, 'small bone below');
  assert.strictEqual(f[36 + UP * 6 + 4] + f[36 + UP * 6 + 5], 0);
  assert.ok(B.FEATURE_GROUPS.length <= 6);
  const all = B.FEATURE_GROUPS.flatMap(g => g.indices).sort((a, b) => a - b);
  assert.deepStrictEqual(all, Array.from({ length: 61 }, (_, i) => i));
});

test('stuck signal: attempts since a bone was last reached; either bone or reset() clears it', () => {
  const w = B.createWorld();
  const b = B.createBrain(w, { rng: B.mulberry32(4) });
  assert.strictEqual(b.attemptsSinceGoal, 0);
  assert.strictEqual(b.noteEpisode('fall'), 1);
  assert.strictEqual(b.noteEpisode('timeout'), 2);
  assert.strictEqual(b.noteEpisode('fall'), 3);
  assert.strictEqual(b.noteEpisode('goal'), 0);
  b.noteEpisode('fall');
  assert.strictEqual(b.noteEpisode('small'), 0);
  b.noteEpisode('fall'); b.noteEpisode('fall');
  b.practice(50);
  assert.strictEqual(b.attemptsSinceGoal, 2, 'hidden practice does not touch it');
  b.reset();
  assert.strictEqual(b.attemptsSinceGoal, 0);
});

test('same seed, same brain: training is deterministic', () => {
  const run = () => {
    const w = B.createWorld();
    const b = B.createBrain(w, { rng: B.mulberry32(11) });
    b.practice(600);
    return Array.from(b.qValues(B.features(w, 0, 1, new Set())));
  };
  assert.deepStrictEqual(run(), run());
});

test('a fresh brain has 4 finite Q-values, epsilon 0.9 and no updates', () => {
  const w = B.createWorld();
  const b = B.createBrain(w, { rng: B.mulberry32(1) });
  const q = b.qValues(B.features(w, 0, 1, new Set()));
  assert.strictEqual(q.length, 4);
  for (const v of q) assert.ok(Number.isFinite(v));
  assert.strictEqual(b.epsilon, 0.9);
  assert.strictEqual(b.updates, 0);
});

test('epsilon decays with updates and never drops below 0.05', () => {
  const w = B.createWorld();
  const b = B.createBrain(w, { rng: B.mulberry32(2) });
  b.practice(400);
  assert.ok(b.updates > 0);
  assert.ok(b.epsilon < 0.9 && b.epsilon >= 0.05, `epsilon ${b.epsilon}`);
  assert.ok(Number.isFinite(b.lossEma) && b.lossEma >= 0);
  b.epsilon = 0.0500001;
  b.practice(200);
  assert.ok(b.epsilon >= 0.05);
});

test('a map change clears replay, lifts epsilon to >= 0.3, and keeps the weights', () => {
  const w = B.createWorld();
  const b = B.createBrain(w, { rng: B.mulberry32(5) });
  b.practice(500);
  b.epsilon = 0.06;
  // (5,5) is not next to the start, so the start state's features do not change
  const f = B.features(w, 0, 1, new Set());
  const before = Array.from(b.qValues(f));
  assert.ok(b.bufferSize > 0);
  B.applyTool(w, 'block', 5, 5);
  b.syncWorld();
  assert.strictEqual(b.bufferSize, 0);
  assert.ok(b.epsilon >= 0.3);
  assert.deepStrictEqual(Array.from(b.qValues(f)), before);
});

test('reset() reinitialises the network', () => {
  const w = B.createWorld();
  const b = B.createBrain(w, { rng: B.mulberry32(5) });
  const f = B.features(w, 0, 1, new Set());
  b.practice(800);
  const trained = Array.from(b.qValues(f));
  b.reset();
  assert.strictEqual(b.updates, 0);
  assert.strictEqual(b.epsilon, 0.9);
  assert.strictEqual(b.bufferSize, 0);
  assert.notDeepStrictEqual(Array.from(b.qValues(f)), trained);
});

test('plan() is a deterministic greedy rollout of at most 20 moves', () => {
  const w = B.createWorld();
  const b = B.createBrain(w, { rng: B.mulberry32(9) });
  const p1 = b.plan(0, 1), p2 = b.plan(0, 1);
  assert.deepStrictEqual(p1, p2);
  assert.deepStrictEqual(p1.path[0], { x: 0, y: 1 });
  assert.ok(p1.path.length - 1 <= 20);
  assert.strictEqual(typeof p1.reachedGoal, 'boolean');
});

test('valueMap() gives one number per cell; miniView() describes the little network', () => {
  const w = B.createWorld();
  const b = B.createBrain(w, { rng: B.mulberry32(9) });
  const v = b.valueMap();
  assert.strictEqual(v.length, 36);
  for (const x of v) assert.ok(Number.isFinite(x));
  const m = b.miniView(B.features(w, 0, 1, new Set()));
  assert.strictEqual(m.hidden.length, 6);
  assert.strictEqual(m.inEdges.length, B.FEATURE_GROUPS.length);
  assert.strictEqual(m.inEdges.length, 5);
  assert.strictEqual(m.inEdges[0].length, 6);
  assert.strictEqual(m.outEdges.length, 6);
  assert.strictEqual(m.outEdges[0].length, 4);
  assert.strictEqual(m.q.length, 4);
});

console.log('\nlearning (seed ' + SEED + ')');

const world = B.createWorld();
const brain = B.createBrain(world, { rng: B.mulberry32(SEED) });
let longWay = null;

test('an untrained dog does not find the bone', () => {
  assert.strictEqual(brain.plan(0, 1).reachedGoal, false);
});

test(`after ${TRAIN_STEPS} practice steps the greedy dog walks the long way round to the bone`, () => {
  brain.practice(TRAIN_STEPS);
  longWay = brain.plan(0, 1);
  const moves = longWay.path.length - 1;
  console.log(`        updates ${brain.updates} · epsilon ${brain.epsilon.toFixed(3)} · loss ema ${brain.lossEma.toFixed(4)} · moves ${moves}`);
  console.log(`        path ${longWay.path.map(p => `${p.x},${p.y}`).join(' ')}`);
  assert.strictEqual(longWay.reachedGoal, true, 'greedy rollout from the start must reach the bone');
  assert.ok(moves >= LONG_WAY_MOVES, 'there is no route shorter than 13 on the default map');
  assert.ok(longWay.path.some(p => p.x === 3 && p.y === 5), 'the only crossing is (3,5)');
});

test('the learned values rise along the route toward the bone', () => {
  const v = brain.valueMap();
  const at = (x, y) => v[y * 6 + x];
  assert.ok(at(4, 1) > at(0, 1), `V(4,1)=${at(4, 1).toFixed(3)} should beat V(0,1)=${at(0, 1).toFixed(3)}`);
  assert.ok(at(4, 1) > 0.8, `V next to the bone is ${at(4, 1).toFixed(3)}`);
});

test(`after a bridge at (3,1) and ${RETRAIN_STEPS} more steps the greedy path is shorter and crosses it`, () => {
  const updatesBefore = brain.updates;
  assert.strictEqual(B.applyTool(world, 'block', 3, 1), true);
  brain.practice(RETRAIN_STEPS);            // practice() notices the new world.version itself
  const short = brain.plan(0, 1);
  const moves = short.path.length - 1;
  console.log(`        updates +${brain.updates - updatesBefore} · epsilon ${brain.epsilon.toFixed(3)} · loss ema ${brain.lossEma.toFixed(4)} · moves ${moves}`);
  console.log(`        path ${short.path.map(p => `${p.x},${p.y}`).join(' ')}`);
  assert.strictEqual(short.reachedGoal, true);
  assert.ok(moves < longWay.path.length - 1, `expected fewer than ${longWay.path.length - 1} moves, got ${moves}`);
  assert.ok(short.path.some(p => p.x === 3 && p.y === 1), 'path should use the bridge');
  assert.ok(moves >= BRIDGE_MOVES);
});

test('with the bridge in, a small bone next to the start loses to the big one 5 moves away', () => {
  assert.strictEqual(B.applyTool(world, 'bone', 0, 2), true);
  brain.practice(RETRAIN_STEPS);
  const p = brain.plan(0, 1);
  console.log(`        outcome ${p.outcome} · moves ${p.path.length - 1} · Q at start ${Array.from(brain.qValues(B.features(world, 0, 1, new Set()))).map(v => v.toFixed(2)).join(' ')}`);
  assert.strictEqual(p.outcome, 'goal', '0.95^4 - step costs is about 0.74, which beats 0.4');
});

test('a treat ring far from the bone gets farmed: 4+ treats in one greedy episode (reward hacking)', () => {
  const w = B.createWorld();
  [[0, 2], [1, 2], [1, 3], [0, 3]].forEach(([x, y]) => B.applyTool(w, 'treat', x, y));
  const b = B.createBrain(w, { rng: B.mulberry32(SEED) });
  b.practice(TRAIN_STEPS);
  b.epsilon = 0;
  const env = B.createEnv(w), rng = B.mulberry32(1);
  let res = { done: false };
  while (!res.done) res = B.stepEnv(w, env, b.act(B.features(w, env.x, env.y, env.eaten)).action, rng);
  console.log(`        ended by ${res.event} after ${env.steps} steps with ${env.treats} treats`);
  assert.ok(env.treats >= 4, `ate ${env.treats}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
