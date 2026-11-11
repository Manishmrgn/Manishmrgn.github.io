"""Smoke test for the portfolio. Run: python tests/smoke.py   (needs: pip install playwright)
Loads index.html over file://, then checks console errors, overflow at several viewports, that the
sprites load (and that the widget still runs without them), that clicking tiles places pieces,
that clicking the dog pets it, and the credits popover. Then the "sfm in a box" tab: switching
pauses the dog, dragging a camera changes the 3D points, refine, film it, densify, the context
messages. Then the "gradient golf" tab: switching, a swing on hole 1 sinking within par, the optimizer
chips, playing by keyboard, and one screen at the default and expanded split in light and dark.
Exits non-zero on any FAIL."""
import os
import subprocess
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

# ═══════════════════════════ CONFIG — edit here ═══════════════════════════
SITE_INDEX = Path(__file__).resolve().parent.parent / "index.html"
BROWSER_CHANNEL = "chrome"        # system Chrome; set to None to use Playwright's bundled Chromium
NO_SCROLL_VIEWPORTS = [(1280, 800), (1440, 900)]   # desktop: the page must fit with no scroll at all
MOBILE_VIEWPORT = (390, 844)      # phone: vertical scroll is fine, horizontal overflow is not
DESKTOP_VIEWPORT = (1280, 800)    # used for the console and click checks
SETTLE_MS = 500                   # wait after load before measuring
CLICK_WAIT_MS = 300               # wait after a click before reading the log
PAGE_TIMEOUT_MS = 15000
MUD_TILE = (5, 5)                 # a ground tile the dog cannot have reached yet (far side of the river)
HOVER_HOLD_MS = 1200              # the dog must stay put this long under a resting pointer
PET_TRIES = 8                     # the dog keeps walking, so a click can land a step late; try this many times
PET_LINES = ["good boy acknowledged.", "pets received. productivity down."]   # keep in step with THOUGHTS.pet
BUBBLE_GONE_MS = 4000             # bubble (2.2s) and hearts (1s) must be gone within this
BROKEN_ASSET = "**/assets/tiles/mud.png"   # blocked in the fallback check
SFM_STEADY_MS = 1000              # the dog must take no step for this long while the sfm tab is open
SFM_DRAG_PX = (-70, 25)           # drag camera 2 by this much
SFM_REFINE_WAIT_MS = 2000         # auto-refine starts 0.7s after a change and runs ~0.7s
SFM_FILM_TIMEOUT_MS = 9000        # "film it" takes about 4s
SFM_FILM_FRAMES = 24              # keep in step with FILM_FRAMES in js/sfm.js
SFM_MAX_CAMS = 16                 # … and MAX_CAMS
SFM_MATCH_LINES = 36              # … and MATCH_LINES
SFM_CONTEXT_TIMEOUT_MS = 12000    # a context message may wait out the previous one (4s) first
SFM_HELP_MAX_WORDS = 70
SFM_TEACH_FIRST = "drag the cameras. points seen twice become 3D."        # keep in step with CONTEXT in js/sfm.js
SFM_TOO_CLOSE = "rotate it: two close cameras smear points in depth."
SFM_SPIN_WAIT_MS = 700               # long enough for the slow auto-spin to move the view by a degree or more
SFM_RECON_DRAG_PX = (60, 30)      # drag on the reconstruction canvas by this much
SFM_SCAN = "that's a real scan now: more views, denser points."   # keep in step with CONTEXT in js/sfm.js
SFM_TEMPLE_CONTEXT = "scanning the temple."   # start of CONTEXT.scene.temple in js/sfm.js
SFM_BELOW_KEYS = 10                # arrow presses (5 degrees each) to take a camera from the ring to below the ground
SFM_CAT_CONTEXT = "scanning the lucky cat."   # start of CONTEXT.scene.cat in js/sfm.js
SFM_SNACK_CONTEXT = "scanning the snack machine."   # start of CONTEXT.scene.snack in js/sfm.js
SFM_ONE_VIEW = "one view can't tell depth. add another camera."
SPLIT_DEFAULT, SPLIT_MIN, SPLIT_MAX, SPLIT_EXPANDED, SPLIT_STEP = 32, 28, 66, 64, 5   # keep in step with js/split.js
SPLIT_ANIM_WAIT_MS = 500          # expand / shrink glide is 220ms
SPLIT_DRAG_PX = -120              # drag the grip this far sideways (left = wider showcase)
NARROW_VIEWPORT = (1000, 800)     # under 1100px: no divider
CREDIT_URL = "https://sketchfab.com/3d-models/stylized-dog-f8197b0813aa4d9cacb7c3939459950b"
GOLF_HOLES = ["1 bowl", "2 fake hole", "3 ravine", "4 plateau", "5 windy"]   # keep in step with HOLES in js/golf-core.js
GOLF_INTRO = "the ball is the model, the hill is the loss. each hop = one gradient step."   # CONTEXT.intro[0] in js/golf.js
GOLF_SWING_TIMEOUT_MS = 9000      # a swing plays back in at most SWING_MS (3s) in js/golf-core.js
GOLF_OUT_STEPS = "3"              # hole 1 at the largest learning rate: one step off the course, plus the 2-stroke penalty
GOLF_LR_DEFAULT_STEP = 40         # slider position of the default learning rate, 0.20
GOLF_WIDE_MIN = 500               # WIDE_MIN in js/golf.js: from this panel width the controls sit beside the course
GOLF_CART_URL = "https://sketchfab.com/3d-models/golf-cart-db115793a8274dc18b2b277bf6c97703"
# ═══════════════════════════════════════════════════════════════════════════

PROJECT_SLUGS = subprocess.run(["node", "-p", "require('./js/projects.js').map(p=>p.slug).join(',')"], capture_output=True, text=True, check=True, cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))).stdout.strip().split(",")
PROJECT_PDF_SLUG = "raster"       # has a pdf and three figures; ai-town has neither

FAILS = []


