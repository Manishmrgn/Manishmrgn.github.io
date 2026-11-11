/* build.js — generates projects/*.html and sitemap.xml from js/projects.js.
 *   node tools/build.js           write files
 *   node tools/build.js --check   write nothing; exit 1 listing stale files
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.env.BUILD_ROOT || path.join(__dirname, '..'); // BUILD_ROOT lets tests build into a temp copy
const PROJECTS = require(path.join(root, 'js', 'projects.js'));
const SITE = 'https://manishwaranmurugan.com/';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const THEME_SW = '<button type="button" class="theme-sw" id="theme-toggle" role="switch" aria-checked="false" aria-label="dark mode" title="switch to dark"><span class="knob" aria-hidden="true"><svg class="sun" viewBox="0 0 10 10" width="10" height="10" shape-rendering="crispEdges" fill="currentColor"><path d="M4 0h2v1h-2zM1 1h1v1h-1zM4 1h2v1h-2zM8 1h1v1h-1zM3 2h4v1h-4zM2 3h6v1h-6zM0 4h10v1h-10zM0 5h10v1h-10zM2 6h6v1h-6zM3 7h4v1h-4zM1 8h1v1h-1zM4 8h2v1h-2zM8 8h1v1h-1zM4 9h2v1h-2z"/></svg><svg class="moon" viewBox="0 0 10 10" width="10" height="10" shape-rendering="crispEdges" fill="currentColor"><path d="M3 0h4v1h-4zM2 1h3v1h-3zM1 2h3v1h-3zM1 3h3v1h-3zM1 4h3v1h-3zM1 5h3v1h-3zM2 6h3v1h-3zM3 7h6v1h-6zM4 8h4v1h-4z"/></svg></span></button>';

const RESUME = 'assets/Manishwaran-Murugan-Resume.pdf';
const EMAIL = 'muruganmanishwaran@gmail.com';
const GIZMO = `<svg class="gizmo" viewBox="0 0 40 32" width="40" height="32" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1">
          <line x1="18" y1="18" x2="32" y2="25"/>
          <line x1="18" y1="18" x2="4" y2="25"/>
          <line x1="18" y1="18" x2="18" y2="3"/>
        </g>
        <g font-size="7" fill="currentColor">
          <text x="34" y="30">x</text>
          <text x="0" y="30">y</text>
          <text x="21" y="7">z</text>
        </g>
      </svg>`;

// the right half of every page's header: nav keys, then resume / github / linkedin / email.
// index.html and demos.html carry a copy (b = ''); tests/projects.test.js checks they match.
function topRight(b, cur) {
  const keys = [['home', 'index.html'], ['projects', 'projects/index.html'], ['demos', 'demos.html']]
    .map(([n, h]) => `<a class="key" href="${b}${h}"${n === cur ? ' aria-current="page"' : ''}>${n}</a>`).join('');
  const sep = '<span class="sep" aria-hidden="true"> · </span>';
  return `<div class="top-r">
        <nav class="keys" aria-label="site">${keys}</nav>
        <p class="top-links"><a id="link-resume" class="resume" href="${b}${RESUME}" target="_blank" rel="noopener">resume<span aria-hidden="true">&nbsp;↓</span></a>${sep}<a id="link-github" href="https://github.com/Manishmrgn">github</a>${sep}<a id="link-linkedin" href="https://www.linkedin.com/in/Manishmrgn">linkedin</a>${sep}<a id="link-email" href="mailto:${EMAIL}">${EMAIL}</a></p>
      </div>`;
}

// b = path prefix back to the site root ('../' for projects/, '' for root pages); cur = 'projects' | 'demos'
function layout({ title, desc, url, image, body, b = '../', cur, scripts = [] }) {
  const t = esc(title), d = esc(desc);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t}</title>
  <meta name="description" content="${d}">
  <meta name="color-scheme" content="light dark">
  <link rel="canonical" href="${esc(url)}">
  <meta name="theme-color" id="tc-light" content="#f5f4ef" media="(prefers-color-scheme: light)">
  <meta name="theme-color" id="tc-dark" content="#141413" media="(prefers-color-scheme: dark)">
  <script>var d=document.documentElement,t;try{t=localStorage.getItem("portfolio-theme")}catch(e){}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t</script>
  <link rel="icon" href="${b}favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${b}apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Manishwaran Murugan">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image || SITE + 'og-image.png')}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&family=Silkscreen&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${b}css/style.css">
  <script defer src="${b}js/theme.js"></script>
  <script defer src="${b}js/site.js"></script>${scripts.map(j => `\n  <script defer src="${b}${j}"></script>`).join('')}
</head>
<body class="sub">
  <div class="page">
    <header class="masthead slim">
      <a class="brand" href="${b}index.html">Manishwaran Murugan</a>
      ${topRight(b, cur)}
    </header>
    <main>
${body}
    </main>
    <footer class="foot">
      ${GIZMO}
      <p class="foot-line">santa clara · <time id="clock">--:--</time> ${THEME_SW}</p>
    </footer>
  </div>
</body>
</html>
`;
}

const meta = p => [p.where, p.year].concat(p.with && p.with.length ? ['with ' + p.with.join(', ')] : []).map(esc).join(' · ');
const tags = p => `<ul class="proj-tags">${p.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
const list = a => `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

function projectPage(p) {
  const back = '<p class="back"><a href="index.html">← all projects</a></p>';
  const fig = p.figures.length ? `
      <div class="proj-figs">${p.figures.map(f => `
        <figure><img src="../${esc(f.src)}" alt="${esc(f.alt)}" loading="lazy"><figcaption>${esc(f.caption)}</figcaption></figure>`).join('')}
      </div>` : '';
  const pdf = p.pdf ? `
      <div class="proj-pdf">
        <object data="../${esc(p.pdf)}" type="application/pdf"><a href="../${esc(p.pdf)}">open ${esc(p.pdfLabel)}</a></object>
        <p><a href="../${esc(p.pdf)}" target="_blank" rel="noopener">open ${esc(p.pdfLabel)}</a> · <a href="../${esc(p.pdf)}" download>download</a></p>
      </div>` : '';
  const body = `      ${back}
      <article class="proj">
        <h1>${esc(p.title)}</h1>
        <p class="proj-meta">${meta(p)}</p>
        ${tags(p)}
        <div class="proj-grid">
          <section><h2>problem</h2><p>${esc(p.overview.problem)}</p></section>
          <section><h2>what I built</h2>${list(p.overview.built)}</section>
          <section><h2>results</h2>${list(p.overview.results)}</section>
        </div>${fig}${pdf}
      </article>`;
  return layout({
    title: p.title + ' — Manishwaran Murugan', desc: p.oneLiner, cur: 'projects', scripts: ['js/back.js'],
    url: SITE + 'projects/' + p.slug + '.html',
    image: p.figures[0] ? SITE + p.figures[0].src : null, body
  });
}

function indexPage(projects) {
  const cards = projects.map(p => `
        <li class="card">
          <h2><a href="${esc(p.slug)}.html">${esc(p.title)}</a></h2>
          <p class="proj-meta">${meta(p)}</p>
          <p>${esc(p.oneLiner)}</p>
          ${tags(p)}
          <a href="${esc(p.slug)}.html">read more →</a>
        </li>`).join('');
  return layout({
    title: 'Projects — Manishwaran Murugan', desc: 'Selected ML, computer vision and 3D projects by Manishwaran Murugan.',
    url: SITE + 'projects/', cur: 'projects',
    body: `      <h1>projects</h1>\n      <ul class="cards">${cards}\n      </ul>`
  });
}

function render(projects = PROJECTS) {
  const out = { 'projects/index.html': indexPage(projects) };
  projects.forEach(p => { out['projects/' + p.slug + '.html'] = projectPage(p); });
  const urls = [SITE, SITE + 'projects/', SITE + 'demos.html'].concat(projects.map(p => SITE + 'projects/' + p.slug + '.html'));
  out['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  return out;
}

function main() {
  // fail early, naming the missing path
  PROJECTS.forEach(p => [p.pdf].concat(p.figures.map(f => f.src)).filter(Boolean).forEach(f => {
    if (!fs.existsSync(path.join(root, f))) { console.error('missing file: ' + f + ' (' + p.slug + ')'); process.exit(1); }
  }));
  const out = render(), check = process.argv.includes('--check'), stale = [];
  Object.keys(out).forEach(k => {
    const f = path.join(root, k);
    if (check) { if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== out[k]) stale.push(k); }
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, out[k]); }
  });
  const dir = path.join(root, 'projects');   // pages of projects removed from js/projects.js
  (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(n => n.endsWith('.html') && !out['projects/' + n]).forEach(n => {
    if (check) stale.push('projects/' + n); else fs.unlinkSync(path.join(dir, n));
  });
  if (stale.length) { console.error('stale:\n' + stale.join('\n')); process.exit(1); }
}

if (require.main === module) main();
else module.exports = { render, layout, topRight };
