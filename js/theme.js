/* theme.js — light / dark switch. Two states only. The start state is the saved choice, else the OS preference; the tiny inline script in
   <head> applies it before first paint. A click sets html[data-theme], saves it, and fires 'themechange' (the canvases repaint).
   Until the visitor clicks, OS changes are followed live. */
(function () {
  'use strict';

  // ═══════════════════════════ CONFIG — edit here ═══════════════════════════
  var STORE_KEY = 'portfolio-theme';
  var BAR = { light: '#f5f4ef', dark: '#141413' };   // <meta name="theme-color">, kept in step with the page
  // ═══════════════════════════════════════════════════════════════════════════

  var root = document.documentElement, btn = document.getElementById('theme-toggle');
  var bars = document.querySelectorAll('meta[name="theme-color"]');
  var os = window.matchMedia('(prefers-color-scheme: dark)'), chosen = false;
  if (!btn) return;
  try { chosen = !!localStorage.getItem(STORE_KEY); } catch (e) {}

  function isDark() { return root.dataset.theme === 'dark'; }
  function show() {
    btn.setAttribute('aria-checked', String(isDark()));
    btn.title = 'switch to ' + (isDark() ? 'light' : 'dark');
    for (var i = 0; i < bars.length; i++) bars[i].content = BAR[isDark() ? 'dark' : 'light'];   // the forced colour beats the media-scoped pair
  }
  function set(t) {
    root.dataset.theme = t;
    show();
    window.dispatchEvent(new Event('themechange'));
  }
  btn.addEventListener('click', function () {
    var t = isDark() ? 'light' : 'dark';
    chosen = true;
    try { localStorage.setItem(STORE_KEY, t); } catch (e) {}
    set(t);
  });
  os.addEventListener('change', function () { if (!chosen) set(os.matches ? 'dark' : 'light'); });
  show();
})();
