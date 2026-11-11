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

test('every project has slug, title, oneLiner, tags (>=1), where, year, overview.problem, overview.built (>=1), overview.results (>=1)', () => {
  PROJECTS.forEach(p => {
    ['slug', 'title', 'oneLiner', 'where'].forEach(k => assert.ok(typeof p[k] === 'string' && p[k], p.slug + '.' + k));
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

test('there are 7 projects, newest year first', () => {
  assert.strictEqual(PROJECTS.length, 7);
  PROJECTS.forEach((p, i) => assert.ok(!i || p.year <= PROJECTS[i - 1].year, p.slug));
});

// ── generator ──
const { spawnSync } = require('child_process');
const { render } = require(path.join(root, 'tools', 'build.js'));
const SITE = 'https://manishmrgn.github.io/';
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

test('html special characters are escaped', () => {
  const fake = Object.assign({}, PROJECTS[0], { slug: 'fake', title: 'A & <B> "C"', figures: [], pdf: undefined, pdfLabel: undefined });
  const h = render([fake])['projects/fake.html'];
  const want = 'A &amp; &lt;B&gt; &quot;C&quot;';
  assert.ok(new RegExp('<title>[^<]*' + want).test(h), 'title');
  assert.ok(h.includes('property="og:title" content="' + want), 'og:title');
  assert.ok(!h.includes('<B>'));
});

test('pages without a pdf have no <object> and no download link', () => {
  PROJECTS.filter(p => !p.pdf).forEach(p => {
    const h = pages['projects/' + p.slug + '.html'];
    assert.ok(!h.includes('<object') && !h.includes('download'), p.slug);
  });
});

test('pages with a pdf have both', () => {
  PROJECTS.filter(p => p.pdf).forEach(p => {
    const h = pages['projects/' + p.slug + '.html'];
    assert.ok(h.includes('<object data="../' + p.pdf + '"') && /<a [^>]*download/.test(h), p.slug);
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

test('build --check passes', () => {
  const r = spawnSync('node', [path.join(root, 'tools', 'build.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('sitemap lists /, /projects/, /demos.html and every project page', () => {
  const s = pages['sitemap.xml'];
  [SITE, SITE + 'projects/', SITE + 'demos.html'].concat(PROJECTS.map(p => SITE + 'projects/' + p.slug + '.html'))
    .forEach(u => assert.ok(s.includes('<loc>' + u + '</loc>'), u));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