def check(name, ok, detail=""):
    print(("PASS" if ok else "FAIL") + "  " + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        FAILS.append(name)


# tile centre in page coordinates, from the same iso maths dog.js uses (tile width = (canvas width - 12) / grid)
TILE_JS = """([tx, ty]) => {
  const B = window.DogBrain, c = document.getElementById('dog-canvas'), r = c.getBoundingClientRect();
  const N = B.CONFIG.GRID, T = (r.width - 12) / N, K = T / 44, OX = r.width / 2, OY = Math.round(34 * K);
  const x = tx + 0.5, y = ty + 0.5;
  return { x: r.left + OX + (x - y) * T / 2, y: r.top + OY + (x + y) * T / 4 };
}"""
GAP_TILE_JS = "() => [window.DogBrain.CONFIG.RIVER_X, window.DogBrain.CONFIG.RIVER_Y_FROM]"
# the dog's tile, read back from the screen-reader description of the keyboard cursor: "tile x, y: floor, the dog"
LIVE_JS = "() => document.getElementById('dog-live').textContent.trim()"
FIRST_SIGNAL = "#thought-log li:first-child span:nth-child(3)"

OVERFLOW_JS = """() => {
  const de = document.documentElement;
  const line = document.querySelector('.foot-line');
  return { v: de.scrollHeight - innerHeight, h: de.scrollWidth - innerWidth,
           footLines: Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)),
           logGap: document.querySelector('.foot').getBoundingClientRect().top - document.querySelector('.thoughts').getBoundingClientRect().bottom };
}"""


SFM_OVERFLOW_JS = """() => {
  const de = document.documentElement;
  return { v: de.scrollHeight - innerHeight, h: de.scrollWidth - innerWidth,
           logGap: document.querySelector('.foot').getBoundingClientRect().top - document.getElementById('sfm-stats').getBoundingClientRect().bottom };
}"""
# count the visible dog's steps: dog.js rewrites #brain-decision once per step
WATCH_DOG_JS = ("window.__steps = 0; new MutationObserver(m => window.__steps += m.length).observe("
                "document.getElementById('brain-decision'), { childList: true })")


def sfm_stat(page, name):
    return page.inner_text(f"#sfm-stat-{name}")


def sfm_checks(browser):
    """The second showcase tab: structure from motion on a voxel snack machine (or temple, or lucky cat)."""
    page = open_page(browser, DESKTOP_VIEWPORT)
    check("sfm: widget initialised (js-ready)", page.evaluate("document.getElementById('sfm').classList.contains('js-ready')"))
    check("sfm: panel hidden while the dog lab is open", not page.is_visible("#sfm"))
    page.evaluate(WATCH_DOG_JS)
    page.wait_for_timeout(SFM_STEADY_MS)
    check("the dog steps while its tab is open", page.evaluate("window.__steps") > 0)

    page.click("#tab-sfm")
    check("sfm: tab switch shows the panel and hides the dog", page.is_visible("#sfm") and not page.is_visible("#dog-lab")
          and page.get_attribute("#tab-sfm", "aria-selected") == "true" and page.url.endswith("#sfm"))
    page.wait_for_timeout(CLICK_WAIT_MS)
    page.evaluate("window.__steps = 0")
    page.wait_for_timeout(SFM_STEADY_MS)
    check("sfm: the dog is paused while hidden", page.evaluate("window.__steps") == 0, f"steps = {page.evaluate('window.__steps')}")

    check("sfm: the snack machine is the default scene (picker: snacks, temple, lucky cat)", page.get_attribute("#sfm", "data-object") == "snack"
          and page.get_attribute("#sfm-obj-snack", "aria-pressed") == "true" and page.get_attribute("#sfm-obj-temple", "aria-pressed") == "false"
          and page.get_attribute("#sfm-obj-cat", "aria-pressed") == "false"
          and page.locator("#sfm-objs button").all_inner_texts() == ["snacks", "temple", "lucky cat"], repr(page.get_attribute("#sfm", "data-object")))
    ctx_line = lambda: page.inner_text("#sfm-context")
    check("sfm: context opens with the first teaching line", ctx_line() == SFM_TEACH_FIRST, repr(ctx_line()))
    check("sfm: context line is a polite live region", page.get_attribute("#sfm-context", "aria-live") == "polite")
    check("sfm: starts with 3 cameras and some 3D points", sfm_stat(page, "cams") == "3" and int(sfm_stat(page, "points")) > 10,
          page.inner_text("#sfm-stats"))
    check("sfm: stats carry title tooltips", page.locator("#sfm-stats span[title]").count() == 5)

    page.click("#sfm-help")
    pop = page.inner_text("#sfm-pop")
    check("sfm: ? opens the explainer", page.is_visible("#sfm-pop") and page.get_attribute("#sfm-help", "aria-expanded") == "true")
    check(f"sfm: explainer is short (<= {SFM_HELP_MAX_WORDS} words)", len(pop.split()) <= SFM_HELP_MAX_WORDS, str(len(pop.split())))
    check("sfm: explainer admits the matching is given", "the matching is given, the geometry is real" in pop)
    page.keyboard.press("Escape")
    check("sfm: Esc closes the explainer", not page.is_visible("#sfm-pop"))

    cam2 = page.locator(".sfm-cam").nth(1)
    box = cam2.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    points_before, label_before = sfm_stat(page, "points"), cam2.get_attribute("aria-label")
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + SFM_DRAG_PX[0] / 2, y + SFM_DRAG_PX[1] / 2)
    page.mouse.move(x + SFM_DRAG_PX[0], y + SFM_DRAG_PX[1])
    page.mouse.up()
    page.wait_for_timeout(CLICK_WAIT_MS)
    check("sfm: dragging a camera moves it", cam2.get_attribute("aria-label") != label_before, repr(label_before))
    check("sfm: dragging a camera changes the 3D point count", sfm_stat(page, "points") != points_before, f"still {points_before}")
    row = [page.get_attribute("#sfm", "data-event-text") or "", page.get_attribute("#sfm", "data-event")]
    check("sfm: the move is recorded as a triangulate step", row[0].startswith("cam 2 moved:") and row[1] == "triangulate", repr(row))
    err_before = float(sfm_stat(page, "err").split()[0])
    page.wait_for_timeout(SFM_REFINE_WAIT_MS)
    err_after = float(sfm_stat(page, "err").split()[0])
    check("sfm: auto-refine lowers the reprojection error", err_after < err_before, f"{err_before} -> {err_after} px")
    check("sfm: the refine is recorded", page.get_attribute("#sfm", "data-event") == "refine")

    cam2.focus()
    label_before = cam2.get_attribute("aria-label")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowUp")
    check("sfm: arrow keys move the focused camera", cam2.get_attribute("aria-label") != label_before
          and page.inner_text("#sfm-live").startswith("camera 2: azimuth"), repr(page.inner_text("#sfm-live")))

    page.click("#sfm-add")
    check("sfm: + camera adds one", sfm_stat(page, "cams") == "4" and page.locator(".sfm-cam").count() == 4)
    page.click("#sfm-x")
    check("sfm: × removes the selected camera", sfm_stat(page, "cams") == "3" and page.locator(".sfm-cam").count() == 3)

    points_before = int(sfm_stat(page, "points"))
    page.click("#sfm-film")
    page.wait_for_function(f"document.getElementById('sfm-stat-frames').textContent === '{SFM_FILM_FRAMES}'", timeout=SFM_FILM_TIMEOUT_MS)
    check("sfm: film it adds frames (not cameras) and points", int(sfm_stat(page, "points")) > points_before and sfm_stat(page, "cams") == "3"
          and page.locator(".sfm-cam").count() == 3, f"{points_before} -> {sfm_stat(page, 'points')}")
    ml = page.get_attribute("#sfm-thumbs", "data-match-lines")
    check(f"sfm: at most {SFM_MATCH_LINES} match lines drawn, however many matches", ml is not None and 0 < int(ml) <= SFM_MATCH_LINES, f"{ml} lines, {sfm_stat(page, 'matches')} matches")
    check("sfm: at 1280 the scene picker keeps its · separators", page.evaluate("[...document.querySelectorAll('#sfm-objs > span[aria-hidden]')].every(e => getComputedStyle(e).display !== 'none')"))
    check("sfm: film makes ONE filmstrip thumb, labelled with its frame count", page.locator("#sfm-film-thumb:visible").count() == 1
          and f"{SFM_FILM_FRAMES} frames" in page.get_attribute("#sfm-film-thumb", "aria-label"))
    box = page.locator("#sfm-film-thumb").bounding_box()
    page.mouse.move(box["x"] + 2, box["y"] + box["height"] / 2)
    page.mouse.move(box["x"] + box["width"] - 2, box["y"] + box["height"] / 2)
    check("sfm: hovering the filmstrip scrubs its frames", page.get_attribute("#sfm-film-thumb", "aria-valuenow") == str(SFM_FILM_FRAMES),
          page.get_attribute("#sfm-film-thumb", "aria-valuetext"))
    page.locator("#sfm-film-thumb").focus()
    page.keyboard.press("Home"); page.keyboard.press("ArrowRight")
    check("sfm: arrow keys scrub the filmstrip", page.get_attribute("#sfm-film-thumb", "aria-valuenow") == "2", page.get_attribute("#sfm-film-thumb", "aria-valuetext"))
    page.click("#sfm-film")
    page.wait_for_function(f"document.getElementById('sfm-stat-frames').textContent === '{SFM_FILM_FRAMES}'", timeout=SFM_FILM_TIMEOUT_MS)
    page.wait_for_timeout(CLICK_WAIT_MS)
    check("sfm: filming again replaces the film (still one thumb, 24 frames)", page.locator("#sfm-film-thumb:visible").count() == 1
          and sfm_stat(page, "frames") == str(SFM_FILM_FRAMES))
    page.click("#sfm-film-x")
    check("sfm: x on the filmstrip removes the film", sfm_stat(page, "frames") == "0" and page.locator("#sfm-film-thumb:visible").count() == 0 and sfm_stat(page, "cams") == "3")
    page.click("#sfm-film")
    page.wait_for_function(f"document.getElementById('sfm-stat-frames').textContent === '{SFM_FILM_FRAMES}'", timeout=SFM_FILM_TIMEOUT_MS)
    while not page.is_disabled("#sfm-add"):
        page.click("#sfm-add")
    check("sfm: + camera is disabled at 16", page.is_disabled("#sfm-add") and sfm_stat(page, "cams") == str(SFM_MAX_CAMS) and page.locator(".sfm-cam").count() == SFM_MAX_CAMS)
    o = page.evaluate(SFM_OVERFLOW_JS)
    check("sfm: no page overflow with 16 cameras + film", o["v"] <= 0 and o["h"] <= 0 and o["logGap"] >= 0, str(o))
    st = page.evaluate("(() => { const s = document.getElementById('sfm-strip'); return { sw: s.scrollWidth, cw: s.clientWidth, tab: s.getAttribute('tabindex'), ox: getComputedStyle(s).overflowX }; })()")
    check("sfm: a strip too long to fit scrolls inside itself, reachable by keyboard", st["ox"] == "auto" and (st["sw"] <= st["cw"] + 1 or st["tab"] == "0"), str(st))
    page.evaluate("document.getElementById('sfm-strip').focus()")
    try:
        page.wait_for_function(f"document.getElementById('sfm-context').textContent === {SFM_SCAN!r}", timeout=SFM_CONTEXT_TIMEOUT_MS)
    except Exception:
        pass
    check("sfm: 20+ views all the way round raise the real-scan message", ctx_line() == SFM_SCAN, repr(ctx_line()))
    page.click("#sfm-film-x")

    recon = "#sfm-recon"
    attr = lambda name: page.get_attribute(recon, name)
    check("sfm: reconstruction canvas exists, starts in points mode, no true-model draw", page.locator(recon).count() == 1
          and attr("data-mode") == "points" and attr("data-ghost") == "0" and page.get_attribute("#sfm-mode-points", "aria-pressed") == "true")
    check("sfm: reconstruction canvas is keyboard-focusable and labelled", attr("tabindex") == "0" and "arrow keys" in (attr("aria-label") or ""))
    az0 = int(attr("data-az"))
    page.wait_for_timeout(SFM_SPIN_WAIT_MS)
    check("sfm: the reconstruction auto-spins", int(attr("data-az")) != az0, f"{az0} -> {attr('data-az')}")
    page.click("#sfm-mode-voxels")
    check("sfm: voxels mode is on and recorded", attr("data-mode") == "voxels" and attr("data-ghost") == "0"
          and page.get_attribute("#sfm-mode-voxels", "aria-pressed") == "true" and page.get_attribute("#sfm-mode-points", "aria-pressed") == "false"
          and page.get_attribute("#sfm", "data-event") == "densify")
    page.click("#sfm-mode-compare")
    check("sfm: compare mode draws the ghost model", attr("data-mode") == "compare" and attr("data-ghost") == "1")
    page.click("#sfm-mode-points")
    check("sfm: points mode again drops the ghost", attr("data-mode") == "points" and attr("data-ghost") == "0")
    box = page.locator(recon).bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    el0 = int(attr("data-el"))
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + SFM_RECON_DRAG_PX[0], cy + SFM_RECON_DRAG_PX[1], steps=6)
    el_mid = int(attr("data-el")); az_mid = attr("data-az")
    page.wait_for_timeout(SFM_SPIN_WAIT_MS)
    check("sfm: spin pauses while dragging", attr("data-az") == az_mid, f"{az_mid} -> {attr('data-az')}")
    page.mouse.up()
    check("sfm: dragging the reconstruction changes its view angle", el_mid != el0, f"{el0} -> {el_mid}")
    page.focus(recon)
    az1 = attr("data-az")
    page.keyboard.press("ArrowRight")
    check("sfm: arrow keys rotate the focused reconstruction", attr("data-az") != az1 and page.inner_text("#sfm-live").startswith("reconstruction:"), f"{az1} -> {attr('data-az')}")
    page.click("#sfm-rays")
    check("sfm: show rays toggles", page.get_attribute("#sfm-rays", "aria-pressed") == "true")

    while page.locator(".sfm-cam").count() > 2:          # two cameras, then walk one next to the other
        page.click("#sfm-x")
    page.locator(".sfm-cam").nth(1).focus()
    import re                                            # walk camera 2 round to camera 1's azimuth and down to its elevation, 5 degrees a key
    pose = lambda i: [int(v) for v in re.findall(r"azimuth (\d+)\D+elevation (-?\d+)", page.locator(".sfm-cam").nth(i).get_attribute("aria-label"))[0]]
    (az1, el1), (az2, el2) = pose(0), pose(1)
    turn = (az2 - az1 + 180) % 360 - 180
    for _ in range(abs(round(turn / 5))):
        page.keyboard.press("ArrowLeft" if turn > 0 else "ArrowRight")
    for _ in range(abs(round((el2 - el1) / 5))):
        page.keyboard.press("ArrowDown" if el2 > el1 else "ArrowUp")
    try:
        page.wait_for_function(f"document.getElementById('sfm-context').textContent === {SFM_TOO_CLOSE!r}", timeout=SFM_CONTEXT_TIMEOUT_MS)
    except Exception:
        pass
    check("sfm: two cameras side by side raise the bad-baseline message", ctx_line() == SFM_TOO_CLOSE, repr(ctx_line()))
    page.keyboard.press("Delete")
    check("sfm: Delete removes the focused camera, leaving no 3D points", sfm_stat(page, "cams") == "1" and sfm_stat(page, "points") == "0"
          and not page.is_visible("#sfm-x"), page.inner_text("#sfm-stats"))
    try:
        page.wait_for_function(f"document.getElementById('sfm-context').textContent === {SFM_ONE_VIEW!r}", timeout=SFM_CONTEXT_TIMEOUT_MS)
    except Exception:
        pass
    check("sfm: one camera raises the one-view message", ctx_line() == SFM_ONE_VIEW, repr(ctx_line()))

    page.click("#tab-dog-lab")
    page.evaluate("window.__steps = 0")
    page.wait_for_timeout(SFM_STEADY_MS)
    check("switching back shows the dog and it walks again", page.is_visible("#dog-lab") and not page.is_visible("#sfm") and page.evaluate("window.__steps") > 0)
    check("sfm: zero console errors", not page.errors, "; ".join(page.errors))
    page.close()

    for size in NO_SCROLL_VIEWPORTS:
        page = open_page(browser, size)
        page.goto(SITE_INDEX.as_uri() + "#sfm")
        page.wait_for_timeout(SETTLE_MS)
        if size == NO_SCROLL_VIEWPORTS[0]:
            check("#sfm hash selects the tab", page.get_attribute("#tab-sfm", "aria-selected") == "true" and page.is_visible("#sfm") and not page.is_visible("#dog-lab"))
        o = page.evaluate(SFM_OVERFLOW_JS)
        check(f"sfm: no overflow or scroll at {size[0]}x{size[1]}", o["v"] <= 0 and o["h"] <= 0 and o["logGap"] >= 0, str(o))
        while not page.is_disabled("#sfm-add"):
            page.click("#sfm-add")
        page.click("#sfm-film")
        page.wait_for_function(f"document.getElementById('sfm-stat-frames').textContent === '{SFM_FILM_FRAMES}'", timeout=SFM_FILM_TIMEOUT_MS)
        o = page.evaluate(SFM_OVERFLOW_JS)
        check(f"sfm: no overflow or scroll at {size[0]}x{size[1]} with 16 cameras + film", o["v"] <= 0 and o["h"] <= 0 and o["logGap"] >= 0, str(o))
        # the scene picker: swap the snack machine for the lucky cat (cameras stay, film and points restart)
        cams_before = sfm_stat(page, "cams")
        page.click("#sfm-obj-cat")
        page.wait_for_timeout(CLICK_WAIT_MS)
        if size == NO_SCROLL_VIEWPORTS[0]:
            check("sfm: the picker switches the object (data-object=cat)", page.get_attribute("#sfm", "data-object") == "cat" and page.get_attribute("#sfm-obj-cat", "aria-pressed") == "true"
                  and page.get_attribute("#sfm-obj-snack", "aria-pressed") == "false", repr(page.get_attribute("#sfm", "data-object")))
            check("sfm: switching keeps the cameras but drops the film", sfm_stat(page, "cams") == cams_before and sfm_stat(page, "frames") == "0")
            check("sfm: switching is recorded as 'scene: lucky cat'", [page.get_attribute("#sfm", "data-event-text"), page.get_attribute("#sfm", "data-event")] == ["scene: lucky cat", "scene"],
                  repr(page.get_attribute("#sfm", "data-event-text")))
            check("sfm: the cat has landmarks and gets 3D points", int(page.get_attribute("#sfm", "data-landmarks")) > 0 and int(sfm_stat(page, "points")) > 0, sfm_stat(page, "points"))
            try:
                page.wait_for_function(f"document.getElementById('sfm-context').textContent.startsWith({SFM_CAT_CONTEXT!r})", timeout=SFM_CONTEXT_TIMEOUT_MS)
                check("sfm: context band says what is being scanned", True)
            except Exception:
                check("sfm: context band says what is being scanned", False, repr(page.inner_text("#sfm-context")))
            check("sfm: the hash stays #sfm", page.url.endswith("#sfm"))
        page.click("#sfm-film")
        page.wait_for_function(f"document.getElementById('sfm-stat-frames').textContent === '{SFM_FILM_FRAMES}'", timeout=SFM_FILM_TIMEOUT_MS)
        page.click("#sfm-mode-voxels")
        page.click("#sfm-mode-compare")
        o = page.evaluate(SFM_OVERFLOW_JS)
        check(f"sfm: no overflow or scroll at {size[0]}x{size[1]} with the lucky cat (16 cameras + film)", o["v"] <= 0 and o["h"] <= 0 and o["logGap"] >= 0, str(o))
        # the temple: cameras stay, film and points restart, still one screen
        page.click("#sfm-obj-temple")
        page.wait_for_timeout(CLICK_WAIT_MS)
        if size == NO_SCROLL_VIEWPORTS[0]:
            check("sfm: the picker selects the temple (data-object=temple)", page.get_attribute("#sfm", "data-object") == "temple"
                  and page.get_attribute("#sfm-obj-temple", "aria-pressed") == "true" and page.get_attribute("#sfm-obj-cat", "aria-pressed") == "false"
                  and sfm_stat(page, "frames") == "0", repr(page.get_attribute("#sfm", "data-object")))
            check("sfm: switching is recorded as 'scene: temple'", [page.get_attribute("#sfm", "data-event-text"), page.get_attribute("#sfm", "data-event")] == ["scene: temple", "scene"],
                  repr(page.get_attribute("#sfm", "data-event-text")))
            check("sfm: the temple has landmarks and gets 3D points", int(page.get_attribute("#sfm", "data-landmarks")) > 0 and int(sfm_stat(page, "points")) > 0)
            try:
                page.wait_for_function(f"document.getElementById('sfm-context').textContent.startsWith({SFM_TEMPLE_CONTEXT!r})", timeout=SFM_CONTEXT_TIMEOUT_MS)
                check("sfm: context band names the temple", True)
            except Exception:
                check("sfm: context band names the temple", False, repr(page.inner_text("#sfm-context")))
        # cameras may go below the ground: down arrow past the ring, the underside gets seen, the points change
        if size == NO_SCROLL_VIEWPORTS[0]:
            pts_before = sfm_stat(page, "points")
            page.locator(".sfm-cam").nth(1).focus()
            for _ in range(SFM_BELOW_KEYS):
                page.keyboard.press("ArrowDown")
            el = int(re.findall(r"elevation (-?\d+)", page.locator(".sfm-cam").nth(1).get_attribute("aria-label"))[0])
            check("sfm: a camera can be keyed below the ground (elevation < 0)", el < 0, f"elevation {el}")
            page.wait_for_timeout(CLICK_WAIT_MS)
            check("sfm: the temple's point count changes when a camera goes below", sfm_stat(page, "points") != pts_before, f"{pts_before} -> {sfm_stat(page, 'points')}")
            page.locator("#sfm-recon").focus()
            for _ in range(SFM_BELOW_KEYS * 2):
                page.keyboard.press("ArrowDown")      # turns the reconstruction view down … 
            for _ in range(SFM_BELOW_KEYS * 4):
                page.keyboard.press("ArrowUp")        # … and up past the horizon
            check("sfm: the reconstruction can be viewed from below (elevation < 0)", int(page.get_attribute("#sfm-recon", "data-el")) < 0, page.get_attribute("#sfm-recon", "data-el"))
        page.click("#sfm-film")
        page.wait_for_function(f"document.getElementById('sfm-stat-frames').textContent === '{SFM_FILM_FRAMES}'", timeout=SFM_FILM_TIMEOUT_MS)
        page.click("#sfm-mode-voxels")
        page.click("#sfm-mode-compare")
        o = page.evaluate(SFM_OVERFLOW_JS)
        check(f"sfm: no overflow or scroll at {size[0]}x{size[1]} with the temple (16 cameras + film)", o["v"] <= 0 and o["h"] <= 0 and o["logGap"] >= 0, str(o))
        # the snack machine: picker selects it, logged, one screen with 16 cameras + film
        page.click("#sfm-obj-snack")
        page.wait_for_timeout(CLICK_WAIT_MS)
        if size == NO_SCROLL_VIEWPORTS[0]:
            check("sfm: the picker selects the snack machine (data-object=snack)", page.get_attribute("#sfm", "data-object") == "snack"
                  and page.get_attribute("#sfm-obj-snack", "aria-pressed") == "true" and page.get_attribute("#sfm-obj-cat", "aria-pressed") == "false"
                  and sfm_stat(page, "frames") == "0", repr(page.get_attribute("#sfm", "data-object")))
            check("sfm: switching is recorded as 'scene: snack machine'", [page.get_attribute("#sfm", "data-event-text"), page.get_attribute("#sfm", "data-event")] == ["scene: snack machine", "scene"],
                  repr(page.get_attribute("#sfm", "data-event-text")))
            check("sfm: the snack machine has landmarks and gets 3D points", int(page.get_attribute("#sfm", "data-landmarks")) > 0 and int(sfm_stat(page, "points")) > 0)
            try:
                page.wait_for_function(f"document.getElementById('sfm-context').textContent.startsWith({SFM_SNACK_CONTEXT!r})", timeout=SFM_CONTEXT_TIMEOUT_MS)
                check("sfm: context band names the snack machine", True)
            except Exception:
                check("sfm: context band names the snack machine", False, repr(page.inner_text("#sfm-context")))
            check("sfm: the picker stays on one line", page.evaluate("document.querySelector('.sfm-cap').getBoundingClientRect().height") < 24)
        page.click("#sfm-film")
        page.wait_for_function(f"document.getElementById('sfm-stat-frames').textContent === '{SFM_FILM_FRAMES}'", timeout=SFM_FILM_TIMEOUT_MS)
        page.click("#sfm-mode-voxels")
        page.click("#sfm-mode-compare")
        o = page.evaluate(SFM_OVERFLOW_JS)
        check(f"sfm: no overflow or scroll at {size[0]}x{size[1]} with the snack machine (16 cameras + film)", o["v"] <= 0 and o["h"] <= 0 and o["logGap"] >= 0, str(o))
        page.click("#sfm-obj-cat")
        page.click("#sfm-obj-snack")
        page.wait_for_timeout(CLICK_WAIT_MS)
        check("sfm: the picker switches back to the snack machine", page.get_attribute("#sfm", "data-object") == "snack" and sfm_stat(page, "frames") == "0")
        check(f"sfm: zero console errors at {size[0]}x{size[1]}", not page.errors, "; ".join(page.errors))
        page.close()

    page = open_page(browser, MOBILE_VIEWPORT)
    page.emulate_media(reduced_motion="reduce")
    page.click("#tab-sfm")
    page.click("#sfm-film")
    check("sfm: reduced motion films all frames at once", sfm_stat(page, "frames") == str(SFM_FILM_FRAMES))
    r_az = page.get_attribute("#sfm-recon", "data-az")
    page.wait_for_timeout(SFM_SPIN_WAIT_MS)
    check("sfm: reduced motion stops the auto-spin", page.get_attribute("#sfm-recon", "data-az") == r_az)
    o = page.evaluate(SFM_OVERFLOW_JS)
    check(f"sfm: no horizontal overflow at {MOBILE_VIEWPORT[0]}x{MOBILE_VIEWPORT[1]}", o["h"] <= 0, str(o))
    check("sfm: zero console errors on the phone", not page.errors, "; ".join(page.errors))
    page.close()


