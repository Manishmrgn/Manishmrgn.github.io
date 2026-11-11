/* split.js — the resizable divider between the left column (him) and the showcase column. Desktop only (>= 1100px).
   Sets --l / --r (fr values) on .stage; the dog lab and the sfm re-fit through their existing window 'resize' handlers. */
(function () {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var DEFAULT = 32;        // showcase column, % of the two columns: the left side leads
  var MIN = 28, MAX = 66;  // range
  var EXPANDED = 64;       // where "expand" goes
  var STEP = 5;            // arrow keys, %
  var ANIM_MS = 220;       // expand / shrink animation (none under prefers-reduced-motion)
  var STORE_KEY = 'portfolio-split-v2';
  var DESKTOP = '(min-width: 1100px)';   // keep in step with css/style.css, js/dog.js, js/sfm.js
  // ═══════════════════════════════════════════════════════════════════════════

  var stage = document.querySelector('.stage'), sep = document.getElementById('split'),
      toggle = document.getElementById('split-toggle'), col = document.querySelector('.showcases');
  if (!stage || !sep || !toggle || !col) return;

  var value = DEFAULT, anim = 0, drag = null, lastW = 0, refitRaf = 0;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function clamp(v) { return Math.min(MAX, Math.max(MIN, v)); }
  function save() { try { localStorage.setItem(STORE_KEY, String(Math.round(value * 10) / 10)); } catch (e) {} }

  /** Show the split. Layout only; the ResizeObserver below tells the showcases. */
  function apply(v) {
    value = clamp(v);
    stage.style.setProperty('--l', (100 - value) + 'fr');
    stage.style.setProperty('--r', value + 'fr');
    sep.setAttribute('aria-valuenow', String(Math.round(value)));
    var open = value >= (DEFAULT + EXPANDED) / 2;   // "shrink" once past the halfway mark
    toggle.innerHTML = open ? '<span aria-hidden="true">⤤</span> shrink' : '<span aria-hidden="true">⤢</span> expand';
    toggle.dataset.open = open ? '1' : '';
  }
  function set(v) { stopAnim(); apply(v); save(); }
  function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
  function glide(to) {
    stopAnim();
    if (reduced.matches) { set(to); return; }
    var from = value, t0 = performance.now();
    (function frame(now) {
      var k = Math.min(1, (now - t0) / ANIM_MS), e = 1 - Math.pow(1 - k, 3);
      apply(from + (to - from) * e);
      if (k < 1) anim = requestAnimationFrame(frame); else { anim = 0; save(); }
    })(t0);
  }

  // start from the saved split, if any
  try {
    var saved = parseFloat(localStorage.getItem(STORE_KEY));
    if (isFinite(saved)) value = clamp(saved);
  } catch (e) {}
  apply(value);

  // keyboard: arrows move the divider itself, so Left grows the showcase column
  sep.addEventListener('keydown', function (e) {
    var to;
    if (e.key === 'ArrowLeft') to = value + STEP;
    else if (e.key === 'ArrowRight') to = value - STEP;
    else if (e.key === 'Home') to = MIN;
    else if (e.key === 'End') to = MAX;
    else return;
    e.preventDefault();
    set(to);
  });
  sep.addEventListener('dblclick', function () { glide(DEFAULT); });

  // pointer (mouse + touch)
  function fromPointer(x) {   // right-column % for a divider centred at x
    var r = stage.getBoundingClientRect(), w = sep.offsetWidth, free = r.width - w;
    return free > 0 ? 100 - (x - drag.grab - r.left - w / 2) / free * 100 : value;
  }
  sep.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    stopAnim();
    var b = sep.getBoundingClientRect();
    drag = { grab: e.clientX - (b.left + b.width / 2), raf: 0, x: e.clientX };
    sep.setPointerCapture(e.pointerId);
    sep.classList.add('is-drag');
    document.body.style.cursor = 'col-resize';
    sep.focus({ preventScroll: true });
    e.preventDefault();
  });
  sep.addEventListener('pointermove', function (e) {
    if (!drag) return;
    drag.x = e.clientX;
    if (!drag.raf) drag.raf = requestAnimationFrame(function () { drag.raf = 0; apply(fromPointer(drag.x)); });
  });
  function end() {
    if (!drag) return;
    if (drag.raf) { cancelAnimationFrame(drag.raf); apply(fromPointer(drag.x)); }
    drag = null;
    sep.classList.remove('is-drag');
    document.body.style.cursor = '';
    save();
  }
  sep.addEventListener('pointerup', end);
  sep.addEventListener('pointercancel', end);
  sep.addEventListener('lostpointercapture', end);

  toggle.addEventListener('click', function () { glide(toggle.dataset.open ? DEFAULT : EXPANDED); });

  // re-fit the showcases whenever their column changes width. They already re-fit on window 'resize', so reuse that path.
  // A real window resize has been handled already (we record the width then), so it is not repeated.
  function refit() {
    refitRaf = 0;
    var w = col.clientWidth;
    if (w === lastW) return;
    lastW = w;
    window.dispatchEvent(new Event('resize'));
  }
  window.addEventListener('resize', function () { lastW = col.clientWidth; });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { if (!refitRaf) refitRaf = requestAnimationFrame(refit); }).observe(col);
  }
  lastW = col.clientWidth;
})();
