/* back.js — the "← back" link at the top of a project page.
 * In the HTML it is a plain link to the projects index ("← all projects"), which is what a visitor without JS, or
 * one who arrived from outside the site, gets. When the visitor came from a page of this site, it goes back in
 * history instead (so the home page keeps its tab and scroll), labelled for where they came from.
 *
 * Browser: runs on load.   Node: require('./js/back.js') is backLabel(), for tests/projects.test.js.
 */
(function () {
  'use strict';

  /** The label for the back link, or null to keep the plain link. referrer, here: absolute URLs (http(s) or file). */
  function backLabel(referrer, here) {
    var r, h;
    try { r = new URL(referrer); h = new URL(here); } catch (e) { return null; }
    var site = h.pathname.replace(/projects\/[^/]*$/, '');      // the site root: project pages live in <root>projects/
    if (r.protocol !== h.protocol || r.host !== h.host || r.pathname.indexOf(site) !== 0) return null;   // another site, or outside this one's folder
    var rest = r.pathname.slice(site.length);
    if (rest === '' || rest === 'index.html') return '← home';
    if (rest === 'projects/' || rest === 'projects/index.html') return '← all projects';
    return '← back';
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = backLabel; return; }
  var a = document.querySelector('.back a');
  var label = a && history.length > 1 && backLabel(document.referrer, location.href);   // a page opened in a new tab has nothing to go back to
  if (!label) return;
  a.textContent = label;
  a.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;   // let "open in new tab" through
    e.preventDefault();
    history.back();
  });
})();
