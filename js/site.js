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

  // media: optional path to a gif/image/mp4 poster in assets/, e.g. 'assets/nerf.gif'
  var PROJECTS = [
    { title: 'NeRF, faster', desc: 'CUDA kernels to speed up neural radiance field training.',
      tags: ['cuda', 'nerf'], href: '#', media: '' },
    { title: 'True-scale 3D from drones', desc: 'Structure from motion that recovers real-world scale with YOLOv8 + ArUco markers. IISc poster.',
      tags: ['sfm', 'yolov8'], href: 'assets/papers/raster-poster.pdf', media: '' },
    { title: 'Synthetic SFT data', desc: 'Generating fine-tuning data for a domain-specific LLM assistant.',
      tags: ['llm', 'data'], href: '#', media: '' },
    { title: 'Beach trash from the air', desc: 'Spotting coastal debris in drone images with YOLOv8 + Wise-IoU. Our VIT paper.',
      tags: ['yolov8', 'uav'], href: 'assets/papers/uav-debris-paper.pdf', media: '' }
  ];
  // ═══════════════════════════════════════════════════════════════════════════

  var $ = function (id) { return document.getElementById(id); };

  // links
  $('link-github').href = LINKS.github;
  $('link-linkedin').href = LINKS.linkedin;
  $('link-email').href = 'mailto:' + EMAIL;
  if (EMAIL === 'you@example.com') $('email-wrap').hidden = true;   // don't ship a dead placeholder link

  // showcase tabs: one panel visible; the others get 'showcase:hide' so they stop running
  var tabBar = $('showcase-tabs'), current = null;
  var tabs = SHOWCASES.map(function (sc) {
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
  tabBar.addEventListener('keydown', function (e) {
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
  window.addEventListener('hashchange', function () { var id = fromHash(); if (id) select(id, false); });
  select(fromHash() || SHOWCASES[0].id, false);

  // projects + preview
  var list = $('project-list'), preview = $('project-preview');
  var links = PROJECTS.map(function (p, i) {
    var isLink = p.href && p.href !== '#';
    var li = document.createElement('li'), a = document.createElement(isLink ? 'a' : 'div');
    a.className = 'row';
    a.textContent = p.title;
    if (isLink) {
      var arrow = document.createElement('span');
      a.href = p.href;
      arrow.textContent = '↗';
      arrow.setAttribute('aria-hidden', 'true');
      a.appendChild(arrow);
    } else {
      a.tabIndex = 0;   // still reachable, so keyboard users get the preview too
    }
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
    preview.querySelector('.preview-desc').textContent = p.desc;
    preview.querySelector('.preview-tags').textContent = p.tags.join(' · ');
    var media = preview.querySelector('.preview-media');
    media.hidden = !p.media;
    media.style.cssText = p.media ? 'border-style:solid;background:center/cover no-repeat url("' + encodeURI(p.media) + '")' : '';
  }
  if (PROJECTS.length) show(0);   // the panel is never empty; it keeps the last project you pointed at

  // footer clock
  var clock = $('clock');
  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  function tick() { if (!document.hidden) clock.textContent = fmt.format(new Date()).toLowerCase(); }
  tick();
  setInterval(tick, 5000);
  document.addEventListener('visibilitychange', tick);   // catch up the moment the tab is visible again

  // cursor coordinates
  var coords = $('coords');
  window.addEventListener('pointermove', function (e) {
    coords.textContent = 'x ' + Math.round(e.clientX) + '  y ' + Math.round(e.clientY);
  }, { passive: true });
})();