GOLF_FIT_JS = """() => {
  const de = document.documentElement, r = s => document.querySelector(s).getBoundingClientRect();
  const col = r('.showcases'), c = r('#golf-canvas'), foot = r('.foot'), holes = r('#golf-holes');
  return { v: de.scrollHeight - innerHeight, h: de.scrollWidth - innerWidth, gap: foot.top - col.bottom,
           canvasIn: c.left >= col.left - 0.5 && c.right <= col.right + 0.5 && c.width > 150,
           sideIn: r('.golf-side').right <= col.right + 0.5, holesOneLine: holes.height < 24,
           wide: document.getElementById('golf').hasAttribute('data-wide'), width: col.width };
}"""
GOLF_INKED_JS = """() => {
  const c = document.getElementById('golf-canvas'), blank = document.createElement('canvas');
  blank.width = c.width; blank.height = c.height;
  return c.width > 0 && c.toDataURL() !== blank.toDataURL();
}"""
GOLF_CORNER_JS = """() => { const c = document.getElementById('golf-canvas');   // bottom-left quarter: tree and front edge, away from hole 1's ball
  return Array.from(c.getContext('2d').getImageData(0, c.height * 0.55, c.width * 0.3, c.height * 0.45).data.filter((v, i) => i % 4 === 0)); }"""
