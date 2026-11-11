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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
