/* Tests for js/projects.js — run with:  node tests/projects.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const PROJECTS = require(path.join(root, 'js', 'projects.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

test('every project has slug, title, oneLiner, role, myPart, tags (>=1), year, overview.problem, overview.built (>=1), overview.results (>=1)', () => {
  PROJECTS.forEach(p => {
    ['slug', 'title', 'oneLiner', 'role', 'myPart'].forEach(k => assert.ok(typeof p[k] === 'string' && p[k], p.slug + '.' + k));
    assert.ok(Array.isArray(p.tags) && p.tags.length >= 1, p.slug + ' tags');
    assert.ok(typeof p.year === 'number', p.slug + ' year');
    assert.ok(p.overview && p.overview.problem, p.slug + ' problem');
    assert.ok(p.overview.built.length >= 1, p.slug + ' built');
    assert.ok(p.overview.results.length >= 1, p.slug + ' results');
    assert.ok(Array.isArray(p.figures), p.slug + ' figures');
  });
});

test('slugs are unique and match /^[a-z0-9-]+$/', () => {
  const s = PROJECTS.map(p => p.slug);
  assert.strictEqual(new Set(s).size, s.length);
  s.forEach(x => assert.ok(/^[a-z0-9-]+$/.test(x), x));
});

test('every pdf and figure src exists on disk', () => {
  PROJECTS.forEach(p => {
    if (p.pdf) assert.ok(fs.existsSync(path.join(root, p.pdf)), p.pdf);
    p.figures.forEach(f => assert.ok(fs.existsSync(path.join(root, f.src)), f.src));
  });
});

test('pdf and pdfLabel are both present or both absent', () => {
  PROJECTS.forEach(p => assert.strictEqual(!!p.pdf, !!p.pdfLabel, p.slug));
});

test('the 6 projects come in the agreed order', () => {
  assert.deepStrictEqual(PROJECTS.map(p => p.slug), ['raster', 'debris', 'agent-harness', 'sft-data', 'ai-town', 'price-forecasting']);
});

// ── generator ──
const { spawnSync } = require('child_process');
const os = require('os');
const { render } = require(path.join(root, 'tools', 'build.js'));
const SITE = 'https://manishwaranmurugan.com/';
const pages = render();

test('render() has projects/index.html, one page per slug, and sitemap.xml', () => {
  assert.ok(pages['projects/index.html'] && pages['sitemap.xml']);
  PROJECTS.forEach(p => assert.ok(pages['projects/' + p.slug + '.html'], p.slug));
});

test('each project page has its own <title>, meta description, canonical and og:title/description/url/image', () => {
  PROJECTS.forEach(p => {
    const h = pages['projects/' + p.slug + '.html'];
    assert.ok(/<title>[^<]*<\/title>/.test(h) && h.includes(p.title.replace(/&/g, '&amp;')), p.slug + ' title');
    assert.ok(/<meta name="description" content="[^"]+"/.test(h), p.slug + ' desc');
    assert.ok(h.includes('<link rel="canonical" href="' + SITE + 'projects/' + p.slug + '.html">'), p.slug + ' canonical');
    ['og:title', 'og:description', 'og:url', 'og:image'].forEach(k => assert.ok(h.includes('property="' + k + '"'), p.slug + ' ' + k));
    assert.ok(h.includes('property="og:image" content="' + SITE + (p.figures[0] ? p.figures[0].src : 'og-image.png') + '"'), p.slug + ' og:image');
  });
});

test('html special characters are escaped everywhere', () => {
  const X = `A & <B> "C" 'D'`, E = 'A &amp; &lt;B&gt; &quot;C&quot; &#39;D&#39;';
  const fake = Object.assign({}, PROJECTS[0], {
    slug: 'fake', title: X, oneLiner: X, role: X, myPart: X, tags: [X], with: [X],
    overview: { problem: X, built: [X], results: [X] },
    figures: [{ src: 'assets/projects/raster/pipeline.jpg', alt: X, caption: X }], pdf: undefined, pdfLabel: undefined
  });
  const out = render([fake]);
  Object.keys(out).filter(k => k.endsWith('.html')).forEach(k => {
    const h = out[k];
    assert.ok(!h.includes('<B>') && !h.includes('"C"') && !h.includes("'D'"), k + ' has raw chars');
    assert.ok(h.includes(E), k + ' has escaped form');
  });
  const h = out['projects/fake.html'];
  assert.ok(new RegExp('<title>[^<]*' + E).test(h), 'title');
  assert.ok(h.includes('property="og:title" content="' + E), 'og:title');
  assert.ok(h.includes('alt="' + E + '"'), 'alt');
  assert.ok((h.match(new RegExp(E, 'g')) || []).length >= 10, 'all fields escaped');
});

test('no page embeds a pdf; pages without one have no pdf link', () => {
  PROJECTS.forEach(p => {
    const h = pages['projects/' + p.slug + '.html'];
    assert.ok(!h.includes('<object'), p.slug + ' has an <object>');
    if (!p.pdf) assert.ok(!h.includes('class="proj-pdf"') && !h.includes('(pdf)'), p.slug);
  });
});

test('pages with a pdf link it in the meta line and near the bottom, in a new tab', () => {
  PROJECTS.filter(p => p.pdf).forEach(p => {
    const h = pages['projects/' + p.slug + '.html'], a = '<a href="../' + p.pdf + '" target="_blank" rel="noopener">';
    assert.ok(h.includes('<p class="proj-meta">' + p.role + ' · ' + p.year + ' · ' + a + p.pdfLabel + ' (pdf)'), p.slug + ' meta');
    assert.ok(h.includes('<p class="proj-pdf">' + a + 'read the ' + p.pdfLabel + ' (pdf)'), p.slug + ' bottom');
  });
});

test('page order: meta, with, tags, hero figure, my part, problem; other figures after the results', () => {
  PROJECTS.forEach(p => {
    const h = pages['projects/' + p.slug + '.html'], at = s => h.indexOf(s);
    const seq = ['class="proj-meta"', p.with ? 'class="proj-with"' : null, 'class="proj-tags"', p.figures.length ? 'class="proj-hero"' : null,
      'class="proj-mypart"', '<h2>problem</h2>', '<h2>results</h2>', p.figures.length > 1 ? 'class="proj-figs"' : null].filter(Boolean);
    seq.forEach((k, i) => assert.ok(at(k) > 0 && (!i || at(k) > at(seq[i - 1])), p.slug + ': ' + k));
    const hero = p.figures[0] && h.indexOf(p.figures[0].src, at('<main>'));   // (the head's og:image names it too)
    if (p.figures[0]) assert.ok(hero > at('class="proj-hero"') && hero < at('class="proj-mypart"'), p.slug + ' hero');
  });
});

test('every figure links to its full image in a new tab', () => {
  PROJECTS.forEach(p => p.figures.forEach(f => {
    const h = pages['projects/' + p.slug + '.html'];
    assert.ok(h.includes('<a href="../' + f.src + '" target="_blank" rel="noopener"><img src="../' + f.src + '"'), p.slug + ' ' + f.src);
  }));
});

test('prev/next links follow the project order and wrap at the ends; then email and resume', () => {
  const n = PROJECTS.length;
  PROJECTS.forEach((p, i) => {
    const h = pages['projects/' + p.slug + '.html'], prev = PROJECTS[(i + n - 1) % n], next = PROJECTS[(i + 1) % n];
    assert.ok(h.includes('<a href="' + prev.slug + '.html" rel="prev">← ' + prev.title + '</a>'), p.slug + ' prev');
    assert.ok(h.includes('<a href="' + next.slug + '.html" rel="next">next: ' + next.title + ' →</a>'), p.slug + ' next');
    assert.ok(/want to talk\? <a href="mailto:muruganmanishwaran@gmail.com">email<\/a> · <a href="..\/assets\/Manishwaran-Murugan-Resume.pdf"/.test(h), p.slug + ' talk');
  });
});

test('every relative href/src in a generated page resolves to a file', () => {
  Object.keys(pages).filter(k => k.endsWith('.html')).forEach(k => {
    const re = /\b(?:href|src|data)="([^"]*)"/g; let m;
    while ((m = re.exec(pages[k]))) {
      const u = m[1];
      if (/^([a-z]+:|#|\/\/)/i.test(u)) continue;
      const f = path.join(root, path.dirname(k), u.split('#')[0].split('?')[0]);
      assert.ok(fs.existsSync(f), k + ' -> ' + u);
    }
  });
});

test('index.html and demos.html carry the same header links as the generated pages', () => {
  const { topRight } = require(path.join(root, 'tools', 'build.js'));
  [['index.html', 'home'], ['demos.html', 'demos']].forEach(([f, cur]) =>
    assert.ok(fs.readFileSync(path.join(root, f), 'utf8').includes(topRight('', cur)), f + ' header differs from topRight() in tools/build.js'));
});

test('back link: labelled for a same-site referrer, plain link otherwise', () => {
  const backLabel = require(path.join(root, 'js', 'back.js'));
  const F = 'file:///Users/me/site/', H = 'https://manishwaranmurugan.com/';
  [[F + 'index.html', F + 'projects/raster.html', '← home'],
   [F + 'index.html#sfm', F + 'projects/raster.html', '← home'],
   [F + 'projects/index.html', F + 'projects/raster.html', '← all projects'],
   [F + 'projects/debris.html', F + 'projects/raster.html', '← back'],
   [F + 'demos.html', F + 'projects/raster.html', '← back'],
   ['file:///Users/me/other/index.html', F + 'projects/raster.html', null],
   [H, H + 'projects/raster.html', '← home'],
   [H + 'index.html', H + 'projects/raster.html', '← home'],
   [H + 'projects/', H + 'projects/raster.html', '← all projects'],
   [H + 'projects/index.html?x=1', H + 'projects/raster.html', '← all projects'],
   [H + 'projects/ai-town.html', H + 'projects/raster.html', '← back'],
   ['https://www.google.com/', H + 'projects/raster.html', null],
   ['http://manishwaranmurugan.com/', H + 'projects/raster.html', null],
   ['', H + 'projects/raster.html', null]
  ].forEach(([ref, here, want]) => assert.strictEqual(backLabel(ref, here), want, ref));
});

test('every project page has one back link, a plain link to the projects index, and loads js/back.js', () => {
  PROJECTS.forEach(p => {
    const h = pages['projects/' + p.slug + '.html'];
    assert.strictEqual((h.match(/class="back"/g) || []).length, 1, p.slug);
    assert.ok(h.includes('<p class="back"><a href="index.html">← all projects</a></p>'), p.slug);
    assert.ok(h.includes('<script defer src="../js/back.js"></script>'), p.slug);
  });
});

test('build --check passes', () => {
  const r = spawnSync('node', [path.join(root, 'tools', 'build.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('sitemap lists /, /projects/, /demos.html and every project page', () => {
  const s = pages['sitemap.xml'];
  [SITE, SITE + 'projects/', SITE + 'demos.html'].concat(PROJECTS.map(p => SITE + 'projects/' + p.slug + '.html'))
    .forEach(u => assert.ok(s.includes('<loc>' + u + '</loc>'), u));
});

function tempSite() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-'));
  fs.mkdirSync(path.join(d, 'js'));
  fs.copyFileSync(path.join(root, 'js', 'projects.js'), path.join(d, 'js', 'projects.js'));
  fs.cpSync(path.join(root, 'assets', 'projects'), path.join(d, 'assets', 'projects'), { recursive: true });
  fs.cpSync(path.join(root, 'assets', 'papers'), path.join(d, 'assets', 'papers'), { recursive: true });
  return d;
}
const build = (d, ...args) => spawnSync('node', [path.join(root, 'tools', 'build.js'), ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { BUILD_ROOT: d }) });

test('build --check exits 1 and names a stale page', () => {
  const d = tempSite();
  assert.strictEqual(build(d).status, 0);
  assert.strictEqual(build(d, '--check').status, 0);
  fs.appendFileSync(path.join(d, 'projects', 'raster.html'), '<!-- edited -->');
  const r = build(d, '--check');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('projects/raster.html'), r.stderr);
  fs.rmSync(d, { recursive: true });
});

test('a page left over from a removed project is flagged by --check and deleted by build', () => {
  const d = tempSite();
  assert.strictEqual(build(d).status, 0);
  const old = path.join(d, 'projects', 'old-project.html');
  fs.writeFileSync(old, '<!doctype html>');
  const r = build(d, '--check');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('projects/old-project.html'), r.stderr);
  assert.strictEqual(build(d).status, 0);
  assert.ok(!fs.existsSync(old), 'leftover page still there after build');
  fs.rmSync(d, { recursive: true });
});

test('build fails naming a missing pdf and writes nothing', () => {
  const d = tempSite();
  const f = path.join(d, 'js', 'projects.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('assets/papers/raster-poster.pdf', 'assets/papers/nope.pdf'));
  const r = build(d);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('assets/papers/nope.pdf'), r.stderr);
  assert.ok(!fs.existsSync(path.join(d, 'projects')) && !fs.existsSync(path.join(d, 'sitemap.xml')));
  fs.rmSync(d, { recursive: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