GOLF_CORNER_SLACK = 50            # changed pixels allowed there mid-swing (redrawing the columns over the ball must stay on the ball)


def golf_checks(browser):
    """The third showcase tab: gradient descent as voxel mini-golf."""
    page = open_page(browser, DESKTOP_VIEWPORT)
    data = lambda key: page.evaluate("k => document.getElementById('golf').dataset[k] || ''", key)
    pressed = lambda sel: page.get_attribute(sel, "aria-pressed")
    ctx_line = lambda: page.inner_text("#golf-context")
    swing_done = lambda: page.wait_for_function("document.getElementById('golf').dataset.status", timeout=GOLF_SWING_TIMEOUT_MS)
    check("golf: widget initialised (js-ready)", page.evaluate("document.getElementById('golf').classList.contains('js-ready')"))
    check("golf: panel hidden while the dog lab is open", not page.is_visible("#golf"))
    page.click("#tab-golf")
    page.wait_for_timeout(CLICK_WAIT_MS)
    check("golf: tab click shows the panel, hides the others, sets #golf", page.is_visible("#golf") and not page.is_visible("#dog-lab") and not page.is_visible("#sfm")
          and page.get_attribute("#tab-golf", "aria-selected") == "true" and page.inner_text("#tab-golf") == "gradient golf" and page.url.endswith("#golf"))
    check("golf: the course is drawn (canvas not blank)", page.evaluate(GOLF_INKED_JS))
    check("golf: five hole chips, hole 1 selected", page.locator("#golf-holes button").all_inner_texts() == GOLF_HOLES
          and pressed("#golf-hole-0") == "true" and pressed("#golf-hole-1") == "false", str(page.locator("#golf-holes button").all_inner_texts()))
    check("golf: context opens with the first teaching line, in a polite live region", ctx_line() == GOLF_INTRO and page.get_attribute("#golf-context", "aria-live") == "polite", repr(ctx_line()))
    check("golf: starts on sgd, learning rate 0.20, momentum slider off", pressed("#golf-opt-sgd") == "true" and page.inner_text("#golf-lr-val") == "0.20" and page.is_disabled("#golf-beta"))
    check("golf: sliders are labelled", page.evaluate("['golf-lr', 'golf-beta'].every(id => document.getElementById(id).labels.length === 1)"))

    page.click("#golf-opt-momentum")
    check("golf: optimizer chips toggle aria-pressed; momentum enables its slider", [pressed("#golf-opt-sgd"), pressed("#golf-opt-momentum"), pressed("#golf-opt-adam")] == ["false", "true", "false"]
          and page.is_enabled("#golf-beta") and page.inner_text("#golf-beta-val") == "0.90")
    page.click("#golf-opt-adam")
    check("golf: adam shows its fixed β₁", pressed("#golf-opt-adam") == "true" and page.is_disabled("#golf-beta") and "0.9" in page.inner_text("#golf-beta-val"))
    page.click("#golf-opt-sgd")

    page.click("#golf-help")
    check("golf: ? opens the explainer", page.is_visible("#golf-pop") and page.get_attribute("#golf-help", "aria-expanded") == "true")
    page.keyboard.press("Escape")
    check("golf: Esc closes the explainer", not page.is_visible("#golf-pop"))

    corner = page.evaluate(GOLF_CORNER_JS)
    page.click("#golf-swing")
    check("golf: a swing animates and can be skipped (button says skip)", page.inner_text("#golf-swing") == "skip")
    changed = 0
    for _ in range(4):
        page.wait_for_timeout(120)
        changed = max(changed, sum(abs(a - b) > 8 for a, b in zip(corner, page.evaluate(GOLF_CORNER_JS))))
    check("golf: the hopping ball leaves the rest of the course alone (no columns redrawn over props)", changed <= GOLF_CORNER_SLACK, f"{changed} px changed")
    swing_done()
    steps, par = int(data("steps")), int(page.inner_text("#golf-par"))
    check("golf: hole 1 with the default settings sinks within par", data("status") == "cup" and 0 < steps <= par, f"{data('status')} in {steps}, par {par}")
    check("golf: the result is announced in the context line", ctx_line().startswith(f"in the cup in {steps}"), repr(ctx_line()))
    check("golf: readout and scorecard line show the score", page.inner_text("#golf-steps") == str(steps)
          and page.inner_text("#golf-line") == f"hole 1 · {steps} steps (par {par}) · total {steps}" and page.inner_text("#golf-you-0") == str(steps), page.inner_text("#golf-line"))

    check("golf: after the cup: swing again + next hole, no reset", page.inner_text("#golf-swing") == "swing again" and page.is_visible("#golf-next") and not page.is_visible("#golf-reset"))
    page.click("#golf-swing")
    swing_done()
    check("golf: swing again replays the same hole from the tee, score cleared", data("hole") == "1" and data("status") == "cup" and data("steps") == str(steps), f"hole {data('hole')}, {data('steps')} steps")

    page.focus("#golf-next")                                    # the whole round can be played from the keyboard
    page.keyboard.press("Enter")
    check("golf: Enter on next hole goes to the next hole, focus back on swing", data("hole") == "2" and pressed("#golf-hole-1") == "true" and page.inner_text("#golf-swing") == "swing"
          and not page.is_visible("#golf-next") and page.evaluate("document.activeElement.id") == "golf-swing")
    page.keyboard.press("Enter")
    swing_done()
    stuck = int(data("steps"))
    check("golf: keyboard swing with sgd gets stuck in the fake hole", data("status") == "stuck" and "local minimum" in ctx_line(), f"{data('status')}: {ctx_line()!r}")
    page.focus("#golf-opt-momentum")
    page.keyboard.press("Space")
    page.focus("#golf-swing")
    page.keyboard.press("Enter")
    swing_done()
    check("golf: keyboard swing with momentum reaches the cup; steps keep adding", data("status") == "cup" and int(data("steps")) > stuck
          and page.inner_text("#golf-you-total") == str(steps + int(data("steps"))), f"{data('status')}, {data('steps')} after {stuck}")
    page.focus("#golf-lr")
    page.keyboard.press("ArrowRight")
    check("golf: arrow keys move the learning-rate slider (log scale)", page.inner_text("#golf-lr-val") == "0.22" and page.get_attribute("#golf-lr", "aria-valuetext") == "0.22", page.inner_text("#golf-lr-val"))

    page.click("#golf-hole-0")                                  # holed already: swing again starts it fresh
    page.focus("#golf-lr")
    page.keyboard.press("End")
    page.click("#golf-opt-sgd")
    page.click("#golf-swing")
    swing_done()
    check("golf: too big a learning rate flies off: +2, back to the tee", data("status") == "out" and data("steps") == GOLF_OUT_STEPS and ctx_line().startswith("diverged"), f"{data('status')} {data('steps')}")
    page.click("#golf-reset")
    check("golf: reset hole clears its score", data("steps") == "0" and page.inner_text("#golf-you-0") == "–" and page.inner_text("#golf-swing") == "swing")
    page.click("#golf-hole-2")
    page.focus("#golf-lr")
    page.keyboard.press("Home")
    for _ in range(GOLF_LR_DEFAULT_STEP):
        page.keyboard.press("ArrowRight")
    page.click("#golf-swing")                                   # sgd in the ravine: 60 steps, squeezed into 3 seconds
    page.click("#golf-swing")
    check("golf: a second click skips to the end of the swing", data("status") == "cap" and page.inner_text("#golf-swing") == "swing", data("status"))

    page.click(".credits-btn")
    check("golf: credits popover and title carry the golf cart credit", page.is_visible(f'#credits a[href="{GOLF_CART_URL}"]')
          and "golf cart: Golf Cart by NZFawkes, CC BY 4.0" in page.get_attribute(".credits-btn", "title"))
    page.keyboard.press("Escape")
    page.click("#tab-dog-lab")
    check("golf: switching back shows the dog", page.is_visible("#dog-lab") and not page.is_visible("#golf"))
    check("golf: zero console errors", not page.errors, "; ".join(page.errors))
    page.close()

    # one screen at the default (32%) and expanded (64%) split, light and dark
    for size in NO_SCROLL_VIEWPORTS:
        page = open_page(browser, size)
        page.goto(SITE_INDEX.as_uri() + "#golf")
        page.wait_for_timeout(SETTLE_MS)
        if size == NO_SCROLL_VIEWPORTS[0]:
            check("#golf hash selects the tab", page.get_attribute("#tab-golf", "aria-selected") == "true" and page.is_visible("#golf") and not page.is_visible("#dog-lab"))
        for split in (SPLIT_DEFAULT, SPLIT_EXPANDED):
            if split == SPLIT_EXPANDED:
                page.click("#split-toggle")
                page.wait_for_timeout(SPLIT_ANIM_WAIT_MS)
            for theme in ("light", "dark"):
                if page.evaluate("document.documentElement.dataset.theme") != theme:
                    page.click("#theme-toggle")
                    page.wait_for_timeout(CLICK_WAIT_MS)
                o = page.evaluate(GOLF_FIT_JS)
                label = f"golf: {split}% split, {theme}, {size[0]}x{size[1]}"
                check(label + ": no scroll, no overflow, ends above the footer", split_val(page) == split and o["v"] <= 0 and o["h"] <= 0 and o["gap"] >= 0, str(o))
                check(label + ": course and controls inside the column, hole chips on one line", o["canvasIn"] and o["sideIn"] and o["holesOneLine"]
                      and o["wide"] == (o["width"] >= GOLF_WIDE_MIN), str(o))
                check(label + ": canvas repainted for the theme", page.get_attribute("#golf", "data-theme-seen") in (theme, None) and page.evaluate(GOLF_INKED_JS))
        check(f"golf: zero console errors at {size[0]}x{size[1]}", not page.errors, "; ".join(page.errors))
        page.close()

    page = browser.new_page(viewport={"width": MOBILE_VIEWPORT[0], "height": MOBILE_VIEWPORT[1]}, reduced_motion="reduce")
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.goto(SITE_INDEX.as_uri() + "#golf")
    page.wait_for_timeout(SETTLE_MS)
    page.click("#golf-swing")
    check("golf: reduced motion plays the swing at once", page.evaluate("document.getElementById('golf').dataset.status") == "cup")
    o = page.evaluate(GOLF_FIT_JS)
    check(f"golf: no horizontal overflow at {MOBILE_VIEWPORT[0]}x{MOBILE_VIEWPORT[1]}", o["h"] <= 0 and o["canvasIn"], str(o))
    check("golf: zero errors on the phone", not page.errors, "; ".join(page.errors))
    page.close()


