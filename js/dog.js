/* dog.js — draws the gridworld, the mini brain and the thought log; runs the loop.
 * All learning lives in brain.js (window.DogBrain).
 * Art: sprites from assets/ (credits in LICENSES.md). If any image fails to load, the widget
 * falls back to the procedural voxel drawing further down. */
(function () {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var STEP_MS = 260;               // the visible dog moves this often
  var STEP_MS_REDUCED = 520;       // … and this often under prefers-reduced-motion
  var RESPAWN_PAUSE_MS = 600;      // rest after an episode ends
  var GOAL_DIG_MS = 1000;          // … longer at the bone: the dog digs at it first
  var STUCK_DIG_MS = 700;          // a stuck dog digs at the start tile before trying again
  var NOTICE_RESUME_MS = 600;      // the dog keeps still this long after the pointer leaves it
  var PET_MS = 900;                // the dog sits still this long when petted
  var STUCK_AFTER = 5;             // attempts without a bone before the dog says it is stuck …
  var STUCK_EVERY = 2;             // … and it says the next, grumpier line every this many attempts after
  var HINT_AFTER = 9;              // attempts without a bone before the context line says it is stuck
  var CONTEXT_MIN_MS = 4000;       // a context message stays at least this long (a map change shows at once)
  var CONTEXT_EVENT_MS = 6000;     // map-changed, loophole and regrew messages hold this long
  var TEACH_MS = 7500;             // each line of the opening teaching sequence (four lines, ~30s)
  var LEARNED_HOME = 3;            // bone reached this many times, with epsilon at its floor, counts as learned
  var POP_MS = 400;                // a regrown treat pops in over this long (stepped, crisp)
  var POP_SCALES = [0.4, 0.7, 1.15, 1];
  var HACK_TREATS = 4;             // treats in one attempt that count as farming
  var PRACTICE_PER_FRAME = 12;     // hidden practice steps per 60Hz frame (4 parallel envs)
  var PRACTICE_IDLE_EVERY = 6;     // once learned: one practice step every N frames instead
  var LEARNED_LOSS = 0.001;        // "learned" = epsilon at its floor and loss EMA under this
  var TILE = 52;                   // iso tile width in px (height is half)
  var TILE_LARGE = 64;             // used on desktop-sized windows, where the art has room
  var TILE_SMALL = 44;             // used on phones
  var DOG_SCALE = 1.4;             // dog size relative to the voxel model below
  var SLAB = 8;                    // ground thickness, px
  var TILE_MIN = 26;               // smallest tile when the split column is narrow
  var SPLIT_MQ = '(min-width: 1100px)';   // keep in step with css/style.css and js/split.js
  var VIEW_GAP = 20, MINI_W = 110;         // .dog-view column gap and .mini width in css/style.css
  var WALL_H = 16;                 // wall cube height, px
  var HOP = 5;                     // hop height, px
  var TINT_MAX = 0.3;              // strongest value tint on a tile
  var AMBIENT_MS = 2500;           // quiet thoughts appear at most this often
  var LOG_ROWS = 4;
  var BUBBLE_KINDS = ['regrow', 'goal', 'small', 'fall', 'slip', 'treat', 'hack', 'pet', 'notice', 'stuck', 'map'];   // thoughts worth a speech bubble
  var BUBBLE_MS = 2200;            // a bubble stays this long, then fades over …
  var BUBBLE_FADE_MS = 300;        // … this long (no fade under reduced motion)
  var BUBBLE_PX = 10;              // bubble text size (Silkscreen, else the mono font)
  var BUBBLE_COLS = 22;            // characters per line; two lines at most, then "…"
  var BUBBLE_CELL = 2;             // px per bubble "pixel" (outline, corner notches, tail)
  var HEARTS = 4;                  // hearts per pet
  var HEART_MS = 1000;             // each floats and fades this long (reduced motion: one still heart for HEART_REDUCED_MS)
  var HEART_REDUCED_MS = 800;
  var HEART_RISE = 36;             // px they float up
  var HEART_CELL = 2;              // px per heart "pixel"
  var HEART_FILL = '#e2574c', HEART_LINE = '#8c2a20';
  var HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

  // art: drawn for a 128px-wide tile. ax/ay = the pixel that goes on the cell diamond's top vertex,
  // or on the diamond's centre for items. flat = replaces the ground tile instead of standing on it.
  var ART_DIR = 'assets/';
  var ART_TILE = 128;
  var ART = {
    ground: { src: 'tiles/ground.png', ax: 64, ay: 0 },
    gap: { src: 'tiles/gap.png', ax: 64, ay: 0 },
    bridge: { src: 'tiles/bridge.png', ax: 64, ay: 0, flat: true },
    ice: { src: 'tiles/ice.png', ax: 64, ay: 0, flat: true },
    mud: { src: 'tiles/mud.png', ax: 64, ay: 0, flat: true },
    wall: { src: 'tiles/wall.png', ax: 64, ay: 43 },
    treat: { src: 'tiles/treat.png', ax: 23, ay: 21, item: true },
    bone: { src: 'tiles/bone.png', ax: 36, ay: 34, item: true },
    bone_small: { src: 'tiles/bone_small.png', ax: 22, ay: 21, item: true },
    shadow: { src: 'sprites/dog_shadow.png', ax: 40, ay: 20, item: true },
    dog: { src: 'sprites/dog.png', ax: 56, ay: 72 }       // sheet of 112x96 frames
  };
  var TILE_ART = ['ground', 'gap', 'ground', 'bridge', 'ice', 'mud'];   // indexed by CELL (a wall stands on ground)
  var DOG_W = 112, DOG_H = 96;
  // sheet rows come in blocks of four directions (↗ ↘ ↙ ↖, same order as the actions); "walk" is idle plus a hop
  var CLIPS = {
    idle: { block: 0, frames: 5, fps: 8, loop: true },
    sit: { block: 1, frames: 7, fps: 9, loop: false },
    dig: { block: 2, frames: 9, fps: 8, loop: true }
  };

  var ARROWS = ['↗', '↘', '↙', '↖'];                 // up, right, down, left as seen on screen
  var CELL_NAMES = ['floor', 'gap', 'wall', 'bridge', 'ice', 'mud'];   // indexed by CELL, for the screen-reader announcements
  var TOOL_NAMES = { bone: 'small bone' };            // spoken name where it differs from the tool id
  var CONTEXT = {                                     // the line under the title, see contextTick()
    idle: 'help the dog get home · pick a piece, click a tile',
    stuck: 'stuck? build it a bridge, or ↺ new day for a fresh brain.',
    hack: 'it found a loophole: snacks forever beat the bone. real AI does this too.',
    changed: 'you changed the world. it has to relearn.',
    regrew: 'treats grow back. watch what it learns to do.',
    learned: 'it knows the way now. try moving things.',
    teach: ['it starts knowing nothing: every move is a guess.',
            'each bone (+1) and fall (−1) teaches it which moves pay off.',
            'green tiles = where it now expects reward. the dashed line is its plan.',
            'help it: build a bridge across the gap.']
  };
  var ATTITUDES = ['BONE', 'meh', 'nah', 'absolutely not'];   // by rank of Q
  var UNSURE = 'probably';                            // best action, but Q <= 0.3

  var THOUGHTS = {
    goal: ['i am a genius.', 'bone acquired. legend.', 'nailed it. no notes.', 'told you i knew the way.', 'bone secured. tail: wagging.'],
    small: ['small bone. still a bone.', "close enough. i'll take it."],
    fall: ['the floor betrayed me.', 'that was not floor.'],
    slip: ['not today, ice.', 'ice is a scam.'],
    treat: ['snacks!!', 'snacks!! snacks!!', 'snack acquired.', 'a treat?? for me??'],
    regrow: ['wait… it grows back?'],
    hack: ['infinite snacks. i live here now.'],
    mud: ['ew. mud.', 'squelch.'],
    notice: ['a human? sniff sniff.', 'oh hi.'],
    pet: ['good boy acknowledged.', 'pets received. productivity down.'],
    stuck: ['i have learned nothing.', 'maybe the bone is a myth.', 'the floor and i are no longer friends.', 'this is fine.'],   // said in this order
    bump: ['wall (rude).'],
    timeout: ['where am i even going.'],
    map: ['who put that there.', 'everything i knew was a lie.'],
    explore: ['zoomies!!', "what's over there?"],
    confident: ['bone is that way. probably.', 'i know this one.'],
    early: ['vibes only.', "no idea what i'm doing."],
    newday: ['wait. where am i.'],
    replan: ['hmm. wait. no.', 'change of plans.', 'recalculating.', 'new plan. better plan.', 'actually, this way.']
  };
  // ═══════════════════════════════════════════════════════════════════════════

  var B = window.DogBrain;
  var root = document.getElementById('dog-lab');
  var canvas = document.getElementById('dog-canvas');
  if (!B || !canvas || !canvas.getContext) return;   // .dog-fallback stays visible until .js-ready

  var ctx = canvas.getContext('2d');
  var mini = document.getElementById('brain-canvas');
  var mctx = mini.getContext('2d');
  if (!ctx || !mctx) return;
  var $ = function (id) { return document.getElementById(id); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var CELL = B.CELL, N = B.CONFIG.GRID;

  // ─────────────────────────────── state ───────────────────────────────
  var world = B.createWorld();
  var brain = B.createBrain(world);
  var env = B.createEnv(world);
  var tool = 'block';
  var ptr = null, kbd = null;             // {x, y} tile under the pointer / under the keyboard cursor
  var pxy = null, wasOver = false;        // pointer in canvas px (null off-canvas), and whether it was over the dog last time
  var resumeAt = 0, noticed = false;      // the dog may step again at resumeAt; noticed: already said hi this episode
  var attempt = 1, home = 0;
  var values = brain.valueMap(), plan = brain.plan(env.x, env.y, env.eaten);
  var decision = null;                    // last {action, explored, q, view}
  var anim = { kind: 'idle', fx: env.x, fy: env.y, tx: env.x, ty: env.y, t0: 0, dur: 1, facing: 1 };
  var act = null;                         // { clip, t0, until }: a sit or dig playing over the idle loop
  var art = false, ready = false, lastFrameKey = -1;   // art: every sprite loaded; ready: loading settled either way
  var nextStepAt = 0, lastFrame = 0, frameNo = 0, raf = 0;
  var onScreen = true, blurred = false, shown = true;
  var dirty = true, wasMoving = false, lastValues = null;   // redraw only when something changed
  var T, K, W, H, OX, OY, C = {};
  var pops = [];                          // regrown treats popping in: { k, t0 }
  var ctxText = '', ctxSince = -Infinity, ctxUntil = {}, teachMs = 0, regrewSeen = false;   // context line state
  var hearts = [], bubble = null;         // pet hearts and the one speech bubble: { lines, t0 }
  var HEART_CELLS = (function () {         // [col, row, isOutline] for the bitmap plus a 1-cell outline around it
    var out = [], on = function (r, c) { return (HEART[r] || '')[c] === 'X'; };
    for (var r = -1; r <= HEART.length; r++) for (var c = -1; c <= HEART[0].length; c++) {
      if (on(r, c)) out.push([c, r, 0]); else if (on(r - 1, c) || on(r + 1, c) || on(r, c - 1) || on(r, c + 1)) out.push([c, r, 1]);
    }
    return out;
  })();

  // ─────────────────────────────── sizing + colours ───────────────────────────────
  function readColors() {
    var cs = getComputedStyle(root);
    ['paper', 'ink', 'ink-3', 'accent', 'dog', 'gap', 'collar', 'tile-line',
     'tile-top', 'tile-left', 'tile-right', 'wall-top', 'wall-left', 'wall-right',
     'bridge-top', 'bridge-left', 'bridge-right', 'ice-top', 'ice-left', 'ice-right',
     'dog-top', 'dog-left', 'dog-right', 'ear-top', 'ear-left', 'ear-right',
     'amber-top', 'amber-left', 'amber-right', 'mud-top', 'mud-left', 'mud-right'].forEach(function (n) {
      C[n] = cs.getPropertyValue('--' + n).trim();
    });
    C.mono = cs.getPropertyValue('--mono');
  }
  function shades(n) { return [C[n + '-top'], C[n + '-left'], C[n + '-right']]; }

  function fitCanvas(c, cx, w, h) {
    var dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.imageSmoothingQuality = 'high';             // sprites are scaled down from 128px tiles
  }
  function resize() {
    // shortcut: two fixed tile sizes; switch to fitting the container if the layout ever gets fluid
    T = window.innerWidth < 400 ? TILE_SMALL
      : (window.innerWidth >= 1240 && window.innerHeight >= 700) ? TILE_LARGE : TILE;
    // two-column desktop: the column is resizable (js/split.js), so the tile shrinks until grid + brain still sit side by side
    var avail = root.clientWidth;                  // 0 while the tab is hidden
    if (avail && window.matchMedia(SPLIT_MQ).matches) T = Math.max(TILE_MIN, Math.min(T, Math.floor((avail - 12 - VIEW_GAP - MINI_W - 2) / N)));
    K = T / 44;                                    // heights below are in px at a 44px tile
    W = N * T + 12;
    OX = W / 2; OY = Math.round(34 * K);
    H = Math.round(OY + N * T / 2 + SLAB * K + 6);
    fitCanvas(canvas, ctx, W, H);
    fitCanvas(mini, mctx, 110, 80);
  }

  // ─────────────────────────────── art ───────────────────────────────
  /** Load every sprite, then call done(). art stays false (procedural drawing) unless all of them loaded. */
  function loadArt(done) {
    var names = Object.keys(ART), left = names.length, ok = true;
    names.forEach(function (n) {
      var im = ART[n].img = new Image();
      im.onload = im.onerror = function (e) {
        if (e.type === 'error') ok = false;
        if (--left === 0) { art = ok; done(); }
      };
      im.src = ART_DIR + ART[n].src;
    });
  }
  /** Draw a tile or item sprite on cell (gx, gy). */
  function sprite(name, gx, gy, alpha, grow) {
    var a = ART[name], s = T / ART_TILE, o = a.item ? 0.5 : 0, g = grow || 1;
    ctx.globalAlpha = alpha || 1;
    ctx.drawImage(a.img, sx(gx + o, gy + o) - a.ax * s * g, sy(gx + o, gy + o, 0) - a.ay * s * g, a.img.naturalWidth * s * g, a.img.naturalHeight * s * g);
    ctx.globalAlpha = 1;
  }
  function play(clip, t0, ms) { act = { clip: clip, t0: t0, until: t0 + ms }; dirty = true; }
  /** Which frame of the dog sheet to show: { block, col }. */
  function dogFrame(now) {
    var on = !!act && now >= act.t0 && now < act.until, c = CLIPS[on ? act.clip : 'idle'];
    var i = Math.floor((now - (on ? act.t0 : 0)) * c.fps / 1000);
    if (reduced.matches) i = on ? c.frames - 1 : 0;              // reduced motion: one still frame per pose
    return { block: c.block, col: c.loop ? i % c.frames : Math.min(c.frames - 1, i) };
  }
  function drawDogArt(pose, now) {
    var s = T / ART_TILE, X = sx(pose.x, pose.y), Y = sy(pose.x, pose.y, 0), f = dogFrame(now), sh = ART.shadow;
    ctx.globalAlpha = pose.alpha;
    if (!pose.falling) ctx.drawImage(sh.img, X - sh.ax * s, Y - sh.ay * s, sh.img.naturalWidth * s, sh.img.naturalHeight * s);
    ctx.drawImage(ART.dog.img, f.col * DOG_W, (f.block * 4 + anim.facing) * DOG_H, DOG_W, DOG_H,
                  X - ART.dog.ax * s, Y - ART.dog.ay * s - pose.z * K, DOG_W * s, DOG_H * s);
    ctx.globalAlpha = 1;
  }
  function drawTheDog(pose, now) {
    if (art) drawDogArt(pose, now); else drawDog(pose.x, pose.y, pose.z, anim.facing, pose.alpha);
  }
  /** The sprite the selected tool would put on (x, y); undefined for erase. */
  function ghostName(x, y) {
    return { block: B.cellAt(world, x, y) === CELL.GAP ? 'bridge' : 'wall', ice: 'ice', mud: 'mud', treat: 'treat', bone: 'bone_small' }[tool];
  }

  // ─────────────────────────────── iso drawing ───────────────────────────────
  function sx(gx, gy) { return OX + (gx - gy) * T / 2; }
  function sy(gx, gy, z) { return OY + (gx + gy) * T / 4 - (z || 0) * K; }

  function poly(c, pts, fill, stroke) {
    c.beginPath();
    c.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }
  function diamond(x, y, w, d, z) {
    return [sx(x, y), sy(x, y, z), sx(x + w, y), sy(x + w, y, z),
            sx(x + w, y + d), sy(x + w, y + d, z), sx(x, y + d), sy(x, y + d, z)];
  }
  /** A voxel box: footprint (x,y)..(x+w,y+d) in tile units, from z0 to z1 in px. col = [top, left, right]. */
  function box(x, y, w, d, z0, z1, col, line) {
    poly(ctx, [sx(x, y + d), sy(x, y + d, z1), sx(x + w, y + d), sy(x + w, y + d, z1),
               sx(x + w, y + d), sy(x + w, y + d, z0), sx(x, y + d), sy(x, y + d, z0)], col[1], col[1]);
    poly(ctx, [sx(x + w, y + d), sy(x + w, y + d, z1), sx(x + w, y), sy(x + w, y, z1),
               sx(x + w, y), sy(x + w, y, z0), sx(x + w, y + d), sy(x + w, y + d, z0)], col[2], col[2]);
    poly(ctx, diamond(x, y, w, d, z1), col[0], line || col[0]);
  }

  // dog parts in the dog's own frame: f = forward offset, s = sideways offset, hf/hs = half sizes (tile units), z in px
  var DOG_PARTS = [
    { f: -0.30, s: 0, hf: 0.05, hs: 0.04, z0: 9, z1: 14, col: 'dog' },      // tail
    { f: -0.04, s: 0, hf: 0.24, hs: 0.15, z0: 2, z1: 12, col: 'dog' },      // body
    { f: 0.15, s: 0, hf: 0.03, hs: 0.16, z0: 9, z1: 13, col: 'collar' },    // collar
    { f: 0.28, s: 0, hf: 0.13, hs: 0.14, z0: 8, z1: 21, col: 'dog' },       // head
    { f: 0.45, s: 0, hf: 0.06, hs: 0.08, z0: 9, z1: 15, col: 'dog' },       // snout
    { f: 0.25, s: -0.18, hf: 0.08, hs: 0.04, z0: 6, z1: 19, col: 'ear' },   // long spaniel ears
    { f: 0.25, s: 0.18, hf: 0.08, hs: 0.04, z0: 6, z1: 19, col: 'ear' }
  ];

  function drawDog(px, py, z, facing, alpha) {
    var fx = B.DX[facing], fy = B.DY[facing], vx = -fy, vy = fx;
    var S = DOG_SCALE;
    var parts = DOG_PARTS.map(function (p) {
      var hf = p.hf * S, hs = p.hs * S, f = (p.f - 0.08) * S, sd = p.s * S;   // -0.08: centre the whole dog on its tile
      var hx = Math.abs(fx) * hf + Math.abs(vx) * hs, hy = Math.abs(fy) * hf + Math.abs(vy) * hs;
      var cx = px + fx * f + vx * sd, cy = py + fy * f + vy * sd;
      return { x: cx - hx, y: cy - hy, w: hx * 2, d: hy * 2, z0: p.z0 * S + z, z1: p.z1 * S + z, col: p.col, depth: cx + cy };
    }).sort(function (a, b) { return a.depth - b.depth || a.z0 - b.z0; });
    ctx.globalAlpha = alpha;
    parts.forEach(function (p) {
      var col = p.col === 'collar' ? [C.collar, C.collar, C.collar] : shades(p.col);
      box(p.x, p.y, p.w, p.d, p.z0, p.z1, col);
    });
    ctx.globalAlpha = 1;
  }

  /** Where the dog is right now: { x, y (tile centre, fractional), z, alpha, falling }. */
  function dogPose(now) {
    var p = Math.min(1, Math.max(0, (now - anim.t0) / anim.dur));
    var e = p * p * (3 - 2 * p);
    var pose = { x: anim.tx + 0.5, y: anim.ty + 0.5, z: 0, alpha: 1, falling: false };
    if (anim.kind === 'bump') {
      var n = 0.2 * Math.sin(Math.PI * p);
      pose.x = anim.fx + 0.5 + B.DX[anim.facing] * n;
      pose.y = anim.fy + 0.5 + B.DY[anim.facing] * n;
    } else if (anim.kind !== 'idle') {
      pose.x = anim.fx + 0.5 + (anim.tx - anim.fx) * e;
      pose.y = anim.fy + 0.5 + (anim.ty - anim.fy) * e;
      if (!reduced.matches) pose.z = Math.sin(Math.PI * p) * HOP;
      if (anim.kind === 'fall' && p > 0.6) {
        var s = Math.min(1, (now - anim.t0 - anim.dur * 0.6) / RESPAWN_PAUSE_MS);
        pose.falling = true;
        pose.z = -s * 26;
        pose.alpha = 1 - s;
      }
    }
    return pose;
  }

  function smallBone(x, y) {                                // procedural: the big bone at two-thirds size
    box(x + 0.27, y + 0.39, 0.11, 0.22, 0, 5, shades('amber'));
    box(x + 0.37, y + 0.45, 0.26, 0.10, 1, 4, shades('amber'));
    box(x + 0.62, y + 0.39, 0.11, 0.22, 0, 5, shades('amber'));
  }
  function drawGhost(x, y) {                                // procedural ghosts; sprites use ghostName()
    var c = B.cellAt(world, x, y);
    ctx.globalAlpha = 0.4;
    if (tool === 'block') {
      if (c === CELL.GAP) box(x + 0.03, y + 0.03, 0.94, 0.94, -5, 0, shades('bridge'));
      else box(x + 0.08, y + 0.08, 0.84, 0.84, 0, WALL_H, shades('wall'));
    } else if (tool === 'ice') {
      poly(ctx, diamond(x, y, 1, 1, 0), C['ice-top']);
    } else if (tool === 'mud') {
      poly(ctx, diamond(x, y, 1, 1, 0), C['mud-top']);
    } else if (tool === 'bone') {
      smallBone(x, y);
    } else if (tool === 'treat') {
      box(x + 0.38, y + 0.38, 0.24, 0.24, 0, 6, shades('amber'));
    }
    ctx.globalAlpha = 1;
  }

  function popScale(k, now) {              // 1 unless this treat just regrew
    for (var i = 0; i < pops.length; i++) if (pops[i].k === k) return POP_SCALES[Math.min(POP_SCALES.length - 1, Math.floor((now - pops[i].t0) / POP_MS * POP_SCALES.length))];
    return 1;
  }
  function draw(now) {
    var x, y, d, c, k, hover = ptr || kbd;
    dirty = false;
    var pose = dogPose(now);
    ctx.clearRect(0, 0, W, H);

    // value tint is normalised over the tiles the dog can stand on
    var lo = Infinity, hi = -Infinity;
    for (k = 0; k < values.length; k++) {
      c = world.cells[k];
      if (c === CELL.GAP || c === CELL.WALL) continue;
      if (values[k] < lo) lo = values[k];
      if (values[k] > hi) hi = values[k];
    }
    var span = hi - lo > 0.05 ? hi - lo : 0;
    var can = !!hover && usable(hover), ghost = can && art ? ghostName(hover.x, hover.y) : '';

    // pass 1 — ground, back to front
    for (d = 0; d <= 2 * (N - 1); d++) {
      for (x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
        y = d - x; k = B.cellKey(x, y); c = world.cells[k];
        if (art) {
          sprite(TILE_ART[c], x, y);
          // a flat ghost goes in here, so the tiles in front still cover its sides
          if (ghost && ART[ghost].flat && hover.x === x && hover.y === y) sprite(ghost, x, y, 0.5);
        } else if (c === CELL.GAP || c === CELL.BRIDGE) {
          poly(ctx, diamond(x, y, 1, 1, -SLAB), C.gap, C.gap);
          if (c === CELL.BRIDGE) box(x + 0.03, y + 0.03, 0.94, 0.94, -5, 0, shades('bridge'));
        } else {
          box(x, y, 1, 1, -SLAB, 0, shades(c === CELL.ICE ? 'ice' : c === CELL.MUD ? 'mud' : 'tile'), C['tile-line']);
        }
        if (c === CELL.GAP) {
          if (pose.falling && anim.tx === x && anim.ty === y) drawTheDog(pose, now);
        } else if (span && c !== CELL.WALL) {
          var n = (values[k] - lo) / span;
          ctx.globalAlpha = TINT_MAX * n * n;                 // squared: only tiles the model really likes go green
          poly(ctx, diamond(x, y, 1, 1, 0), C.accent);
          ctx.globalAlpha = 1;
        }
      }
    }

    // the plan: where the greedy policy would walk from here
    if (plan.path.length > 1) {
      ctx.beginPath();
      plan.path.forEach(function (p, i) {
        var X = sx(p.x + 0.5, p.y + 0.5), Y = sy(p.x + 0.5, p.y + 0.5, 0);
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      });
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      var end = plan.path[plan.path.length - 1];
      ctx.beginPath();
      ctx.arc(sx(end.x + 0.5, end.y + 0.5), sy(end.x + 0.5, end.y + 0.5, 0), 2, 0, Math.PI * 2);
      ctx.fillStyle = C.accent; ctx.fill();
    }

    // hover outline + ghost of the selected piece
    if (hover) {
      ctx.setLineDash([3, 3]);
      poly(ctx, diamond(hover.x, hover.y, 1, 1, 0), null, can || onDog(hover) ? C.ink : C['ink-3']);
      ctx.setLineDash([]);
    }

    // pass 2 — things standing on the ground, back to front
    var dogDepth = Math.max(anim.fx + anim.fy, anim.tx + anim.ty);
    for (d = 0; d <= 2 * (N - 1); d++) {
      for (x = Math.max(0, d - N + 1); x <= Math.min(N - 1, d); x++) {
        y = d - x; k = B.cellKey(x, y);
        var wall = world.cells[k] === CELL.WALL, treat = world.treats.has(k) && !env.eaten.has(k);
        var bone = x === world.goal.x && y === world.goal.y, here = can && hover.x === x && hover.y === y;
        if (art) {
          if (wall) sprite('wall', x, y);
          if (treat) sprite('treat', x, y, 1, popScale(k, now));
          if (k === world.small) sprite('bone_small', x, y);
          if (bone) sprite('bone', x, y);
          if (here && ghost && !ART[ghost].flat) sprite(ghost, x, y, 0.5);
          continue;
        }
        if (wall) box(x + 0.08, y + 0.08, 0.84, 0.84, 0, WALL_H, shades('wall'));
        if (treat) box(x + 0.38, y + 0.38, 0.24, 0.24, 0, 6 * popScale(k, now), shades('amber'));
        if (k === world.small) smallBone(x, y);
        if (bone) {                                          // the bone: a bar with two knobs
          box(x + 0.16, y + 0.34, 0.16, 0.32, 0, 8, shades('amber'));
          box(x + 0.30, y + 0.43, 0.40, 0.14, 1, 6, shades('amber'));
          box(x + 0.68, y + 0.34, 0.16, 0.32, 0, 8, shades('amber'));
        }
        if (here) drawGhost(x, y);
      }
      if (d === dogDepth && !pose.falling) drawTheDog(pose, now);
    }
    drawBubble(pose, now);
    drawHearts(pose, now);                                   // both on top of everything
  }

  // ─────────────────────────────── pet hearts + speech bubble ───────────────────────────────
  function head(pose) { return { x: sx(pose.x, pose.y), y: sy(pose.x, pose.y, 0) - pose.z * K - 58 * T / ART_TILE }; }
  function spawnHearts(now) {
    hearts = [];
    for (var i = 0; i < (reduced.matches ? 1 : HEARTS); i++) {
      hearts.push({ t0: now + (reduced.matches ? 0 : i * 120), dx: reduced.matches ? 0 : (i % 2 ? 1 : -1) * (22 + (i >> 1) * 10) + Math.random() * 6 - 3,   // beside the head, clear of the bubble
        drift: Math.random() * 16 - 8 });
    }
    root.dataset.hearts = hearts.length;                     // debug/test read
    dirty = true;
  }
  function drawHearts(pose, now) {
    var h0 = head(pose), life = reduced.matches ? HEART_REDUCED_MS : HEART_MS;
    hearts.forEach(function (h) {
      var p = (now - h.t0) / life;
      if (p < 0) return;
      if (reduced.matches) p = 0;                            // reduced motion: static, no float, no fade
      var x = Math.round(h0.x + h.dx + h.drift * p - 3.5 * HEART_CELL), y = Math.round(h0.y + 14 - HEART_RISE * p);
      ctx.globalAlpha = Math.min(1, 2 * (1 - p));
      HEART_CELLS.forEach(function (c) {
        ctx.fillStyle = c[2] ? HEART_LINE : HEART_FILL;
        ctx.fillRect(x + c[0] * HEART_CELL, y + c[1] * HEART_CELL, HEART_CELL, HEART_CELL);
      });
    });
    ctx.globalAlpha = 1;
  }
  function wrap(s) {                                         // greedy word wrap: BUBBLE_COLS per line, 2 lines, then "…"
    var lines = [''];
    s.split(' ').forEach(function (w) {
      var l = lines[lines.length - 1];
      if (!l) lines[lines.length - 1] = w;
      else if ((l + ' ' + w).length <= BUBBLE_COLS) lines[lines.length - 1] = l + ' ' + w;
      else lines.push(w);
    });
    var cut = lines.length > 2;
    lines.length = Math.min(lines.length, 2);
    return lines.map(function (l, i) {
      if (cut && i === 1) l += '…';
      return l.length > BUBBLE_COLS ? l.slice(0, BUBBLE_COLS - 1) + '…' : l;
    });
  }
  function showBubble(text, now) {
    bubble = { lines: wrap(text), t0: now };
    root.dataset.bubble = text;                              // debug/test read; the log + live region already announce it
    dirty = true;
  }
  function drawBubble(pose, now) {
    if (!bubble) return;
    var c = BUBBLE_CELL, lh = BUBBLE_PX + 3, pad = 3 * c, h0 = head(pose), age = now - bubble.t0;
    ctx.font = BUBBLE_PX + 'px Silkscreen, ' + C.mono; ctx.textBaseline = 'top';
    var tw = Math.max.apply(null, bubble.lines.map(function (l) { return ctx.measureText(l).width; }));
    var w = Math.ceil((tw + 2 * pad) / c) * c, h = Math.ceil((bubble.lines.length * lh + 2 * pad - 3) / c) * c;
    var x = Math.min(Math.max(2, Math.round(h0.x - w / 2)), W - w - 2);          // stays inside the canvas …
    var y = Math.max(2, Math.round(h0.y - 4 - 2 * c - h));
    var tx = Math.min(Math.max(Math.round(h0.x) - 2 * c, x + 2 * c), x + w - 6 * c);   // … and the tail slides along it to keep pointing at the head
    ctx.globalAlpha = reduced.matches ? 1 : Math.min(1, (BUBBLE_MS - age) / BUBBLE_FADE_MS);
    ctx.fillStyle = C.ink;                                   // outline: the box with its corner cells notched
    ctx.fillRect(x + c, y, w - 2 * c, h); ctx.fillRect(x, y + c, w, h - 2 * c);
    ctx.fillStyle = C.paper;                                 // paper, notched one cell further in
    ctx.fillRect(x + 2 * c, y + c, w - 4 * c, h - 2 * c); ctx.fillRect(x + c, y + 2 * c, w - 2 * c, h - 4 * c);
    ctx.fillRect(tx + c, y + h - c, 2 * c, c);               // open the bottom edge for the tail
    ctx.fillStyle = C.ink;
    ctx.fillRect(tx, y + h, c, c); ctx.fillRect(tx + 3 * c, y + h, c, c); ctx.fillRect(tx + c, y + h + c, 2 * c, c);
    ctx.fillStyle = C.paper; ctx.fillRect(tx + c, y + h, 2 * c, c);
    ctx.fillStyle = C.ink;
    bubble.lines.forEach(function (l, i) { ctx.fillText(l, x + pad, y + pad + i * lh); });
    ctx.globalAlpha = 1;
  }
  /** Drop expired hearts and bubble; true while any effect is still showing (the loop redraws only then). */
  function fxTick(now) {
    var n = hearts.length + (bubble ? 1 : 0);
    hearts = hearts.filter(function (h) { return now - h.t0 < (reduced.matches ? HEART_REDUCED_MS : HEART_MS); });
    if (bubble && now - bubble.t0 >= BUBBLE_MS) { bubble = null; delete root.dataset.bubble; }
    if (!hearts.length) delete root.dataset.hearts;
    var np = pops.length;
    pops = pops.filter(function (p) { return now - p.t0 < POP_MS; });
    if (n !== hearts.length + (bubble ? 1 : 0) || np !== pops.length) dirty = true;
    return hearts.length > 0 || !!bubble || pops.length > 0;
  }

  // ─────────────────────────────── mini brain ───────────────────────────────
  function drawBrain() {
    var c = mctx, v = decision && decision.view, g, k, a, m;
    c.clearRect(0, 0, 110, 80);
    if (!v) return;
    var inY = function (i) { return 8 + i * 64 / (v.inEdges.length - 1); }, hidY = function (i) { return 8 + i * 12.8; };
    var outY = function (i) { return 13 + i * 18; };
    var X0 = 8, X1 = 50, X2 = 90;

    function edges(rows, xa, ya, xb, yb) {
      var max = 1e-6;
      rows.forEach(function (r) { r.forEach(function (w) { if (Math.abs(w) > max) max = Math.abs(w); }); });
      rows.forEach(function (r, i) {
        r.forEach(function (w, j) {
          c.globalAlpha = 0.75 * Math.abs(w) / max;
          c.strokeStyle = w >= 0 ? C.accent : C.dog;
          c.beginPath(); c.moveTo(xa, ya(i)); c.lineTo(xb, yb(j)); c.stroke();
        });
      });
      c.globalAlpha = 1;
    }
    c.lineWidth = 1;
    edges(v.inEdges, X0, inY, X1, hidY);
    edges(v.outEdges, X1, hidY, X2, outY);

    function node(x, y, r, fill, alpha) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = C.paper; c.fill();                       // hide edge ends behind the node
      c.globalAlpha = alpha; c.fillStyle = fill; c.fill(); c.globalAlpha = 1;
      c.strokeStyle = C['ink-3']; c.stroke();
    }
    for (g = 0; g < v.inEdges.length; g++) node(X0, inY(g), 3.5, C.ink, 0.25);
    m = Math.max.apply(null, v.hidden) || 1;
    for (k = 0; k < 6; k++) node(X1, hidY(k), 3.5, C.ink, 0.08 + 0.85 * v.hidden[k] / m);
    c.font = '10px ' + C.mono;
    c.textBaseline = 'middle';
    for (a = 0; a < 4; a++) {
      var chosen = a === decision.action;
      node(X2, outY(a), 4, chosen ? (decision.explored ? C.dog : C.accent) : C.ink, chosen ? 1 : 0.08);
      c.fillStyle = chosen ? C.ink : C['ink-3'];
      c.fillText(ARROWS[a], X2 + 8, outY(a));
    }
  }

  function fmt(v, digits) {       // 0.91 → ".91", -1 → "−1.00"
    var s = Math.abs(v).toFixed(digits == null ? 2 : digits);
    if (s.charAt(0) === '0') s = s.slice(1);
    return (v < 0 ? '−' : '') + s;
  }
  function attitude(q, a) {
    var rank = 0;
    for (var i = 0; i < 4; i++) if (q[i] > q[a]) rank++;
    return rank === 0 && q[a] <= 0.3 ? UNSURE : ATTITUDES[rank];
  }
  function showDecision() {
    var el = $('brain-decision'), tip = $('brain-tip'), q = decision.q, a = decision.action, b = document.createElement('b'), i;
    b.textContent = ARROWS[a];
    el.replaceChildren(b, ' ' + attitude(q, a));
    el.classList.toggle('explored', decision.explored);
    tip.replaceChildren('in   ' + B.FEATURE_GROUPS.map(function (g) { return g.label; }).join('\n     ') + '\nout');
    for (i = 0; i < 4; i++) {
      var row = '  ' + ARROWS[i] + ' ' + (attitude(q, i) + '               ').slice(0, 16) + fmt(q[i]);
      if (i === a) { var rb = document.createElement('b'); rb.textContent = row; tip.append('\n', rb); }
      else tip.append('\n' + row);
    }
    if (decision.explored) tip.append('\n(that move was zoomies)');
    drawBrain();                                   // the mini brain only changes when the decision does
  }

  // ─────────────────────────────── thought log ───────────────────────────────
  var log = [], lastAmbient = -Infinity;
  /** Log a thought. ambient: rate-limited chatter. only: index of the one line allowed (default: any of the kind). */
  function say(kind, signal, ambient, only) {
    var now = performance.now();
    if (ambient && now - lastAmbient < AMBIENT_MS) return;
    var options = (only == null ? THOUGHTS[kind] : [THOUGHTS[kind][only]]).filter(function (t) {                           // never repeat a line still on screen
      return !log.some(function (row) { return row.thought === t; });
    });
    if (!options.length) return;
    if (ambient) lastAmbient = now;
    var s = Math.floor(now / 1000);
    var thought = options[Math.floor(Math.random() * options.length)];
    log.unshift({ t: ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + s % 60).slice(-2), thought: thought, signal: signal });
    if (BUBBLE_KINDS.indexOf(kind) >= 0) showBubble(thought, now);
    log.length = Math.min(log.length, LOG_ROWS);
    var body = $('thought-log');
    body.textContent = '';
    log.forEach(function (row) {
      var li = body.appendChild(document.createElement('li'));
      [row.t, row.thought, row.signal].forEach(function (text) { li.appendChild(document.createElement('span')).textContent = text; });
    });
  }

  function showStats() {
    $('stat-attempt').textContent = attempt;
    $('stat-home').textContent = home;
    $('stat-eps').textContent = Math.round(brain.epsilon * 100) + '%';
    $('stat-loss').textContent = fmt(brain.lossEma, 3);
  }

  // ─────────────────────────────── the visible dog ───────────────────────────────
  /** The one-sentence context line under the title. Highest priority wins; a message stays CONTEXT_MIN_MS (force: now). */
  function contextTick(now, force) {
    var want, hold = function (n) { return now < (ctxUntil[n] || 0); };
    if (brain.attemptsSinceGoal >= HINT_AFTER) want = CONTEXT.stuck;
    else if (hold('hack')) want = CONTEXT.hack;
    else if (hold('changed')) want = CONTEXT.changed;
    else if (hold('regrew')) want = CONTEXT.regrew;
    else if (brain.epsilon <= brain.config.EPS_MIN && home >= LEARNED_HOME) want = CONTEXT.learned;
    else if (teachMs < TEACH_MS * CONTEXT.teach.length) want = CONTEXT.teach[Math.floor(teachMs / TEACH_MS)];
    else want = CONTEXT.idle;
    if (want === ctxText || (!force && now - ctxSince < CONTEXT_MIN_MS)) return;
    ctxText = want; ctxSince = now;
    $('dog-context').textContent = want;
  }
  function respawn(now) {
    B.resetEnv(world, env);
    act = null; noticed = false; pops = [];
    anim = { kind: 'idle', fx: env.x, fy: env.y, tx: env.x, ty: env.y, t0: now, dur: 1, facing: 1 };
    plan = brain.plan(env.x, env.y, env.eaten);
    dirty = true;
  }

  function step(now) {
    var stepMs = reduced.matches ? STEP_MS_REDUCED : STEP_MS;
    nextStepAt = now + stepMs;
    dirty = true;
    if (env.done) {
      attempt++; respawn(now); showStats();
      if (brain.attemptsSinceGoal >= STUCK_AFTER) { play('dig', now, STUCK_DIG_MS); nextStepAt = now + STUCK_DIG_MS; }
      return;
    }

    var f = B.features(world, env.x, env.y, env.eaten);
    var choice = brain.act(f);
    var fromX = env.x, fromY = env.y;
    var eatenBefore = new Map(env.eaten);
    var res = B.stepEnv(world, env, choice.action, Math.random);
    var regrown = Array.from(eatenBefore.keys()).filter(function (k) { return env.eaten.get(k) !== eatenBefore.get(k); });   // treats that grew back this step (even if re-eaten at once)
    brain.remember(f, choice.action, res.reward, B.features(world, env.x, env.y, env.eaten), res.terminal);

    decision = { action: choice.action, explored: choice.explored, q: choice.q, view: brain.miniView(f) };
    anim = { kind: res.bumped ? 'bump' : res.event === 'fall' ? 'fall' : 'move',
             fx: fromX, fy: fromY, tx: env.x, ty: env.y, t0: now, dur: stepMs * 0.85, facing: res.action };
    var old = plan;
    plan = brain.plan(env.x, env.y, env.eaten);
    // a replan: the dog followed a plan that reached the bone, and the rest of it just changed
    var replanned = old.reachedGoal && !choice.explored && !res.slipped && !res.done &&
      old.path.slice(1).some(function (p, i) { var n = plan.path[i]; return !n || n.x !== p.x || n.y !== p.y; });
    var won = res.event === 'goal' || res.event === 'small';
    if (res.done) nextStepAt += won ? GOAL_DIG_MS : RESPAWN_PAUSE_MS;
    if (won) play('dig', now + anim.dur, GOAL_DIG_MS);       // dig at the bone until the respawn
    // the stuck signal counts attempts without a bone; an attempt spent farming treats is not one of them
    var tries = res.done && !(res.event === 'timeout' && env.treats >= HACK_TREATS) ? brain.noteEpisode(res.event) : 0;
    var grump = tries >= STUCK_AFTER && (tries - STUCK_AFTER) % STUCK_EVERY === 0;
    if (regrown.length) {
      if (!reduced.matches) regrown.forEach(function (k) { pops.push({ k: k, t0: now }); });
      if (!regrewSeen) { regrewSeen = true; ctxUntil.regrew = now + CONTEXT_EVENT_MS; say('regrow', 'respawn'); }
    }

    // what the dog thinks about it
    var q = choice.q, sorted = Array.prototype.slice.call(q).sort(function (a, b) { return b - a; });
    if (res.slipped) say('slip', 'slip');
    if (res.event === 'goal') { home++; say('goal', '+1.00'); }
    else if (res.event === 'small') say('small', '+0.40');
    else if (grump) say('stuck', 'stuck ×' + tries, false, Math.min(THOUGHTS.stuck.length - 1, (tries - STUCK_AFTER) / STUCK_EVERY));
    else if (res.event === 'fall') say('fall', '−1.00');
    else if (res.event === 'timeout') say('timeout', 'timeout');
    else if (res.treat && env.treats === HACK_TREATS) { ctxUntil.hack = now + CONTEXT_EVENT_MS; say('hack', 'reward hack'); }
    else if (res.treat) say('treat', '+0.30');
    else if (res.mud) say('mud', '−0.08', true);
    else if (res.bumped) say('bump', 'bump', true);
    else if (replanned) say('replan', 'replan', true);
    else if (brain.epsilon > 0.5 && Math.random() < 0.5) say('early', 'ε ' + fmt(brain.epsilon), true);
    else if (choice.explored) say('explore', 'explore ε ' + fmt(brain.epsilon), true);
    else if (sorted[0] - sorted[1] > 0.25 && brain.epsilon < 0.3) say('confident', 'q ' + ARROWS[choice.action] + ' ' + fmt(sorted[0]), true);

    showDecision();
    showStats();
    contextTick(now);
  }

  // ─────────────────────────────── visitor input ───────────────────────────────
  function tileAt(e) {
    var r = canvas.getBoundingClientRect();
    var u = (e.clientX - r.left - OX) / (T / 2), v = (e.clientY - r.top - OY) / (T / 4);
    var x = Math.floor((u + v) / 2), y = Math.floor((v - u) / 2);
    return x >= 0 && y >= 0 && x < N && y < N ? { x: x, y: y } : null;
  }
  function sameTile(a, b) { return a === b || (!!a && !!b && a.x === b.x && a.y === b.y); }
  function onDog(t) { return !env.done && t.x === env.x && t.y === env.y; }      // that tile pets the dog instead
  function inDogBox(now) {                // the sprite's frame is a bigger target than its tile diamond
    var p = dogPose(now), s = T / ART_TILE, bx = sx(p.x, p.y) - ART.dog.ax * s, by = sy(p.x, p.y, 0) - ART.dog.ay * s - p.z * K;
    return !!pxy && pxy.x >= bx && pxy.x < bx + DOG_W * s && pxy.y >= by && pxy.y < by + DOG_H * s;
  }
  function overDog(now) { var h = ptr || kbd; return !env.done && (inDogBox(now) || (!!h && onDog(h))); }
  function nearDog(now) {                 // on the dog, its sprite, or any tile touching it
    var h = ptr || kbd;
    return !env.done && (inDogBox(now) || (!!h && Math.abs(h.x - env.x) <= 1 && Math.abs(h.y - env.y) <= 1));
  }
  function faceCursor() {                 // turn towards the cursor's tile (largest axis wins)
    var h = ptr || kbd, dx = h ? h.x - env.x : 0, dy = h ? h.y - env.y : 0, ux, uy, d;
    if (!dx && !dy) return;
    if (Math.abs(dx) >= Math.abs(dy)) { ux = dx > 0 ? 1 : -1; uy = 0; } else { ux = 0; uy = dy > 0 ? 1 : -1; }
    for (d = 0; d < 4; d++) if (B.DX[d] === ux && B.DY[d] === uy) break;
    if (anim.facing !== d) { anim.facing = d; dirty = true; }
  }
  function usable(t) { return !onDog(t) && B.canApplyTool(world, tool, t.x, t.y); }
  function refresh() {                    // after the cursor, tool or map changed
    var h = ptr || kbd;
    canvas.classList.toggle('cant', !!h && !usable(h) && !overDog(performance.now()));   // over the dog: pointer cursor
    dirty = true;
  }
  var live = $('dog-live'), flip = false;
  function announce(msg) { live.textContent = msg + ((flip = !flip) ? '\u00a0' : ''); }   // nbsp flip: identical repeats still re-announce
  function describe(t) {
    return 'tile ' + (t.x + 1) + ', ' + (t.y + 1) + ': ' + CELL_NAMES[B.cellAt(world, t.x, t.y)] +
      (t.x === world.goal.x && t.y === world.goal.y ? ', bone' : '') + (B.hasTreat(world, t.x, t.y) ? ', treat' : '') +
      (world.small === B.cellKey(t.x, t.y) ? ', small bone' : '') + (onDog(t) ? ', the dog' : '');
  }
  function pet() {
    var now = performance.now();
    play('sit', now, PET_MS);
    nextStepAt = Math.max(nextStepAt, now + PET_MS);         // it holds still for it; the brain is never told
    say('pet', 'pet');
    spawnHearts(now);
    announce('you pet the dog');
  }
  function place(t) {
    if (!t) return;
    if (onDog(t)) { pet(); return; }
    var name = TOOL_NAMES[tool] || tool;
    if (!B.applyTool(world, tool, t.x, t.y)) { announce(name + " can't go on " + describe(t)); return; }
    brain.syncWorld();
    var here = B.cellAt(world, env.x, env.y);
    if (here === CELL.WALL || here === CELL.GAP) respawn(performance.now());   // the dog's tile was replaced under it
    values = brain.valueMap();
    plan = brain.plan(env.x, env.y, env.eaten);
    say('map', 'map changed');
    ctxUntil.changed = performance.now() + CONTEXT_EVENT_MS;
    contextTick(performance.now(), true);
    announce(tool === 'erase' ? 'piece erased' : name + ' placed');
    refresh();
    showStats();
  }
  function pointAt(e) {
    var t = tileAt(e), r = canvas.getBoundingClientRect(), o;
    pxy = { x: e.clientX - r.left, y: e.clientY - r.top };
    o = overDog(performance.now());
    if (!sameTile(t, ptr) || o !== wasOver) { ptr = t; refresh(); }
    wasOver = o;
    return t;
  }

  canvas.addEventListener('pointermove', pointAt);
  canvas.addEventListener('pointerdown', pointAt);
  canvas.addEventListener('pointerleave', function () { ptr = null; pxy = null; refresh(); });   // leaves the keyboard cursor alone
  canvas.addEventListener('click', function (e) {
    var t = pointAt(e);
    if (overDog(performance.now())) pet(); else place(t);   // anywhere on the sprite pets, not just its tile
  });
  canvas.addEventListener('blur', function () { kbd = null; refresh(); });
  canvas.addEventListener('keydown', function (e) {
    var d = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 }[e.key];
    if (d !== undefined) {
      var h = kbd || ptr || { x: world.start.x, y: world.start.y };
      ptr = null; pxy = null;                      // the keys take over from a resting pointer
      kbd = { x: Math.min(N - 1, Math.max(0, h.x + B.DX[d])), y: Math.min(N - 1, Math.max(0, h.y + B.DY[d])) };
      refresh();
      announce(describe(kbd));
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (kbd) place(kbd); else announce('use the arrow keys to pick a tile first');
    } else return;
    e.preventDefault();
  });

  var head0 = $('dog-head'), helpBtn = $('rl-help'), helpPop = $('rl-pop');
  function helpOpen(open) { helpPop.hidden = !open; helpBtn.setAttribute('aria-expanded', String(open)); }
  helpBtn.addEventListener('click', function () { helpOpen(helpPop.hidden); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || helpPop.hidden) return;
    if (head0.contains(document.activeElement)) helpBtn.focus();
    helpOpen(false);
  });
  document.addEventListener('click', function (e) { if (!head0.contains(e.target)) helpOpen(false); });
  head0.addEventListener('focusout', function (e) { if (!head0.contains(e.relatedTarget)) helpOpen(false); });

  var miniEl = document.querySelector('.mini');
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') miniEl.classList.add('dismissed'); });   // WCAG 1.4.13
  ['mouseleave', 'blur'].forEach(function (ev) { miniEl.addEventListener(ev, function () { miniEl.classList.remove('dismissed'); }); });

  var toolButtons = root.querySelectorAll('[data-tool]');
  Array.prototype.forEach.call(toolButtons, function (btn) {
    btn.addEventListener('click', function () {
      tool = btn.getAttribute('data-tool');
      Array.prototype.forEach.call(toolButtons, function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      refresh();
    });
  });

  $('new-day').addEventListener('click', function () {
    B.resetWorld(world);
    brain.reset();
    attempt = 1; home = 0; decision = null;
    respawn(performance.now());
    values = brain.valueMap();
    $('brain-decision').textContent = '\u00a0';
    $('brain-tip').textContent = '';
    drawBrain();                                   // decision is null: clears the mini canvas
    dirty = true;
    say('newday', 'reset');
    showStats();
    teachMs = 0; ctxUntil = {};
    contextTick(performance.now(), true);
  });

  // ─────────────────────────────── loop ───────────────────────────────
  function paused() { return !ready || !shown || document.hidden || blurred || !onScreen; }
  function animEnd() { return anim.t0 + (anim.kind === 'fall' ? anim.dur * 0.6 + RESPAWN_PAUSE_MS : anim.dur); }
  function frame(now) {
    raf = 0;
    if (paused()) return;                                    // paused: no training, no drawing
    var dt = Math.min(50, now - (lastFrame || now));
    lastFrame = now; teachMs += dt;
    // epsilon returns to >= EPS_ON_MAP_CHANGE on a map change and to EPS_START on new day, which ends the throttle
    var learned = brain.epsilon <= brain.config.EPS_MIN && brain.lossEma < LEARNED_LOSS;
    if (!learned) brain.practice(Math.max(1, Math.round(PRACTICE_PER_FRAME * dt / 16.7)));
    else if (frameNo % PRACTICE_IDLE_EVERY === 0) brain.practice(1);
    // a cursor near the dog stops it before its next step (practice above keeps training); it resumes shortly after the cursor leaves
    if (nearDog(now)) {
      resumeAt = now + NOTICE_RESUME_MS;
      if (now >= animEnd()) faceCursor();
      if (!noticed) { noticed = true; say('notice', 'noticed', true); }
    }
    if (now >= nextStepAt && now >= resumeAt) step(now);
    if (frameNo++ % 15 === 0) {
      values = brain.valueMap(); showStats(); contextTick(now);
      if (!lastValues || values.some(function (v, i) { return Math.abs(v - lastValues[i]) > 0.01; })) { dirty = true; lastValues = values; }
    }
    var moving = now < animEnd();
    if (art) {                                               // the sprite's own animation: redraw when its frame changes
      var f = dogFrame(now), key = f.block * 16 + f.col;
      if (key !== lastFrameKey) { lastFrameKey = key; dirty = true; }
    }
    var fx = fxTick(now);
    if (moving || wasMoving || dirty || fx) draw(now);
    wasMoving = moving;
    raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (raf || paused()) return;
    lastFrame = 0; dirty = true;
    raf = requestAnimationFrame(frame);
  }
  function redraw() { draw(performance.now()); drawBrain(); }

  // site.js tells a showcase when its tab is hidden or shown; hidden = no training, no drawing, brain kept
  root.addEventListener('showcase:hide', function () { shown = false; });
  root.addEventListener('showcase:show', function () { shown = true; onResize(); wake(); });
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('blur', function () { blurred = true; });
  window.addEventListener('focus', function () { blurred = false; wake(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[entries.length - 1].isIntersecting;
      wake();
    }).observe(root);
  }

  var resizeRaf = 0;
  function onResize() {                                      // at most one resize per frame, however many events fire
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; resize(); redraw(); });
  }
  function watchDpr() {                                      // 'resize' does not fire when only devicePixelRatio changes
    matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)').addEventListener('change', function () { onResize(); watchDpr(); }, { once: true });
  }
  window.addEventListener('resize', onResize);
  watchDpr();
  function recolor() { readColors(); redraw(); root.setAttribute('data-theme-seen', document.documentElement.dataset.theme || 'auto'); }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
  window.addEventListener('themechange', recolor);

  readColors();
  if (document.fonts && document.fonts.load) document.fonts.load(BUBBLE_PX + 'px Silkscreen').then(function () { dirty = true; }, function () {});
  resize();
  showStats();
  loadArt(function () {
    ready = true;
    root.setAttribute('data-art', art ? 'sprites' : 'procedural');
    redraw();
    wake();
    root.classList.add('js-ready');                          // init succeeded: hide the fallback, show the widget
  });
})();
