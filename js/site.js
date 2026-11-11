/* site.js — showcase tabs, projects, hover previews, footer clock, cursor coordinates. */
(function () {
  'use strict';

  // ═══════════════════════════ CONTENT — edit here ═══════════════════════════
  var EMAIL = 'you@example.com';                       // placeholder: put your real address here
  var LINKS = {
    github: 'https://github.com/Manishmrgn',
    linkedin: 'https://www.linkedin.com/in/Manishmrgn'
  };
  var TIME_ZONE = 'America/Los_Angeles';               // footer clock

  // showcase tabs: id = the tabpanel <section id> in index.html. See README, "Adding a showcase".
  var SHOWCASES = [
    { id: 'dog-lab', label: 'dog lab' },
    { id: 'sfm', label: 'sfm in a box' },
    { id: 'golf', label: 'gradient golf' }
  ];

  // ═══════════════════════════════════════════════════════════════════════════

  var $ = function (id) { return document.getElementById(id); };

  // links
  if ($('link-github')) {   // home only; demos.html has the plain footer
    $('link-github').href = LINKS.github;
    $('link-linkedin').href = LINKS.linkedin;
    $('link-email').href = 'mailto:' + EMAIL;
    if (EMAIL === 'you@example.com') $('email-wrap').hidden = true;   // don't ship a dead placeholder link
  }

  // showcase tabs: one panel visible; the others get 'showcase:hide' so they stop running
  var tabBar = $('showcase-tabs'), current = null;
  var tabs = !tabBar ? [] : SHOWCASES.map(function (sc) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.id = 'tab-' + sc.id; b.textContent = sc.label;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', sc.id);
    b.addEventListener('click', function () { select(sc.id, true); });
    tabBar.appendChild(b);
    $(sc.id).setAttribute('aria-labelledby', b.id);
    return b;
  });
  function select(id, writeHash) {
    if (id !== current) {
      SHOWCASES.forEach(function (sc, i) {
        var on = sc.id === id, panel = $(sc.id);
        tabs[i].setAttribute('aria-selected', String(on));
        tabs[i].tabIndex = on ? 0 : -1;
        if (panel.hidden !== !on || current === null) {
          panel.hidden = !on;
          panel.dispatchEvent(new CustomEvent(on ? 'showcase:show' : 'showcase:hide'));
        }
      });
      current = id;
    }
    if (writeHash) history.replaceState(null, '', '#' + id);
  }
  function fromHash() {
    var id = location.hash.slice(1);
    return SHOWCASES.some(function (sc) { return sc.id === id; }) ? id : null;
  }
  if (tabBar) tabBar.addEventListener('keydown', function (e) {
    var i = tabs.indexOf(document.activeElement), n = tabs.length, to;
    if (i < 0) return;
    if (e.key === 'ArrowRight') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft') to = (i + n - 1) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    else return;
    e.preventDefault();
    tabs[to].focus();
    select(SHOWCASES[to].id, true);
  });
  if (tabBar) window.addEventListener('hashchange', function () { var id = fromHash(); if (id) select(id, false); });
  if (tabBar) select(fromHash() || SHOWCASES[0].id, false);

  // projects + preview
  var list = $('project-list'), preview = $('project-preview');
  var PROJECTS = window.PROJECTS || [];   // js/projects.js
  var links = !list ? [] : PROJECTS.map(function (p, i) {
    var li = document.createElement('li'), a = document.createElement('a'), arrow = document.createElement('span');
    a.className = 'row';
    a.textContent = p.title;
    a.href = 'projects/' + p.slug + '.html';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    a.appendChild(arrow);
    a.addEventListener('mouseenter', function () { show(i); });
    a.addEventListener('focus', function () { show(i); });
    li.appendChild(a);
    list.appendChild(li);
    return a;
  });

  function show(i) {
    var p = PROJECTS[i];
    links.forEach(function (a, k) { a.classList.toggle('is-active', k === i); });
    preview.querySelector('.preview-title').textContent = p.title;
    preview.querySelector('.preview-desc').textContent = p.oneLiner;
    preview.querySelector('.preview-tags').textContent = p.tags.join(' · ');
    var media = preview.querySelector('.preview-media');
    media.hidden = !p.media;
    media.style.cssText = p.media ? 'border-style:solid;background:center/cover no-repeat url("' + encodeURI(p.media) + '")' : '';
  }
  if (list && PROJECTS.length) show(0);   // the panel is never empty; it keeps the last project you pointed at

  // footer clock
  var clock = $('clock');
  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  function tick() { if (!document.hidden) clock.textContent = fmt.format(new Date()).toLowerCase(); }
  if (clock) {
    tick();
    setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);   // catch up the moment the tab is visible again
  }

  // cursor coordinates
  var coords = $('coords');
  if (coords) window.addEventListener('pointermove', function (e) {
    coords.textContent = 'x ' + Math.round(e.clientX) + '  y ' + Math.round(e.clientY);
  }, { passive: true });
})();