def project_checks(browser):
    root = SITE_INDEX.parent
    page = open_page(browser, DESKTOP_VIEWPORT)
    navs = page.eval_on_selector_all(".keys a", "els => els.map(a => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])")
    check("home: nav keys home · projects · demos, home marked current",
          navs == [["home", "index.html", "page"], ["projects", "projects/index.html", None], ["demos", "demos.html", None]], str(navs))
    arrows = page.eval_on_selector_all("#project-list a.row span", "els => els.map(e => e.textContent)")
    check("home: every row ends with → (an internal page)", arrows and set(arrows) == {"→"}, str(arrows))
    pv = page.evaluate("(() => { const m = document.querySelector('.preview-media'); return [m.hidden, getComputedStyle(m).backgroundImage, m.getBoundingClientRect().height]; })()")
    check("home: the first project's preview shows its first figure", not pv[0] and PROJECT_SLUGS[0] in pv[1] and pv[2] >= 60, str(pv))
    hrefs = page.eval_on_selector_all("#project-list a.row", "els => els.map(a => a.getAttribute('href'))")
    check("home: one row per project, in order, each links to projects/<slug>.html", hrefs == [f"projects/{s}.html" for s in PROJECT_SLUGS], str(hrefs))
    page.close()

    page = open_page(browser, MOBILE_VIEWPORT)
    ph = page.evaluate("""(() => { const r = s => document.querySelector(s).getBoundingClientRect(), v = s => getComputedStyle(document.querySelector(s)).display !== 'none';
      return { workAboveDemos: r('.work').bottom <= r('.showcases').top, introAboveWork: r('.intro').bottom <= r('.work').top,
               point: v('.point'), preview: v('.preview'), crop: v('.crop') }; })()""")
    check("home at 390px: intro, then the projects, then the demos; no stray →, no preview, no crop marks",
          ph == {"workAboveDemos": True, "introAboveWork": True, "point": False, "preview": False, "crop": False}, str(ph))
    page.close()

    page = open_page(browser, DESKTOP_VIEWPORT, path="projects/index.html")
    hrefs = page.eval_on_selector_all(".cards .card h2 a", "els => els.map(a => a.getAttribute('href'))")
    check("projects: index lists one card per project, each links to its page",
          sorted(hrefs) == sorted(f"{s}.html" for s in PROJECT_SLUGS) and all((root / "projects" / h).exists() for h in hrefs), str(hrefs))
    page.close()

    bad = []
    for slug in PROJECT_SLUGS:
        page = open_page(browser, DESKTOP_VIEWPORT, path=f"projects/{slug}.html")
        if page.errors:
            bad.append(f"{slug}: {page.errors}")
        for h in page.eval_on_selector_all("main a[href], object[data]", "els => els.map(e => e.getAttribute('href') || e.getAttribute('data'))"):
            if not h.startswith(("http", "mailto:")) and not (root / "projects" / h.split("#")[0]).resolve().exists():
                bad.append(f"{slug}: {h}")
        page.close()
    check("project pages: load with no console errors; every link and pdf returns 200", not bad, "; ".join(bad))

    for slug in (PROJECT_PDF_SLUG, "ai-town"):
        page = open_page(browser, MOBILE_VIEWPORT, path=f"projects/{slug}.html")
        o = page.evaluate("document.documentElement.scrollWidth - innerWidth")
        pdf_ok = page.locator(".proj-meta a").first.is_visible() and page.locator(".proj-pdf a").first.is_visible() if slug == PROJECT_PDF_SLUG else page.locator(".proj-pdf").count() == 0
        check(f"project page {slug} at 390px: no horizontal overflow, no <object>, the pdf is a visible link", o <= 0 and page.locator("object").count() == 0 and pdf_ok, f"overflow {o}px")
        page.close()

    page = open_page(browser, DESKTOP_VIEWPORT, path=f"projects/{PROJECT_PDF_SLUG}.html")
    pn = page.eval_on_selector_all(".proj-pn a", "els => els.map(a => [a.getAttribute('rel'), a.getAttribute('href')])")
    i, n = PROJECT_SLUGS.index(PROJECT_PDF_SLUG), len(PROJECT_SLUGS)
    check("project page: prev / next links in the project order", pn == [["prev", f"{PROJECT_SLUGS[(i - 1) % n]}.html"], ["next", f"{PROJECT_SLUGS[(i + 1) % n]}.html"]], str(pn))
    figs = page.evaluate("[...document.querySelectorAll('.proj figure')].map(f => { const a = f.querySelector('a'), i = f.querySelector('img'); return !!a && a.target === '_blank' && a.getAttribute('href') === i.getAttribute('src') && i.getBoundingClientRect().height <= innerHeight * 0.45 + 1; })")
    check("project page: every figure links to its image, no taller than 45vh", figs and all(figs), str(figs))
    c = page.evaluate("(() => { const m = document.querySelector('main').getBoundingClientRect(); return Math.abs((m.left + m.right) / 2 - innerWidth / 2); })()")
    check("project page: the content column is centred", c <= 2, str(c))
    page.close()

    page = open_page(browser, DESKTOP_VIEWPORT, path="projects/ai-town.html")
    page.evaluate("localStorage.setItem('portfolio-theme', 'dark')")
    page.reload()
    check("project page: a saved dark theme applies", page.get_attribute("html", "data-theme") == "dark")
    page.evaluate("localStorage.removeItem('portfolio-theme')")
    page.close()


HEADER_JS = """() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
  const keys = [...document.querySelectorAll('header .keys a.key')], links = [...document.querySelectorAll('header .top-links a')];
  const line = document.querySelector('.foot-line');
  return { keys: keys.map(a => [a.textContent, a.getAttribute('aria-current')]),
           keyH: keys.map(a => Math.round(a.getBoundingClientRect().height)),
           links: links.map(a => a.textContent.replace(/\\s+/g, ' ').trim()),
           linkH: links.map(a => Math.round(a.getBoundingClientRect().height)),
           visible: keys.concat(links).every(vis),
           email: (document.getElementById('link-email') || {}).href,
           resume: document.getElementById('link-resume') && [document.getElementById('link-resume').target, new URL(document.getElementById('link-resume').href).pathname.split('/').pop()],
           footText: line.textContent.replace(/\\s+/g, ' ').trim() };
}"""
HEADER_PAGES = [("home", None, "home"), ("projects index", "projects/index.html", "projects"), ("project page", "projects/raster.html", "projects"), ("demos", "demos.html", "demos")]


def header_checks(browser):
    """Every page: nav keys (current one marked), the resume / github / linkedin / email links above the fold, a clean footer."""
    for name, path, cur in HEADER_PAGES:
        for size in (DESKTOP_VIEWPORT, MOBILE_VIEWPORT):
            page = open_page(browser, size, path=path)
            o = page.evaluate(HEADER_JS)
            label = f"header ({name}, {size[0]}x{size[1]})"
            check(label + ": keys home / projects / demos, current marked", o["keys"] == [[k, "page" if k == cur else None] for k in ("home", "projects", "demos")], str(o["keys"]))
            check(label + ": resume ↓ · github · linkedin · email, all visible above the fold", o["links"] == ["resume ↓", "github", "linkedin", "muruganmanishwaran@gmail.com"] and o["visible"], str(o))
            check(label + ": email is a mailto link; resume opens the pdf in a new tab", o["email"] == "mailto:muruganmanishwaran@gmail.com" and o["resume"] == ["_blank", "Manishwaran-Murugan-Resume.pdf"], str(o))
            if size == MOBILE_VIEWPORT:
                check(label + ": every key and link is a 44px+ tap target", min(o["keyH"] + o["linkH"]) >= 44, str(o["keyH"] + o["linkH"]))
            else:
                check(label + ": keys are ~32px tall", all(30 <= h <= 34 for h in o["keyH"]), str(o["keyH"]))
            check(label + ": footer has the clock, no v0.1, no links, no dangling ·", "santa clara" in o["footText"] and "v0.1" not in o["footText"]
                  and "github" not in o["footText"] and not o["footText"].endswith("·"), repr(o["footText"]))
            check(label + ": no console errors", not page.errors, "; ".join(page.errors))
            page.close()


