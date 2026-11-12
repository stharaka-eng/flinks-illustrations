/*!
 * Flinks animation runtime (shared by every illustration; inlined into each package's animation.js).
 * Vanilla JS, no dependencies. Provides: scaling, lifecycle (visibility / viewport / reduced motion),
 * cancellable timers, duplicate-init protection and a small public API.
 */
(function (global) {
  'use strict';

  var FRAME_W = 720, FRAME_H = 500;
  var registry = global.FlinksAnimations = global.FlinksAnimations || {};
  var SCRIPT_BASE = (function () {
    try { var s = document.currentScript && document.currentScript.src; return s ? s.slice(0, s.lastIndexOf('/') + 1) : ''; }
    catch (e) { return ''; }
  })();

  /* ---------- font (registered at document level; @font-face is ignored inside shadow roots) ---------- */
  var DEFAULT_FONTS = [['Flinks Inter', 400, 'inter-latin-400-normal'], ['Flinks Inter', 500, 'inter-latin-500-normal'],
                       ['Flinks Inter', 600, 'inter-latin-600-normal'], ['Flinks Inter', 700, 'inter-latin-700-normal']];
  function ensureFont(base, fonts) {
    fonts.forEach(function (f) {
      var id = 'flx-font-' + f[2]; if (document.getElementById(id)) return;
      var st = document.createElement('style'); st.id = id;
      st.textContent = "@font-face{font-family:'" + f[0] + "';font-style:normal;font-weight:" + f[1] + ";font-display:swap;src:url(" + base + f[2] + ".woff2) format('woff2');}";
      (document.head || document.documentElement).appendChild(st);
    });
  }
  function fontsReady(fonts) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var loads = fonts.map(function (f) { return document.fonts.load(f[1] + " 16px '" + f[0] + "'").catch(function () {}); });
    return Promise.race([Promise.all(loads), new Promise(function (r) { setTimeout(r, 2500); })]);
  }

  /* ---------- instance ---------- */
  function mount(root, def, opts) {
    if (!root) return null;
    if (root.__flx) return root.__flx;                       // never initialise twice
    opts = opts || {};
    var o = {
      autoplay: opts.autoplay !== false && root.getAttribute('data-autoplay') !== 'false',
      isStatic: !!opts.static || root.hasAttribute('data-static'),
      respectRM: opts.respectReducedMotion !== false && root.getAttribute('data-respect-reduced-motion') !== 'false',
      font: opts.font || root.getAttribute('data-font') || 'auto',
      fontBase: opts.fontBase || root.getAttribute('data-font-base') || def.fontBase || (SCRIPT_BASE + 'assets/fonts/')
    };
    if (o.fontBase.slice(-1) !== '/') o.fontBase += '/';
    var fonts = def.fonts || DEFAULT_FONTS;
    if (o.font !== 'none') ensureFont(o.fontBase, fonts);
    if (o.respectRM) root.setAttribute('data-flx-respect-rm', '');

    var q = function (sel) { return root.querySelector(sel); };
    var gen = 0, timers = [], rafs = [], mode = '', destroyed = false;
    var scale = 1, inView = true, pageVisible = !document.hidden, playing = o.autoplay, ready = false;
    var mql = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;

    var ctx = {
      root: root, q: q, qa: function (s) { return [].slice.call(root.querySelectorAll(s)); },
      scale: function () { return scale; },
      sleep: function (ms) {                                  // cancelled sleeps never resolve -> async loop is simply dropped
        var my = gen;
        return new Promise(function (res) { timers.push(setTimeout(function () { if (my === gen) res(); }, ms)); });
      },
      after: function (ms, fn) { var my = gen; timers.push(setTimeout(function () { if (my === gen) fn(); }, ms)); },
      raf: function (fn) { var my = gen, id = requestAnimationFrame(function (t) { if (my === gen) fn(t); }); rafs.push(id); return id; },
      alive: function () { return !destroyed; }
    };
    def.setup && def.setup(ctx);

    function layout() {
      var w = root.clientWidth, h = root.clientHeight;
      if (!w || !h) return;
      var s = Math.min(w / FRAME_W, h / FRAME_H);
      scale = s;
      root.style.setProperty('--flx-s', String(s));
      root.style.setProperty('--flx-tx', ((w - FRAME_W * s) / 2) + 'px');
      root.style.setProperty('--flx-ty', ((h - FRAME_H * s) / 2) + 'px');
    }
    layout();
    var ro = global.ResizeObserver ? new ResizeObserver(layout) : null;
    if (ro) ro.observe(root); else global.addEventListener('resize', layout);

    function cancelAll() {
      gen++;
      timers.forEach(clearTimeout); timers = [];
      rafs.forEach(cancelAnimationFrame); rafs = [];
    }
    function wantStatic() { return o.isStatic || (o.respectRM && mql && mql.matches); }
    function sync() {
      if (destroyed || !ready) return;
      var next = wantStatic() ? 'static' : (playing && inView && pageVisible ? 'run' : 'idle');
      if (next === mode) return;
      cancelAll(); mode = next;
      root.classList.toggle('is-static', next === 'static');
      if (next === 'static') def.final(ctx);
      else if (next === 'idle') def.reset(ctx);
      else { def.reset(ctx); def.run(ctx); }
    }

    var io = null;
    if (global.IntersectionObserver) {
      io = new IntersectionObserver(function (es) { inView = es[es.length - 1].isIntersecting; sync(); });
      io.observe(root);
    }
    function onVis() { pageVisible = !document.hidden; sync(); }
    document.addEventListener('visibilitychange', onVis);
    function onRM() { sync(); }
    if (mql) { mql.addEventListener ? mql.addEventListener('change', onRM) : mql.addListener(onRM); }

    var api = {
      root: root,
      play: function () { playing = true; sync(); },
      pause: function () { playing = false; sync(); },
      destroy: function () {
        if (destroyed) return; destroyed = true; cancelAll();
        io && io.disconnect(); ro ? ro.disconnect() : global.removeEventListener('resize', layout);
        document.removeEventListener('visibilitychange', onVis);
        if (mql) { mql.removeEventListener ? mql.removeEventListener('change', onRM) : mql.removeListener(onRM); }
        def.reset(ctx); delete root.__flx;
      }
    };
    root.__flx = api;
    // First frame only after the font is available, so layout-dependent coordinates (cursor targets) are final.
    (o.font === 'none' ? Promise.resolve() : fontsReady(fonts)).then(function () {
      if (destroyed) return; ready = true; layout(); def.reset(ctx); sync();
      root.setAttribute('data-flx-ready', '');   // reveal only once the first frame state is in place (no flash, no transition from the markup state)
    });
    return api;
  }

  registry.register = function (name, rootClass, def) {
    registry[name] = {
      mount: function (root, opts) { return mount(root, def, opts); },
      autoInit: function (scope) {
        [].slice.call((scope || document).querySelectorAll('.' + rootClass)).forEach(function (r) { mount(r, def); });
      }
    };
    // Auto-initialise markup that is already on the page (light-DOM embeds)
    function init() { registry[name].autoInit(document); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    return registry[name];
  };
})(window);

