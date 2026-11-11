/* brain.js — the dog's world and the dog's brain. No DOM in here.
 *
 * World:  a 6x6 gridworld with gaps, walls, bridges, ice, mud, treats and a small bone.
 * Brain:  a small DQN written by hand (61 → 24 ReLU → 4), Adam, replay buffer,
 *         target network, epsilon-greedy exploration, parallel practice envs.
 *
 * Browser:  window.DogBrain      Node:  require('./js/brain.js')
 */
(function (root) {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var CONFIG = {
    // world
    GRID: 6,
    START: { x: 0, y: 1 },
    GOAL: { x: 5, y: 1 },
    RIVER_X: 3,               // default terrain: gaps at x = RIVER_X …
    RIVER_Y_FROM: 0,          // … for y from here …
    RIVER_Y_TO: 4,            // … to here (inclusive). (3,5) stays ground.
    MAX_STEPS: 50,            // then the episode times out
    SLIP_PROB: 0.35,          // chance of sliding sideways when leaving ice

    // rewards
    R_STEP: -0.02,
    R_GOAL: 1,
    R_GAP: -1,
    R_BUMP: -0.05,            // added to the step cost
    R_TREAT: 0.3,             // added to the step cost; the treat grows back after TREAT_RESPAWN steps
    TREAT_RESPAWN: 6,         // short enough that a ring of treats can be farmed (reward hacking)
    R_MUD: -0.08,             // added to the step cost when stepping into mud
    R_SMALL: 0.4,             // the small bone: ends the episode like the big one, for less

    // learning
    HIDDEN: 24,
    LEARNING_RATE: 0.005,
    GAMMA: 0.95,
    REPLAY_SIZE: 3000,
    BATCH_SIZE: 16,
    TARGET_SYNC: 150,         // copy online → target every N updates
    EPS_START: 0.9,
    EPS_MIN: 0.05,
    EPS_DECAY: 0.9997,        // multiplied in after every update
    EPS_ON_MAP_CHANGE: 0.3,   // epsilon is lifted to at least this when the map changes
    TD_CLIP: 1,               // TD error is clipped to [-1, 1]
    PRACTICE_ENVS: 4,         // hidden practice dogs sharing one network + buffer
    LOSS_EMA: 0.98,
    PLAN_STEPS: 20,           // longest greedy rollout drawn as "the plan"
    ADAM_B1: 0.9,
    ADAM_B2: 0.999,
    ADAM_EPS: 1e-8
  };
  // ═══════════════════════════════════════════════════════════════════════════

  var CELL = { GROUND: 0, GAP: 1, WALL: 2, BRIDGE: 3, ICE: 4, MUD: 5 };
  //            up(y-1)  right(x+1)  down(y+1)  left(x-1)
  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];
  var N_POS = CONFIG.GRID * CONFIG.GRID;      // 36
  var N_DIR = 6;                              // flags per direction, see "state features"
  var N_IN = N_POS + 4 * N_DIR + 1;           // 61
  var N_OUT = 4;

  /** Small seedable PRNG. Returns a function giving floats in [0, 1). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cellKey(x, y) { return y * CONFIG.GRID + x; }

  // ─────────────────────────────── world ───────────────────────────────

  function isDefaultGap(x, y) {
    return x === CONFIG.RIVER_X && y >= CONFIG.RIVER_Y_FROM && y <= CONFIG.RIVER_Y_TO;
  }

  function fillDefault(world) {
    for (var y = 0; y < world.height; y++) {
      for (var x = 0; x < world.width; x++) {
        world.cells[cellKey(x, y)] = isDefaultGap(x, y) ? CELL.GAP : CELL.GROUND;
      }
    }
    world.treats.clear();
    world.small = -1;
  }

  function createWorld() {
    var world = {
      width: CONFIG.GRID,
      height: CONFIG.GRID,
      start: { x: CONFIG.START.x, y: CONFIG.START.y },
      goal: { x: CONFIG.GOAL.x, y: CONFIG.GOAL.y },
      cells: new Uint8Array(N_POS),
      treats: new Set(),
      small: -1,                 // cell key of the small bone, or -1
      version: 0
    };
    fillDefault(world);
    return world;
  }

  /** Back to the default terrain. Counts as a map change. */
  function resetWorld(world) {
    fillDefault(world);
    world.version++;
  }

  function inBounds(world, x, y) {
    return x >= 0 && y >= 0 && x < world.width && y < world.height;
  }

  /** Cell type at (x, y); out of bounds reads as a wall. */
  function cellAt(world, x, y) {
    return inBounds(world, x, y) ? world.cells[cellKey(x, y)] : CELL.WALL;
  }

  function hasTreat(world, x, y) { return world.treats.has(cellKey(x, y)); }

  function isSpecial(world, x, y) {
    return (x === world.start.x && y === world.start.y) || (x === world.goal.x && y === world.goal.y);
  }

  /** What a tool would do at (x, y) without doing it. Returns true if it would change the map. */
  function canApplyTool(world, tool, x, y) {
    if (!inBounds(world, x, y) || isSpecial(world, x, y)) return false;
    var c = world.cells[cellKey(x, y)];
    var treat = hasTreat(world, x, y), small = world.small === cellKey(x, y);
    var walkable = c !== CELL.GAP && c !== CELL.WALL;
    switch (tool) {
      case 'block': return c !== CELL.WALL && c !== CELL.BRIDGE;
      case 'ice': case 'mud': return c === CELL.GROUND;
      case 'treat': case 'bone': return !treat && !small && walkable;   // one item per tile
      case 'erase': return treat || small || c !== CELL.GROUND && c !== CELL.GAP;
      default: return false;
    }
  }

  /** Visitor tools: 'block' | 'treat' | 'ice' | 'mud' | 'bone' | 'erase'. Returns true if the map changed. */
  function applyTool(world, tool, x, y) {
    if (!canApplyTool(world, tool, x, y)) return false;
    var k = cellKey(x, y);
    var c = world.cells[k];
    if (tool === 'block') {
      world.cells[k] = c === CELL.GAP ? CELL.BRIDGE : CELL.WALL;
      if (world.cells[k] === CELL.WALL) {
        world.treats.delete(k);
        if (world.small === k) world.small = -1;
      }
    } else if (tool === 'ice' || tool === 'mud') {
      world.cells[k] = tool === 'ice' ? CELL.ICE : CELL.MUD;
    } else if (tool === 'treat') {
      world.treats.add(k);
    } else if (tool === 'bone') {
      world.small = k;                               // only one: placing it again moves it
    } else if (tool === 'erase') {
      if (world.treats.has(k)) world.treats.delete(k);
      else if (world.small === k) world.small = -1;
      else if (c === CELL.WALL || c === CELL.ICE || c === CELL.MUD) world.cells[k] = CELL.GROUND;
      else if (c === CELL.BRIDGE) world.cells[k] = CELL.GAP;
    }
    world.version++;
    return true;
  }

  // ─────────────────────────────── episodes ───────────────────────────────

  function createEnv(world) {
    // eaten: treat cell key → the step it was eaten on;  treats: how many were eaten this episode
    return { x: world.start.x, y: world.start.y, steps: 0, eaten: new Map(), treats: 0, done: false };
  }

  function resetEnv(world, env) {
    env.x = world.start.x; env.y = world.start.y;
    env.steps = 0; env.done = false; env.treats = 0;
    env.eaten.clear();
    return env;
  }

  /**
   * Advance one step. Mutates env.
   * Returns { reward, terminal, done, event, slipped, bumped, treat, mud, action }.
   *   terminal — the episode really ended (a bone or a gap): no bootstrapping.
   *   done     — terminal, or the step limit was hit (timeout: still bootstraps).
   *   event    — 'goal' | 'small' | 'fall' | 'timeout' | 'bump' | 'treat' | null
   *   action   — the move that actually happened (differs from the request on a slip).
   */
  function stepEnv(world, env, action, rng) {
    var out = { reward: CONFIG.R_STEP, terminal: false, done: false, event: null,
                slipped: false, bumped: false, treat: false, mud: false, action: action };
    env.steps++;
    env.eaten.forEach(function (at, key) {           // treats grow back
      if (env.steps - at >= CONFIG.TREAT_RESPAWN) env.eaten.delete(key);
    });

    if (cellAt(world, env.x, env.y) === CELL.ICE && rng() < CONFIG.SLIP_PROB) {
      out.slipped = true;
      out.action = action = (action + (rng() < 0.5 ? 1 : 3)) % 4;
    }

    var nx = env.x + DX[action], ny = env.y + DY[action];
    var c = cellAt(world, nx, ny);

    if (c === CELL.WALL) {
      out.bumped = true;
      out.reward += CONFIG.R_BUMP;
      out.event = 'bump';
    } else {
      env.x = nx; env.y = ny;
      if (c === CELL.GAP) {
        out.reward = CONFIG.R_GAP;
        out.terminal = true;
        out.event = 'fall';
      } else if (nx === world.goal.x && ny === world.goal.y) {
        out.reward = CONFIG.R_GOAL;
        out.terminal = true;
        out.event = 'goal';
      } else {
        var k = cellKey(nx, ny);
        if (c === CELL.MUD) { out.mud = true; out.reward += CONFIG.R_MUD; }
        if (k === world.small) {
          out.reward = CONFIG.R_SMALL;
          out.terminal = true;
          out.event = 'small';
        } else if (world.treats.has(k) && !env.eaten.has(k)) {
          env.eaten.set(k, env.steps);
          env.treats++;
          out.treat = true;
          out.reward += CONFIG.R_TREAT;
          out.event = 'treat';
        }
      }
    }

    if (out.terminal) {
      out.done = true;
    } else if (env.steps >= CONFIG.MAX_STEPS) {
      out.done = true;
      out.event = 'timeout';
    }
    env.done = out.done;
    return out;
  }

  // ─────────────────────────────── state features ───────────────────────────────
  // [0..35]   one-hot position (y*6 + x)
  // [36..59]  for each direction d (up, right, down, left):
  //             36+d*6+0 gap next · +1 blocked next (wall / edge) · +2 ice next · +3 uneaten treat next
  //             · +4 mud next · +5 small bone next
  // [60]      standing on ice

  var FEATURE_GROUPS = [
    { key: 'position', label: 'where am i', indices: [] },
    { key: 'obstacles', label: 'walls (rude)', indices: [] },
    { key: 'terrain', label: 'slippery? mud?', indices: [] },
    { key: 'treats', label: 'snacks?', indices: [] },
    { key: 'small', label: 'small bone?', indices: [] }
  ];
  (function () {
    var i, d;
    for (i = 0; i < N_POS; i++) FEATURE_GROUPS[0].indices.push(i);
    for (d = 0; d < 4; d++) {
      var b = N_POS + d * N_DIR;
      FEATURE_GROUPS[1].indices.push(b, b + 1);
      FEATURE_GROUPS[2].indices.push(b + 2, b + 4);
      FEATURE_GROUPS[3].indices.push(b + 3);
      FEATURE_GROUPS[4].indices.push(b + 5);
    }
    FEATURE_GROUPS[2].indices.push(N_IN - 1);
  })();

  function features(world, x, y, eaten, out) {
    var f = out || new Float32Array(N_IN);
    if (out) f.fill(0);
    f[cellKey(x, y)] = 1;
    for (var d = 0; d < 4; d++) {
      var nx = x + DX[d], ny = y + DY[d];
      var c = cellAt(world, nx, ny);
      var base = N_POS + d * N_DIR;
      if (c === CELL.GAP) f[base] = 1;
      else if (c === CELL.WALL) f[base + 1] = 1;
      else {
        if (c === CELL.ICE) f[base + 2] = 1;
        else if (c === CELL.MUD) f[base + 4] = 1;
        var k = cellKey(nx, ny);
        if (world.treats.has(k) && !(eaten && eaten.has(k))) f[base + 3] = 1;
        if (k === world.small) f[base + 5] = 1;
      }
    }
    if (cellAt(world, x, y) === CELL.ICE) f[N_IN - 1] = 1;
    return f;
  }

  // ─────────────────────────────── network ───────────────────────────────

  function gaussian(rng) {
    var u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function createNet(H, rng) {
    var net = {
      W1: new Float64Array(H * N_IN), b1: new Float64Array(H),
      W2: new Float64Array(N_OUT * H), b2: new Float64Array(N_OUT)
    };
    var s1 = Math.sqrt(2 / N_IN), s2 = Math.sqrt(2 / H), i;   // He init
    for (i = 0; i < net.W1.length; i++) net.W1[i] = gaussian(rng) * s1;
    for (i = 0; i < net.W2.length; i++) net.W2[i] = gaussian(rng) * s2;
    return net;
  }

  function copyNet(from, to) {
    to.W1.set(from.W1); to.b1.set(from.b1); to.W2.set(from.W2); to.b2.set(from.b2);
  }

  /** Forward pass. Fills h (hidden activations) and q (4 Q-values). */
  function forward(net, H, f, h, q) {
    var j, i, a, s;
    for (j = 0; j < H; j++) h[j] = net.b1[j];
    for (i = 0; i < N_IN; i++) {
      var v = f[i];
      if (v === 0) continue;                       // inputs are sparse 0/1 flags
      for (j = 0; j < H; j++) h[j] += net.W1[j * N_IN + i] * v;
    }
    for (j = 0; j < H; j++) if (h[j] < 0) h[j] = 0; // ReLU
    for (a = 0; a < N_OUT; a++) {
      s = net.b2[a];
      for (j = 0; j < H; j++) s += net.W2[a * H + j] * h[j];
      q[a] = s;
    }
  }

  function argmax(q) {
    var best = 0;
    for (var a = 1; a < q.length; a++) if (q[a] > q[best]) best = a;
    return best;
  }

  // ─────────────────────────────── brain (DQN agent) ───────────────────────────────

  /**
   * createBrain(world, { rng, config })
   *   rng    — function returning floats in [0,1). Pass mulberry32(seed) for repeatable runs.
   *   config — optional overrides for the learning entries of CONFIG.
   */
  function createBrain(world, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var cfg = {};
    var key;
    for (key in CONFIG) cfg[key] = CONFIG[key];
    if (opts.config) for (key in opts.config) cfg[key] = opts.config[key];
    var H = cfg.HIDDEN;

    var online, target, adam;
    var grads = { W1: new Float64Array(H * N_IN), b1: new Float64Array(H),
                  W2: new Float64Array(N_OUT * H), b2: new Float64Array(N_OUT) };
    var PARAMS = ['W1', 'b1', 'W2', 'b2'];

    // replay buffer (ring)
    var cap = cfg.REPLAY_SIZE;
    var bufS = new Float32Array(cap * N_IN), bufS2 = new Float32Array(cap * N_IN);
    var bufA = new Uint8Array(cap), bufR = new Float32Array(cap), bufT = new Uint8Array(cap);
    var bufLen = 0, bufPos = 0;

    // scratch
    var h = new Float64Array(H), q = new Float64Array(N_OUT);
    var h2 = new Float64Array(H), q2 = new Float64Array(N_OUT);
    var dh = new Float64Array(H);
    var fA = new Float32Array(N_IN), fB = new Float32Array(N_IN);

    var envs = [], envCursor = 0;
    var seenVersion = world.version;
    var miniIdx = null, miniIdxAt = -1;
    var lrSince = 0;

    var brain = {
      epsilon: cfg.EPS_START,
      updates: 0,          // gradient updates
      steps: 0,            // environment steps seen (practice + visible)
      episodes: 0,         // practice episodes finished
      lossEma: 0,
      bufferSize: 0,
      attemptsSinceGoal: 0,   // the stuck signal, fed by noteEpisode()
      config: cfg
    };

    function init() {
      online = createNet(H, rng);
      target = createNet(H, rng);
      copyNet(online, target);
      adam = { t: 0, m: {}, v: {} };
      PARAMS.forEach(function (p) {
        adam.m[p] = new Float64Array(online[p].length);
        adam.v[p] = new Float64Array(online[p].length);
      });
      bufLen = 0; bufPos = 0;
      envs = [];
      for (var i = 0; i < cfg.PRACTICE_ENVS; i++) envs.push(createEnv(world));
      envCursor = 0;
      seenVersion = world.version;
      miniIdx = null; miniIdxAt = -1; lrSince = 0;
      brain.epsilon = cfg.EPS_START;
      brain.updates = 0; brain.steps = 0; brain.episodes = 0;
      brain.lossEma = 0; brain.bufferSize = 0; brain.attemptsSinceGoal = 0;
    }

    /** Stuck signal: report how a watched episode ended; returns attempts since a bone was last reached. */
    brain.noteEpisode = function (event) {
      brain.attemptsSinceGoal = event === 'goal' || event === 'small' ? 0 : brain.attemptsSinceGoal + 1;
      return brain.attemptsSinceGoal;
    };

    /** New day: forget everything. */
    brain.reset = function () { init(); };

    /** Call after the map may have changed. Stale memories go, exploration comes back, weights stay. */
    brain.syncWorld = function () {
      if (world.version === seenVersion) return false;
      seenVersion = world.version;
      lrSince = brain.updates;
      bufLen = 0; bufPos = 0; brain.bufferSize = 0;
      if (brain.epsilon < cfg.EPS_ON_MAP_CHANGE) brain.epsilon = cfg.EPS_ON_MAP_CHANGE;
      for (var i = 0; i < envs.length; i++) resetEnv(world, envs[i]);
      return true;
    };

    /** Q-values for a feature vector. Returns a fresh Float64Array(4). */
    brain.qValues = function (f) {
      var out = new Float64Array(N_OUT);
      forward(online, H, f, h, out);
      return out;
    };

    /** Epsilon-greedy choice. Returns { action, explored, q, greedy }. */
    brain.act = function (f) {
      var qs = brain.qValues(f);
      var greedy = argmax(qs);
      if (rng() < brain.epsilon) {
        return { action: Math.floor(rng() * 4) % 4, explored: true, q: qs, greedy: greedy };
      }
      return { action: greedy, explored: false, q: qs, greedy: greedy };
    };

    /** Store one transition. terminal=true means "do not bootstrap from s2". */
    brain.remember = function (s, a, r, s2, terminal) {
      bufS.set(s, bufPos * N_IN);
      bufS2.set(s2, bufPos * N_IN);
      bufA[bufPos] = a; bufR[bufPos] = r; bufT[bufPos] = terminal ? 1 : 0;
      bufPos = (bufPos + 1) % cap;
      if (bufLen < cap) bufLen++;
      brain.bufferSize = bufLen;
      brain.steps++;
    };

    /** One minibatch update (no-op until the buffer holds a batch). Returns the batch loss or null. */
    brain.trainStep = function () {
      var B = cfg.BATCH_SIZE;
      if (bufLen < B) return null;
      var p, i, j, a, b;
      for (p = 0; p < 4; p++) grads[PARAMS[p]].fill(0);
      var loss = 0;

      for (b = 0; b < B; b++) {
        var idx = Math.floor(rng() * bufLen) % bufLen;
        var s = bufS.subarray(idx * N_IN, (idx + 1) * N_IN);
        var s2 = bufS2.subarray(idx * N_IN, (idx + 1) * N_IN);
        var act = bufA[idx];

        var y = bufR[idx];
        if (!bufT[idx]) {
          forward(target, H, s2, h2, q2);
          var best = argmax(q2);
          if (cfg.DOUBLE) { forward(online, H, s2, h, q); best = argmax(q); }
          y += cfg.GAMMA * q2[best];
        }
        forward(online, H, s, h, q);
        var td = q[act] - y;
        loss += td * td;
        if (td > cfg.TD_CLIP) td = cfg.TD_CLIP; else if (td < -cfg.TD_CLIP) td = -cfg.TD_CLIP;
        var g = td / B;

        // backprop: only the taken action's output has a gradient
        grads.b2[act] += g;
        for (j = 0; j < H; j++) {
          grads.W2[act * H + j] += g * h[j];
          dh[j] = h[j] > 0 ? g * online.W2[act * H + j] : 0;
          grads.b1[j] += dh[j];
        }
        for (i = 0; i < N_IN; i++) {
          var v = s[i];
          if (v === 0) continue;
          for (j = 0; j < H; j++) grads.W1[j * N_IN + i] += dh[j] * v;
        }
      }

      // Adam
      adam.t++;
      var c1 = 1 - Math.pow(cfg.ADAM_B1, adam.t), c2 = 1 - Math.pow(cfg.ADAM_B2, adam.t);
      var lr = cfg.LR_DECAY ? Math.max(cfg.LR_MIN, cfg.LEARNING_RATE * Math.pow(cfg.LR_DECAY, brain.updates - lrSince)) : cfg.LEARNING_RATE;
      for (p = 0; p < 4; p++) {
        var w = online[PARAMS[p]], gr = grads[PARAMS[p]], m = adam.m[PARAMS[p]], vv = adam.v[PARAMS[p]];
        for (i = 0; i < w.length; i++) {
          m[i] = cfg.ADAM_B1 * m[i] + (1 - cfg.ADAM_B1) * gr[i];
          vv[i] = cfg.ADAM_B2 * vv[i] + (1 - cfg.ADAM_B2) * gr[i] * gr[i];
          w[i] -= lr * (m[i] / c1) / (Math.sqrt(vv[i] / c2) + cfg.ADAM_EPS);
        }
      }

      loss /= B;
      brain.lossEma = brain.updates === 0 ? loss : cfg.LOSS_EMA * brain.lossEma + (1 - cfg.LOSS_EMA) * loss;
      brain.updates++;
      if (cfg.TAU) {
        for (p = 0; p < 4; p++) { var tw = target[PARAMS[p]], ow = online[PARAMS[p]]; for (i = 0; i < tw.length; i++) tw[i] += cfg.TAU * (ow[i] - tw[i]); }
      } else if (brain.updates % cfg.TARGET_SYNC === 0) copyNet(online, target);
      brain.epsilon = Math.max(cfg.EPS_MIN, brain.epsilon * cfg.EPS_DECAY);
      return loss;
    };

    /**
     * Run n steps of hidden practice, spread round-robin over the parallel practice
     * environments. They all act with the same network and write to the same buffer.
     * One gradient update per step.
     */
    function startPractice(env) {
      resetEnv(world, env);
      if (env.wanderer) {
        for (var tries = 0; tries < 50; tries++) {
          var x = Math.floor(rng() * world.width) % world.width, y = Math.floor(rng() * world.height) % world.height;
          var c = cellAt(world, x, y);
          if (c !== CELL.GAP && c !== CELL.WALL && !(x === world.goal.x && y === world.goal.y) && cellKey(x, y) !== world.small) { env.x = x; env.y = y; break; }
        }
      }
    }

    brain.practice = function (n) {
      brain.syncWorld();
      for (var k = 0; k < n; k++) {
        var env = envs[envCursor];
        env.wanderer = envCursor < (cfg.WANDERERS || 0);
        envCursor = (envCursor + 1) % envs.length;
        features(world, env.x, env.y, env.eaten, fA);
        var choice = env.wanderer ? { action: Math.floor(rng() * 4) % 4 } : brain.act(fA);
        var res = stepEnv(world, env, choice.action, rng);
        features(world, env.x, env.y, env.eaten, fB);
        brain.remember(fA, choice.action, res.reward, fB, res.terminal);
        if (res.done) { startPractice(env); brain.episodes++; }
        brain.trainStep();
      }
    };

    /**
     * Greedy rollout from (x, y): what the dog would do with no exploration and no slipping.
     * Returns { path: [{x,y}, …], reachedGoal, outcome: 'goal' | 'small' | 'fall' | 'stuck' | 'loop' | 'far' }.
     * reachedGoal is true for either bone. Treats do not grow back inside a plan.
     */
    brain.plan = function (x, y, eaten) {
      var ate = new Set(eaten ? eaten.keys() : []);
      var path = [{ x: x, y: y }];
      var seen = new Set([cellKey(x, y) + ':' + ate.size]);
      var outcome = 'far';
      for (var i = 0; i < cfg.PLAN_STEPS; i++) {
        features(world, x, y, ate, fA);
        forward(online, H, fA, h, q);
        var a = argmax(q);
        var nx = x + DX[a], ny = y + DY[a];
        var c = cellAt(world, nx, ny);
        if (c === CELL.WALL) { outcome = 'stuck'; break; }
        x = nx; y = ny;
        path.push({ x: x, y: y });
        if (c === CELL.GAP) { outcome = 'fall'; break; }
        if (x === world.goal.x && y === world.goal.y) { outcome = 'goal'; break; }
        var k = cellKey(x, y);
        if (k === world.small) { outcome = 'small'; break; }
        if (world.treats.has(k)) ate.add(k);
        var sig = k + ':' + ate.size;
        if (seen.has(sig)) { outcome = 'loop'; break; }
        seen.add(sig);
      }
      return { path: path, reachedGoal: outcome === 'goal' || outcome === 'small', outcome: outcome };
    };

    /** max-Q for every cell (no treats eaten), indexed y*6 + x. */
    brain.valueMap = function () {
      var out = new Float64Array(N_POS);
      for (var y = 0; y < world.height; y++) {
        for (var x = 0; x < world.width; x++) {
          features(world, x, y, null, fA);
          forward(online, H, fA, h, q);
          out[cellKey(x, y)] = q[argmax(q)];
        }
      }
      return out;
    };

    /**
     * A thumbnail of the network for the given state:
     *   hiddenIndex — which 6 hidden units are shown (those with the heaviest outgoing weights)
     *   hidden      — their activations
     *   inEdges[g][k]  — summed weight from input group g to shown unit k, over the inputs that are ON
     *                    in this state (so the edge shows what that group is saying right now)
     *   outEdges[k][a] — weight from shown unit k to action a
     *   q           — the 4 Q-values
     */
    brain.miniView = function (f) {
      var j, a, g, k, i;
      if (!miniIdx || brain.updates - miniIdxAt >= 300) {
        var score = [];
        for (j = 0; j < H; j++) {
          var s = 0;
          for (a = 0; a < N_OUT; a++) s += Math.abs(online.W2[a * H + j]);
          score.push({ j: j, s: s });
        }
        score.sort(function (p, r) { return r.s - p.s || p.j - r.j; });
        miniIdx = score.slice(0, 6).map(function (o) { return o.j; }).sort(function (p, r) { return p - r; });
        miniIdxAt = brain.updates;
      }
      var qs = new Float64Array(N_OUT);
      forward(online, H, f, h, qs);
      var hidden = [], inEdges = [], outEdges = [];
      for (k = 0; k < 6; k++) hidden.push(h[miniIdx[k]]);
      for (g = 0; g < FEATURE_GROUPS.length; g++) {
        var row = [], idx = FEATURE_GROUPS[g].indices;
        for (k = 0; k < 6; k++) {
          var sum = 0;
          for (i = 0; i < idx.length; i++) sum += online.W1[miniIdx[k] * N_IN + idx[i]] * f[idx[i]];
          row.push(sum);
        }
        inEdges.push(row);
      }
      for (k = 0; k < 6; k++) {
        var o = [];
        for (a = 0; a < N_OUT; a++) o.push(online.W2[a * H + miniIdx[k]]);
        outEdges.push(o);
      }
      return { hiddenIndex: miniIdx.slice(), hidden: hidden, inEdges: inEdges, outEdges: outEdges, q: qs };
    };

    init();
    return brain;
  }

  var api = {
    CONFIG: CONFIG, CELL: CELL, DX: DX, DY: DY, N_IN: N_IN, FEATURE_GROUPS: FEATURE_GROUPS,
    mulberry32: mulberry32, cellKey: cellKey,
    createWorld: createWorld, resetWorld: resetWorld, cellAt: cellAt, hasTreat: hasTreat,
    canApplyTool: canApplyTool, applyTool: applyTool,
    createEnv: createEnv, resetEnv: resetEnv, stepEnv: stepEnv,
    features: features, createBrain: createBrain
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DogBrain = api;
})(typeof window !== 'undefined' ? window : this);