def back_link_checks(browser):
    """The project page's back link, over a local http server (file:// pages send no referrer)."""
    import socket, time, urllib.request
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0)); port = so.getsockname()[1]
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(SITE_INDEX.parent)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}/"
    try:
        for _ in range(50):
            try: urllib.request.urlopen(base, timeout=1); break
            except OSError: time.sleep(0.1)
        page = browser.new_page(viewport={"width": DESKTOP_VIEWPORT[0], "height": DESKTOP_VIEWPORT[1]})
        page.set_default_timeout(PAGE_TIMEOUT_MS)
        page.route("**/fonts.g*/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
        back = lambda: [page.inner_text(".back a"), page.get_attribute(".back a", "href")]
        page.goto(base + "projects/raster.html"); page.wait_for_load_state()
        check("back link: opened directly, it is a plain link to all projects", back() == ["← all projects", "index.html"], str(back()))
        page.goto(base); page.wait_for_timeout(SETTLE_MS)
        page.click('#project-list a.row[href="projects/raster.html"]'); page.wait_for_load_state()
        check("back link: from home it reads '← home'", back()[0] == "← home", str(back()))
        page.click(".back a"); page.wait_for_load_state()
        check("back link: from home it goes back home", page.url == base, page.url)
        page.goto(base + "projects/index.html"); page.wait_for_load_state()
        page.click('.cards h2 a[href="raster.html"]'); page.wait_for_load_state()
        check("back link: from the projects index it reads '← all projects'", back()[0] == "← all projects", str(back()))
        page.click(".back a"); page.wait_for_load_state()
        check("back link: from the projects index it goes back there", page.url == base + "projects/index.html", page.url)
        page.goto(base + "projects/raster.html"); page.wait_for_load_state()
        page.click('.proj-pn a[rel="next"]'); page.wait_for_load_state()
        check("back link: from another project it reads '← back'", back()[0] == "← back", str(back()))
        page.click(".back a"); page.wait_for_load_state()
        check("back link: ... and returns there", page.url == base + "projects/raster.html", page.url)
        page.close()
    finally:
        srv.terminate(); srv.wait()


SQUEEZED_VIEWPORTS = [(1024, 768), (1100, 700)]   # two columns, but less room than the one-screen layout needs
LAST_ROW_JS = """() => {
  const r = s => document.querySelector(s).getBoundingClientRect(), last = [...document.querySelectorAll('#project-list a.row')].pop();
  last.scrollIntoView({ block: 'center' });
  const lr = last.getBoundingClientRect(), hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2), f = r('.foot');
  const over = ['.masthead', '.intro', '.work', '.showcases'].filter(s => { const b = r(s); return b.bottom > f.top + 1 && b.top < f.bottom - 1; });
  return { clickable: !!hit && last.contains(hit), over: over, header: Math.abs(r('.top-r').top - r('.mast-id').top) < 2 };
}"""


def squeezed_checks(browser):
    """Between phone and full desktop: the header keeps one row, and a page that can't fit scrolls instead of pinning the footer over it."""
    for size in SQUEEZED_VIEWPORTS:
        page = open_page(browser, size)
        for tab in ("dog-lab", "sfm", "golf"):
            page.click(f"#tab-{tab}"); page.wait_for_timeout(SPLIT_ANIM_WAIT_MS)
            o = page.evaluate(LAST_ROW_JS)
            label = f"home {size[0]}x{size[1]} ({tab})"
            check(label + ": the last project row is clickable, nothing overlaps the footer", o["clickable"] and not o["over"], str(o))
            check(label + ": keys and links stay on the name's row", o["header"], str(o))
            page.evaluate("scrollTo(0, 0)")
        check(f"home {size[0]}x{size[1]}: no console errors", not page.errors, "; ".join(page.errors))
        page.close()


def click_tile(page, tile):
    pos = page.evaluate(TILE_JS, list(tile))
    page.mouse.click(pos["x"], pos["y"])
    page.wait_for_timeout(CLICK_WAIT_MS)


def pet_the_dog(page):
    """Walk the keyboard cursor over the grid until it is on the dog, then press Enter."""
    grid = page.evaluate("window.DogBrain.CONFIG.GRID")
    page.focus("#dog-canvas")
    for _ in range(PET_TRIES):
        for key in ["ArrowLeft"] * grid + ["ArrowUp"] * grid:      # cursor to tile 1, 1
            page.keyboard.press(key)
        for row in range(grid):
            for col in range(grid):
                if page.evaluate(LIVE_JS).endswith("the dog"):
                    page.keyboard.press("Enter")
                    if page.evaluate(LIVE_JS) == "you pet the dog":
                        return True
                if col < grid - 1:
                    page.keyboard.press("ArrowRight" if row % 2 == 0 else "ArrowLeft")
            page.keyboard.press("ArrowDown")
    return False


def find_dog_tile(page):
    """Walk the keyboard cursor over the grid until the live text says 'the dog'; return its 0-based (x, y)."""
    grid = page.evaluate("window.DogBrain.CONFIG.GRID")
    page.focus("#dog-canvas")
    for _ in range(grid):
        page.keyboard.press("ArrowLeft"); page.keyboard.press("ArrowUp")
    for row in range(grid):
        for col in range(grid):
            text = page.evaluate(LIVE_JS)
            if text.endswith("the dog"):
                x, y = text[5:].split(":")[0].split(",")
                return int(x) - 1, int(y) - 1
            if col < grid - 1:
                page.keyboard.press("ArrowRight" if row % 2 == 0 else "ArrowLeft")
        page.keyboard.press("ArrowDown")
    return None


def open_page(browser, size, block=None, path=None):
    page = browser.new_page(viewport={"width": size[0], "height": size[1]})
    page.set_default_timeout(PAGE_TIMEOUT_MS)
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
    # keep the run hermetic: Google Fonts are optional, so answer them locally instead of hitting the network
    page.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    page.route("**/fonts.gstatic.com/**", lambda r: r.fulfill(status=200, body=""))
    if block:
        page.route(block, lambda r: r.abort())
    page.goto((SITE_INDEX.parent / path).as_uri() if path else SITE_INDEX.as_uri())
    page.wait_for_timeout(SETTLE_MS)
    return page


SPLIT_FIT_JS = """() => {
  const de = document.documentElement, r = s => document.querySelector(s).getBoundingClientRect();
  const col = r('.showcases'), foot = r('.foot'), vis = s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; };
  const o = { v: de.scrollHeight - innerHeight, h: de.scrollWidth - innerWidth, colRight: col.right,
              gap: foot.top - Math.max(col.bottom, r('.work').bottom),                  // content must end above the footer
              leftClip: Math.max(document.querySelector('.work-body').scrollWidth - document.querySelector('.work-body').clientWidth,
                                 document.querySelector('.preview').scrollHeight - document.querySelector('.preview').clientHeight,
                                 document.querySelector('.intro').scrollWidth - document.querySelector('.intro').clientWidth) };
  if (vis('#dog-canvas')) {
    const c = r('#dog-canvas'), m = r('.mini');
    o.dogOk = c.left >= col.left - 0.5 && c.right <= col.right + 0.5 && c.bottom <= foot.top && c.top >= 0 && m.left >= c.right - 0.5 && m.right <= col.right + 0.5;
    o.dog = [Math.round(c.width), Math.round(c.height)];
  }
  if (vis('#golf-canvas')) {
    const c = r('#golf-canvas');
    o.golfOk = c.left >= col.left - 0.5 && c.right <= col.right + 0.5 && c.bottom <= foot.top && r('.golf-side').right <= col.right + 0.5;
    o.golf = [Math.round(c.width), Math.round(c.height)];
  }
  if (vis('.sfm-split')) {
    const a = r('.sfm-pane:nth-child(1)'), b = r('.sfm-pane:nth-child(2)'), cs = r('#sfm-canvas'), rc = r('#sfm-recon');
    o.sfmOk = Math.abs(a.top - b.top) < 1 && b.left >= a.right - 0.5 && b.right <= col.right + 0.5 && cs.right <= b.left + 0.5 && rc.right <= col.right + 0.5;
    o.sfm = [Math.round(cs.width), Math.round(rc.width)];
  }
  return o;
}"""


def split_val(page):
    return int(page.get_attribute("#split", "aria-valuenow"))


def split_checks(browser):
    """The resizable divider between the left column and the showcases."""
    page = open_page(browser, DESKTOP_VIEWPORT)
    sep = lambda a: page.get_attribute("#split", a)
    check("split: separator role, orientation, label", sep("role") == "separator" and sep("aria-orientation") == "vertical"
          and sep("aria-label") == "resize showcase" and sep("tabindex") == "0")
    check("split: aria-valuenow/min/max (right column %)", (sep("aria-valuenow"), sep("aria-valuemin"), sep("aria-valuemax"))
          == (str(SPLIT_DEFAULT), str(SPLIT_MIN), str(SPLIT_MAX)), str((sep("aria-valuenow"), sep("aria-valuemin"), sep("aria-valuemax"))))
    check("split: divider is visible and col-resize", page.is_visible("#split")
          and page.evaluate("getComputedStyle(document.getElementById('split')).cursor") == "col-resize")
    frac = page.evaluate("(() => { const s = document.querySelector('.stage').getBoundingClientRect(), r = document.querySelector('.showcases').getBoundingClientRect(), d = document.getElementById('split').offsetWidth; return r.width / (s.width - d); })()")
    check("split: default is left ~68% / right ~32%", abs(frac - SPLIT_DEFAULT / 100) < 0.01, str(frac))
    check("split: old sfm-only column override is gone", "0.7fr" not in Path(SITE_INDEX).with_name("css").joinpath("style.css").read_text())

    page.focus("#split")
    page.keyboard.press("ArrowLeft")
    a = split_val(page)
    page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight")
    b = split_val(page)
    check("split: ArrowLeft / ArrowRight move the divider by 5%", a == SPLIT_DEFAULT + SPLIT_STEP and b == max(SPLIT_MIN, SPLIT_DEFAULT - 2 * SPLIT_STEP), f"{a}, {b}")
    page.keyboard.press("Home"); lo = split_val(page)
    page.keyboard.press("End"); hi = split_val(page)
    check("split: Home / End go to min / max", (lo, hi) == (SPLIT_MIN, SPLIT_MAX), f"{lo}, {hi}")
    page.keyboard.press("End"); page.keyboard.press("ArrowLeft")
    check("split: clamped at max", split_val(page) == SPLIT_MAX)

    page.dblclick("#split")
    page.wait_for_timeout(SPLIT_ANIM_WAIT_MS)
    check("split: double-click resets to default", split_val(page) == SPLIT_DEFAULT, str(split_val(page)))
    g = page.locator("#split .grip").bounding_box()
    x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + SPLIT_DRAG_PX / 2, y); page.mouse.move(x + SPLIT_DRAG_PX, y); page.mouse.up()
    page.wait_for_timeout(100)
    d = split_val(page)
    check("split: pointer drag left widens the showcase", d > SPLIT_DEFAULT + 5, str(d))
    g = page.locator("#split .grip").bounding_box()
    x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 2000, y); page.mouse.up()
    page.wait_for_timeout(100)
    check("split: drag is clamped at min", split_val(page) == SPLIT_MIN, str(split_val(page)))

    # expand toggle
    page.dblclick("#split"); page.wait_for_timeout(SPLIT_ANIM_WAIT_MS)
    t0 = page.inner_text("#split-toggle")
    page.click("#split-toggle"); page.wait_for_timeout(SPLIT_ANIM_WAIT_MS)
    t1, v1 = page.inner_text("#split-toggle"), split_val(page)
    check("split: the hover preview hides while the showcase is expanded", not page.is_visible("#project-preview"))
    page.click("#split-toggle"); page.wait_for_timeout(SPLIT_ANIM_WAIT_MS)
    t2, v2 = page.inner_text("#split-toggle"), split_val(page)
    kb = page.evaluate("(() => { const b = document.getElementById('split-toggle'), cs = getComputedStyle(b), t = document.getElementById('showcase-tabs').getBoundingClientRect(), r = b.getBoundingClientRect(); return { border: cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) >= 1, h: Math.round(r.height), sameRow: Math.abs((r.top + r.bottom) / 2 - (t.top + t.bottom) / 2) < 6 }; })()")
    check("split: expand is a key-style button on the tabs' row", kb["border"] and 20 <= kb["h"] <= 26 and kb["sameRow"], str(kb))
    check("split: expand toggle goes expanded, then back", (t0.strip(), t1.strip(), t2.strip()) == ("expand", "shrink", "expand") and page.locator("#split-toggle svg.key-icon").count() == 1
          and (v1, v2) == (SPLIT_EXPANDED, SPLIT_DEFAULT), repr((t0, t1, t2, v1, v2)))

    # persistence
    page.focus("#split"); page.keyboard.press("Home")
    page.reload(); page.wait_for_timeout(SETTLE_MS)
    check("split: persists across reload", split_val(page) == SPLIT_MIN, str(split_val(page)))
    page.keyboard.press("Tab")
    check("split: zero console errors", not page.errors, "; ".join(page.errors))
    page.close()

    # photo + showcase intro + theme switch
    page = open_page(browser, DESKTOP_VIEWPORT)
    me = page.evaluate("(() => { const i = document.querySelector('.masthead .me'), r = i.getBoundingClientRect(), h = document.querySelector('.masthead h1').getBoundingClientRect(); return { ok: i.complete && i.naturalWidth > 0, w: r.width, h: r.height, left: r.right <= h.left, alt: i.alt }; })()")
    check("masthead: photo loads, square, 96-104px, left of the name, alt text", me["ok"] and me["w"] == me["h"] and 96 <= me["w"] <= 104 and me["left"] and me["alt"] == "Manishwaran Murugan", str(me))
    si = page.evaluate("(() => { const p = document.querySelector('.showcase-intro'), r = p.getBoundingClientRect(), t = document.querySelector('.tabrow').getBoundingClientRect(); return { above: r.bottom <= t.top, lines: Math.round(r.height / parseFloat(getComputedStyle(p).lineHeight)), outside: !p.closest('[role=tabpanel]'), live: p.closest('[aria-live]') !== null, tab: p.tabIndex }; })()")
    check("showcase intro: above the tab row, outside the panels, <= 2 lines, not focusable, no aria-live", si["above"] and si["outside"] and si["lines"] <= 2 and not si["live"] and si["tab"] == -1, str(si))
    tok = "['paper','ink','ink-2','ink-3','accent-text','dog-text'].map(n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim()).join()"
    light_tok = page.evaluate(tok)
    th = lambda: page.evaluate("document.documentElement.dataset.theme || 'none'")
    seen = lambda: [page.get_attribute("#dog-lab", "data-theme-seen"), page.get_attribute("#sfm", "data-theme-seen")]
    sw = "#theme-toggle"
    chk = lambda: page.get_attribute(sw, "aria-checked")
    check("theme: switch exists (button, role=switch, aria-label 'dark mode'), light by default", page.evaluate("(() => { const b = document.querySelector('#theme-toggle'); return b.tagName === 'BUTTON' && b.getAttribute('role') === 'switch' && b.getAttribute('aria-label') === 'dark mode'; })()") and chk() == "false" and th() == "light" and page.get_attribute(sw, "title") == "switch to dark")
    sg = page.evaluate("(() => { const r = document.querySelector('#theme-toggle').getBoundingClientRect(), f = document.querySelector('.foot-line'), fr = f.getBoundingClientRect(), cb = document.querySelector('.credits-btn').getBoundingClientRect(), cs = [3, 4].map(n => document.querySelector('.crop i:nth-child(' + n + ')').getBoundingClientRect()); return { w: r.width, h: r.height, inFoot: !!document.querySelector('.foot-line #theme-toggle') && r.top >= fr.top - 4 && r.bottom <= fr.bottom + 4, afterCredits: r.left >= cb.right, midOff: Math.abs((r.top + r.bottom) / 2 - (cb.top + cb.bottom) / 2), inFrame: r.right <= innerWidth - 34 && r.bottom <= innerHeight - 28, clear: cs.every(c => r.bottom <= c.top || r.right <= c.left || r.left >= c.right), mastEmpty: !document.querySelector('.masthead #theme-toggle') }; })()")
    check("theme: 44x22 pill in the footer line after credits, vertically centred, inside the frame, clear of the bottom crop marks, not in the masthead", sg["w"] == 44 and sg["h"] == 22 and sg["inFoot"] and sg["afterCredits"] and sg["midOff"] <= 3 and sg["inFrame"] and sg["clear"] and sg["mastEmpty"], str(sg))
    page.click(sw)
    page.wait_for_timeout(CLICK_WAIT_MS)
    dark_tok = page.evaluate(tok)
    check("theme: click -> aria-checked=true, data-theme=dark, palette changes", chk() == "true" and th() == "dark" and dark_tok != light_tok and "#161614" in dark_tok and page.get_attribute(sw, "title") == "switch to light", dark_tok)
    check("theme: both canvases repainted for dark (data-theme-seen)", seen() == ["dark", "dark"], str(seen()))
    check("theme: meta theme-color follows", page.evaluate("[...document.querySelectorAll('meta[name=theme-color]')].every(m => m.content === '#141413')"))
    dark_shot = page.locator('#dog-canvas').screenshot()
    page.reload(); page.wait_for_timeout(SETTLE_MS)
    check("theme: persists across reload, set before paint", th() == "dark" and chk() == "true", th())
    o = page.evaluate(SPLIT_FIT_JS)
    foot1 = page.evaluate("(() => { const f = document.querySelector('.foot-line'); return f.getBoundingClientRect().height < 2.2 * parseFloat(getComputedStyle(f).lineHeight); })()")
    check("theme: dark is one screen, footer on one line", o["v"] <= 0 and o["h"] <= 0 and o["gap"] >= 0 and foot1, str(o))
    page.focus(sw); page.keyboard.press("Space"); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: Space toggles back to light", chk() == "false" and th() == "light" and seen() == ["light", "light"], str(seen()))
    page.keyboard.press("Enter"); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: Enter toggles to dark", chk() == "true" and th() == "dark")
    check("theme: visible focus ring (keyboard focus)", page.evaluate("(() => { const b = document.querySelector('#theme-toggle'); return b.matches(':focus-visible') && getComputedStyle(b).outlineStyle !== 'none'; })()"))
    page.click(sw); page.wait_for_timeout(CLICK_WAIT_MS)
    light_shot = page.locator('#dog-canvas').screenshot()
    check("theme: back to light restores the tokens; dog canvas pixels differ from dark", th() == "light" and page.evaluate(tok) == light_tok and dark_shot != light_shot)
    page.click("#tab-sfm"); page.click(sw); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: sfm canvases repaint on toggle", th() == "dark" and seen() == ["dark", "dark"], str(seen()))
    check("theme: zero console errors", not page.errors, "; ".join(page.errors))
    page.close()

    # OS preference: initial state, live follow until the first click, then ignored
    page = open_page(browser, DESKTOP_VIEWPORT)
    page.emulate_media(color_scheme="dark"); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: follows the OS live before any click", th() == "dark" and chk() == "true" and seen() == ["dark", "dark"], str(seen()))
    page.emulate_media(color_scheme="light"); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: ... and back", th() == "light" and chk() == "false")
    page.click(sw); page.emulate_media(color_scheme="dark"); page.wait_for_timeout(CLICK_WAIT_MS)
    page.emulate_media(color_scheme="light"); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: after a click the OS no longer changes it", th() == "dark")
    page.close()
    ctx = browser.new_context(viewport={"width": DESKTOP_VIEWPORT[0], "height": DESKTOP_VIEWPORT[1]}, color_scheme="dark")
    page = ctx.new_page(); page.goto(SITE_INDEX.as_uri()); page.wait_for_timeout(SETTLE_MS)
    check("theme: OS dark and nothing saved -> starts dark, switch on", th() == "dark" and chk() == "true")
    page.close(); ctx.close()

    page = open_page(browser, MOBILE_VIEWPORT)
    sm = page.evaluate("(() => { const r = document.querySelector('#theme-toggle').getBoundingClientRect(), f = document.querySelector('.foot').getBoundingClientRect(); return { w: r.width, h: r.height, inFoot: !!document.querySelector('.foot #theme-toggle') && r.top >= f.top && r.bottom <= f.bottom + 1, inView: r.left >= 0 && r.right <= innerWidth }; })()")
    check("theme: mobile switch is 40x20, in the footer", sm["w"] == 40 and sm["h"] == 20 and sm["inFoot"] and sm["inView"], str(sm))
    page.click(sw); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: mobile toggles", th() == "dark" and chk() == "true")
    page.close()

    page = browser.new_page(viewport={"width": 1280, "height": 800}); page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.route("**/fonts.g*/**", lambda r: r.fulfill(status=200, body=""))
    page.goto(SITE_INDEX.with_name("404.html").as_uri())
    page.click(sw); page.wait_for_timeout(CLICK_WAIT_MS)
    check("theme: 404 has the switch and toggles", page.get_attribute(sw, "role") == "switch" and chk() == "true" and th() == "dark")
    page.reload()
    check("theme: 404 persists across reload", th() == "dark" and chk() == "true")
    check("theme: 404 zero errors", not page.errors, "; ".join(page.errors))
    l404 = page.eval_on_selector_all("main a", "els => els.map(a => a.getAttribute('href'))")
    check("404: back home · projects · resume links", l404 == ["/", "/projects/", "/assets/Manishwaran-Murugan-Resume.pdf"], str(l404))
    page.close()

    # every split position x both tabs x both desktop sizes: one screen, nothing clipped, panes side by side
    for size in NO_SCROLL_VIEWPORTS:
        page = open_page(browser, size)
        for tab in ("dog-lab", "sfm", "golf"):
            page.click(f"#tab-{tab}")
            for name, key in (("min", "Home"), ("default", None), ("max", "End")):
                page.focus("#split")
                if key: page.keyboard.press(key)
                else: page.dblclick("#split")
                page.wait_for_timeout(SPLIT_ANIM_WAIT_MS)
                o = page.evaluate(SPLIT_FIT_JS)
                label = f"split: {tab} at {name} {size[0]}x{size[1]}"
                check(label + ": no scroll, no overflow, ends above footer", o["v"] <= 0 and o["h"] <= 0 and o["gap"] >= 0, str(o))
                check(label + ": left column not clipped", o["leftClip"] <= 0, str(o))
                if tab == "dog-lab": check(label + ": dog canvas + brain fully visible", o.get("dogOk") is True, str(o))
                elif tab == "sfm": check(label + ": sfm panes side by side, inside the column", o.get("sfmOk") is True, str(o))
                else: check(label + ": golf course and controls inside the column, above the footer", o.get("golfOk") is True, str(o))
        check(f"split: zero console errors at {size[0]}x{size[1]}", not page.errors, "; ".join(page.errors))
        page.close()

    page = open_page(browser, NARROW_VIEWPORT)
    check("split: no divider or toggle under 1100px", not page.is_visible("#split") and not page.is_visible("#split-toggle"))
    page.close()