/* ===== Flinks · Fraud API (card 05) — animation logic. Sequence/timings 1:1 with original/a5.html ===== */
(function () {
  var stage, c1, c2, poll, seed;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }   // seeded: identical typing rhythm every loop
  function prep(win) {
    var chars = [].slice.call(win.querySelectorAll('.flx-ch')), w = [], tot = 0;
    chars.forEach(function (c) { c._ln = c.closest('.flx-ln'); });
    chars.forEach(function (c, i) { var x = 0.55 + rnd() * 1.0; if (c.textContent === ' ') x *= 0.45; var nx = chars[i + 1]; if (nx && nx._ln !== c._ln) x += 3; w.push(x); tot += x; });
    win._chars = chars; win._w = w; win._tot = tot; win._cur = document.createElement('span'); win._cur.className = 'flx-cur';
  }
  function setup(c) {
    stage = c.q('.flx-stage'); c1 = c.q('[data-flx="c1"]'); c2 = c.q('[data-flx="c2"]'); poll = c.q('[data-flx="poll"]');
    seed = 7; prep(c1); prep(c2);
  }
  function setCursor(win, idx) { if (idx < 0) { var tx = win.querySelector('.flx-tx'); tx.insertBefore(win._cur, tx.firstChild); } else win._chars[idx].after(win._cur); }
  function typeIn(c, win, T) {
    return new Promise(function (res) {
      var chars = win._chars, k = win._tot / T, cum = [], a = 0, i = 0, t0 = null;
      win._w.forEach(function (x) { a += x / k; cum.push(a); }); setCursor(win, -1);
      function frame(ts) {
        if (t0 === null) t0 = ts; var el = ts - t0;
        while (i < chars.length && cum[i] <= el) { chars[i].classList.add('flx-on'); chars[i]._ln.classList.add('flx-on'); i++; }
        setCursor(win, i - 1);
        if (i < chars.length) c.raf(frame); else { win._cur.remove(); res(); }
      }
      c.raf(frame);
    });
  }
  function clearAll(win) { win._chars.forEach(function (c) { c.classList.remove('flx-on'); }); win.querySelectorAll('.flx-ln').forEach(function (l) { l.classList.remove('flx-on'); }); win._cur.remove(); }
  function reset() {
    stage.className = 'flx-stage flx-boot';
    ['flx-done', 'flx-stop', 'flx-in', 'flx-out', 'flx-rst'].forEach(function (k) { c1.classList.remove(k); c2.classList.remove(k); });
    poll.classList.remove('flx-show', 'flx-stop'); clearAll(c1); clearAll(c2);
  }
  function final() {
    reset();
    [c1, c2].forEach(function (w) { w._chars.forEach(function (c) { c.classList.add('flx-on'); }); w.querySelectorAll('.flx-ln').forEach(function (l) { l.classList.add('flx-on'); }); });
    stage.classList.remove('flx-boot'); stage.classList.add('flx-p2'); c1.classList.add('flx-done', 'flx-stop'); c2.classList.add('flx-in', 'flx-done'); poll.classList.add('flx-show', 'flx-stop');
  }
  async function run(c) {
    stage.classList.remove('flx-boot'); await c.sleep(900);
    for (;;) {
      await typeIn(c, c1, 4000);                                                                 // 01 · 202 response types out
      await c.sleep(250); c1.classList.add('flx-done'); await c.sleep(550); poll.classList.add('flx-show'); await c.sleep(1600);
      stage.classList.add('flx-p2'); c1.classList.add('flx-stop'); poll.classList.add('flx-stop'); c2.classList.add('flx-in'); await c.sleep(1300);   // 02 · 200 window in
      await typeIn(c, c2, 4000); await c.sleep(250); c2.classList.add('flx-done'); await c.sleep(2800);
      c2.classList.add('flx-out'); stage.classList.remove('flx-p2'); await c.sleep(1000);       // 200 slides away, first returns to centre
      c2.classList.add('flx-rst'); c2.classList.remove('flx-in', 'flx-out', 'flx-done'); clearAll(c2);
      await new Promise(function (r) { c.raf(function () { c.raf(r); }); }); c2.classList.remove('flx-rst');   // snap without transition (replaces forced reflow)
      c1.classList.remove('flx-done', 'flx-stop'); poll.classList.remove('flx-show', 'flx-stop'); clearAll(c1); await c.sleep(500);   // code clears instantly, start again
    }
  }
  window.FlinksAnimations.register('fraud-api', 'flx-fraud-api', {
    fonts: [['Flinks Inter', 400, 'inter-latin-400-normal'], ['Flinks Inter', 500, 'inter-latin-500-normal'], ['Flinks Inter', 600, 'inter-latin-600-normal'],
            ['Flinks Inter', 700, 'inter-latin-700-normal'], ['Flinks Roboto Mono', 400, 'roboto-mono-latin-400-normal'], ['Flinks Roboto Mono', 500, 'roboto-mono-latin-500-normal']],
    setup: setup, reset: reset, final: final, run: run });
})();