def demos_checks(browser):
    ids = ["dog-lab", "sfm", "golf"]
    for size, label in ((DESKTOP_VIEWPORT, "desktop"), (MOBILE_VIEWPORT, "390px")):
        page = open_page(browser, size, path="demos.html")
        navs = page.eval_on_selector_all(".keys a", "els => els.map(a => [a.textContent, a.getAttribute('aria-current')])")
        check(f"demos ({label}): nav marks demos current", navs == [["home", None], ["projects", None], ["demos", "page"]], str(navs))
        seen, scrolls = [], []
        for i in ids:
            page.click(f"#tab-{i}")
            page.wait_for_timeout(300)
            seen.append([page.is_visible(f"#{j}") for j in ids])
            scrolls.append(page.evaluate("document.documentElement.scrollHeight - innerHeight"))
        if size == DESKTOP_VIEWPORT:
            check(f"demos ({label}): every demo fits one screen at {size[0]}x{size[1]}", max(scrolls) <= 0, str(scrolls))
        check(f"demos ({label}): the three tabs switch panels", seen == [[k == n for k in range(3)] for n in range(3)], str(seen))
        check(f"demos ({label}): a one-line description for each demo", page.locator(".demo-blurb").count() == 3)
        rel = page.eval_on_selector_all(".demo-blurb a", "els => els.map(a => [a.closest('li').querySelector('b').textContent, a.getAttribute('href')])")
        check(f"demos ({label}): sfm in a box links to its project", rel == [["sfm in a box", "projects/raster.html"]], str(rel))
        o = page.evaluate("document.documentElement.scrollWidth - innerWidth")
        check(f"demos ({label}): no horizontal overflow", o <= 0, f"{o}px")
        check(f"demos ({label}): no console errors", not page.errors, "; ".join(page.errors))
        page.close()
    page = open_page(browser, DESKTOP_VIEWPORT, path="demos.html")
    page.evaluate("window.__hid = []; ['dog-lab','sfm','golf'].forEach(i => document.getElementById(i).addEventListener('showcase:hide', () => window.__hid.push(i)))")
    page.click("#tab-sfm")
    page.click("#tab-golf")
    hid = page.evaluate("window.__hid")
    check("demos: switching tabs sends showcase:hide to the hidden demo", hid == ["dog-lab", "sfm"], str(hid))
    page.close()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=BROWSER_CHANNEL, headless=True, args=["--no-sandbox"])

        page = open_page(browser, DESKTOP_VIEWPORT)
        check("widget initialised (js-ready)", page.evaluate("document.getElementById('dog-lab').classList.contains('js-ready')"))
        check("fallback hidden once ready", not page.is_visible(".dog-fallback"))

        art = page.get_attribute("#dog-lab", "data-art")
        check("all sprites loaded (data-art=sprites)", art == "sprites", f"data-art = {art!r}")

        ctx_line = lambda: page.inner_text("#dog-context")
        check("context line opens with the first teaching line", ctx_line() == "it starts knowing nothing: every move is a guess.", repr(ctx_line()))
        check("context line is a polite live region", page.get_attribute("#dog-context", "aria-live") == "polite")
        check("old hint line is gone", page.locator("#dog-hint").count() == 0)

        page.focus("#rl-help")
        page.keyboard.press("Enter")
        check("? opens the explainer (aria-expanded=true)", page.is_visible("#rl-pop") and page.get_attribute("#rl-help", "aria-expanded") == "true")
        words = len(page.inner_text("#rl-pop").split())
        check("explainer is short (<= 75 words)", words <= 75, str(words))
        page.keyboard.press("Escape")
        check("Esc closes the explainer", not page.is_visible("#rl-pop") and page.get_attribute("#rl-help", "aria-expanded") == "false")
        page.click("#rl-help")
        page.mouse.click(5, 790)
        check("click outside closes the explainer", not page.is_visible("#rl-pop"))

        before = page.locator("#thought-log li").count()
        page.click('[data-tool="block"]')
        click_tile(page, page.evaluate(GAP_TILE_JS))
        check("placing a block changes the context line", ctx_line() == "you changed the world. it has to relearn.", repr(ctx_line()))
        signal = page.locator(FIRST_SIGNAL).inner_text()
        check("clicking a gap tile logs a map change", signal == "map changed", f"first log signal = {signal!r}, rows before = {before}")
        check("placement is announced", page.evaluate(LIVE_JS) == "block placed", repr(page.evaluate(LIVE_JS)))

        page.click('[data-tool="mud"]')
        click_tile(page, MUD_TILE)
        check("mud can be placed", page.evaluate(LIVE_JS) == "mud placed", repr(page.evaluate(LIVE_JS)))
        page.click('[data-tool="bone"]')
        click_tile(page, MUD_TILE)
        check("the small bone can be placed", page.evaluate(LIVE_JS) == "small bone placed", repr(page.evaluate(LIVE_JS)))

        tile = find_dog_tile(page)       # the cursor is on the dog, so it is already paused
        check("found the dog's tile", tile is not None)
        if tile:
            pos = page.evaluate(TILE_JS, list(tile))
            page.mouse.move(pos["x"], pos["y"])
            page.evaluate("document.getElementById('dog-canvas').blur()")      # leave only the pointer on it
            page.evaluate("window.__steps = 0; new MutationObserver(m => window.__steps += m.length).observe("
                          "document.getElementById('brain-decision'), { childList: true })")   # one per visible step
            page.wait_for_timeout(HOVER_HOLD_MS)
            steps = page.evaluate("window.__steps")
            check("hovering the dog holds it still for 1s+", steps == 0, f"steps taken = {steps}")
            page.mouse.click(pos["x"], pos["y"])
            page.wait_for_timeout(CLICK_WAIT_MS)
            check("clicking the hovered dog pets it", page.locator(FIRST_SIGNAL).inner_text() == "pet", page.locator(FIRST_SIGNAL).inner_text())
            ds = page.evaluate("({ ...document.getElementById('dog-lab').dataset })")
            check("petting shows a speech bubble with a pet line", ds.get("bubble") in PET_LINES, repr(ds.get("bubble")))
            check("petting draws hearts", int(ds.get("hearts", 0)) > 0, repr(ds.get("hearts")))
            page.wait_for_function("!document.getElementById('dog-lab').dataset.bubble && !document.getElementById('dog-lab').dataset.hearts", timeout=BUBBLE_GONE_MS)
            check("bubble and hearts clear themselves", True)

        check("Enter on the dog's tile pets it", pet_the_dog(page), repr(page.evaluate(LIVE_JS)))
        signals = page.locator("#thought-log li span:nth-child(3)").all_inner_texts()
        check("the pet is in the thought log", "pet" in signals, repr(signals))

        page.click(".credits-btn")
        check("credits popover opens with the dog credit link", page.is_visible(f'#credits a[href="{CREDIT_URL}"]'))
        page.keyboard.press("Escape")
        check("credits popover closes on Escape", not page.is_visible("#credits"))

        check("zero console errors", not page.errors, "; ".join(page.errors))
        page.close()

        for size in NO_SCROLL_VIEWPORTS:
            page = open_page(browser, size)
            o = page.evaluate(OVERFLOW_JS)
            check(f"no overflow or scroll at {size[0]}x{size[1]}", o["v"] <= 0 and o["h"] <= 0 and o["logGap"] >= 0, str(o))
            check(f"footer is one line at {size[0]}x{size[1]}", o["footLines"] == 1, str(o))
            page.close()

        page = open_page(browser, DESKTOP_VIEWPORT)
        check("dog lab tab is selected and its panel visible", page.get_attribute("#tab-dog-lab", "aria-selected") == "true" and page.is_visible("#dog-lab"))
        page.close()
        page = open_page(browser, DESKTOP_VIEWPORT)
        page.goto(SITE_INDEX.as_uri() + "#dog-lab")
        page.wait_for_timeout(SETTLE_MS)
        check("#dog-lab hash selects the tab", page.get_attribute("#tab-dog-lab", "aria-selected") == "true" and page.is_visible("#dog-lab"))
        page.close()

        page = open_page(browser, DESKTOP_VIEWPORT, block=BROKEN_ASSET)
        art = page.get_attribute("#dog-lab", "data-art")
        ready = page.evaluate("document.getElementById('dog-lab').classList.contains('js-ready')")
        thrown = [e for e in page.errors if "ERR_FAILED" not in e]      # the blocked request itself logs one network error
        check("a missing sprite falls back to procedural drawing", art == "procedural" and ready and not thrown, f"data-art = {art!r}, ready = {ready}, errors = {thrown}")
        page.close()

        page = open_page(browser, MOBILE_VIEWPORT)
        o = page.evaluate(OVERFLOW_JS)
        check(f"no horizontal overflow at {MOBILE_VIEWPORT[0]}x{MOBILE_VIEWPORT[1]}", o["h"] <= 0, str(o))
        page.close()

        header_checks(browser)
        squeezed_checks(browser)
        project_checks(browser)
        back_link_checks(browser)
        demos_checks(browser)
        sfm_checks(browser)
        split_checks(browser)
        golf_checks(browser)

        # the scene models are optional: no snack machine -> the temple; neither temple nor cat nor snack -> a message in the panel, no broken canvas
        page = open_page(browser, DESKTOP_VIEWPORT, block="**/models/snack-machine.js")
        thrown = [e for e in page.errors if "ERR_FAILED" not in e]
        check("sfm: without the snack machine model the temple is the default", page.get_attribute("#sfm", "data-object") == "temple"
              and page.get_attribute("#sfm-obj-snack", "hidden") is not None and not thrown, f"{page.get_attribute('#sfm', 'data-object')!r}, {thrown}")
        page.close()
        page = open_page(browser, DESKTOP_VIEWPORT, block="**/models/*.js")
        thrown = [e for e in page.errors if "ERR_FAILED" not in e]
        page.click("#tab-sfm")
        check("sfm: without any model a message replaces the widget", not page.evaluate("document.getElementById('sfm').classList.contains('js-ready')")
              and page.locator("#sfm .dog-fallback").is_visible() and "didn't load" in page.inner_text("#sfm .dog-fallback")
              and page.locator("#sfm-canvas").is_hidden() and not thrown, f"{thrown}")
        page.close()
        browser.close()

    print(f"\n{'FAILED: ' + ', '.join(FAILS) if FAILS else 'all checks passed'}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
