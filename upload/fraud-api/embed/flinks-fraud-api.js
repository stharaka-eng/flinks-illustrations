/*! Flinks fraud-api – single-file embed (Shadow DOM web component <flinks-fraud-api>) */
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
      fontBase: opts.fontBase || root.getAttribute('data-font-base') || def.fontBase || (SCRIPT_BASE + '../assets/fonts/')
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


(function(){
  var TAG='flinks-fraud-api', ROOT='flx-fraud-api';
  var MARKUP="<div class=\"flx-fraud-api\" role=\"img\" aria-label=\"Animation: an API request returns a 202 response while processing, then a 200 response with account details.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage flx-boot\" data-flx=\"stage\"><div class=\"flx-c1\" data-flx=\"c1\"><div class=\"flx-gb\"><div class=\"flx-in flx-dk\"><div class=\"flx-tb\"><div class=\"flx-dots\"><i></i><i></i><i></i></div><span class=\"flx-lab\"></span><span class=\"flx-st\"><svg class=\"flx-i flx-spn\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" stroke-dasharray=\"0.1 4.4\"/></svg><span class=\"flx-chip flx-c202\">202</span></span></div><div class=\"flx-code\" style=\"padding-bottom:16px;min-height:150px\"><div class=\"flx-ln\"><span class=\"flx-no\">1</span><span class=\"flx-tx\"><span class=\"flx-ch\">{</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">2</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">F</span><span class=\"flx-ch\">l</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">k</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">C</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">d</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">O</span><span class=\"flx-ch\">P</span><span class=\"flx-ch\">E</span><span class=\"flx-ch\">R</span><span class=\"flx-ch\">A</span><span class=\"flx-ch\">T</span><span class=\"flx-ch\">I</span><span class=\"flx-ch\">O</span><span class=\"flx-ch\">N</span><span class=\"flx-ch\">_</span><span class=\"flx-ch\">P</span><span class=\"flx-ch\">E</span><span class=\"flx-ch\">N</span><span class=\"flx-ch\">D</span><span class=\"flx-ch\">I</span><span class=\"flx-ch\">N</span><span class=\"flx-ch\">G</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">3</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">H</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">p</span><span class=\"flx-ch\">S</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">C</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">d</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-n\"><span class=\"flx-ch\">2</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">2</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">4</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">M</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">g</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">Y</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">p</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">l</span><span class=\"flx-ch\">l</span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">p</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">g</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">5</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">R</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">q</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">I</span><span class=\"flx-ch\">d</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">7</span><span class=\"flx-ch\">7</span><span class=\"flx-ch\">7</span><span class=\"flx-ch\">8</span><span class=\"flx-ch\">5</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">3</span><span class=\"flx-ch\">-</span><span class=\"flx-ch\">f</span><span class=\"flx-ch\">d</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">f</span><span class=\"flx-ch\">-</span><span class=\"flx-ch\">4</span><span class=\"flx-ch\">2</span><span class=\"flx-ch\">f</span><span class=\"flx-ch\">7</span><span class=\"flx-ch\">-</span><span class=\"flx-ch\">…</span><span class=\"flx-ch\">\"</span></span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">6</span><span class=\"flx-tx\"><span class=\"flx-ch\">}</span></span></div></div></div></div></div> <div class=\"flx-poll\" data-flx=\"poll\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M20 11a8 8 0 00-14-4.9L4 8\"/><path d=\"M4 3.5V8h4.5\"/><path d=\"M4 13a8 8 0 0014 4.9L20 16\"/><path d=\"M20 20.5V16h-4.5\"/></svg>/GetAccountsDetailAsync</div> <div class=\"flx-c2\" data-flx=\"c2\"><div class=\"flx-gb\"><div class=\"flx-in flx-dk\"><div class=\"flx-tb\"><div class=\"flx-dots\"><i></i><i></i><i></i></div><span class=\"flx-lab\"></span><span class=\"flx-st\"><span class=\"flx-chip flx-c200\">200</span></span></div><div class=\"flx-code\" style=\"padding-bottom:20px\"><div class=\"flx-ln\"><span class=\"flx-no\">1</span><span class=\"flx-tx\"><span class=\"flx-ch\">{</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">2</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">H</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">p</span><span class=\"flx-ch\">S</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">C</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">d</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-n\"><span class=\"flx-ch\">2</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">0</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">3</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">A</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">[</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">4</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">{</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">5</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">T</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">l</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">C</span><span class=\"flx-ch\">h</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">q</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">g</span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">A</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">6</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">A</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">N</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">m</span><span class=\"flx-ch\">b</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">5</span><span class=\"flx-ch\">8</span><span class=\"flx-ch\">9</span><span class=\"flx-ch\">3</span><span class=\"flx-ch\">4</span><span class=\"flx-ch\">9</span><span class=\"flx-ch\">3</span><span class=\"flx-ch\">4</span><span class=\"flx-ch\">8</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">7</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">T</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">N</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">m</span><span class=\"flx-ch\">b</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">4</span><span class=\"flx-ch\">3</span><span class=\"flx-ch\">8</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">8</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">I</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">s</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">i</span><span class=\"flx-ch\">o</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">N</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">m</span><span class=\"flx-ch\">b</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">0</span><span class=\"flx-ch\">3</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">9</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">B</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">l</span><span class=\"flx-ch\">a</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">{</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">10</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">C</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">t</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-n\"><span class=\"flx-ch\">4</span><span class=\"flx-ch\">9</span><span class=\"flx-ch\">9</span><span class=\"flx-ch\">8</span><span class=\"flx-ch\">2</span><span class=\"flx-ch\">.</span><span class=\"flx-ch\">8</span><span class=\"flx-ch\">6</span></span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">11</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">}</span><span class=\"flx-ch\">,</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">12</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-k\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">C</span><span class=\"flx-ch\">u</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">r</span><span class=\"flx-ch\">e</span><span class=\"flx-ch\">n</span><span class=\"flx-ch\">c</span><span class=\"flx-ch\">y</span><span class=\"flx-ch\">\"</span></span><span class=\"flx-ch\">:</span><span class=\"flx-ch\"> </span><span class=\"flx-s\"><span class=\"flx-ch\">\"</span><span class=\"flx-ch\">C</span><span class=\"flx-ch\">A</span><span class=\"flx-ch\">D</span><span class=\"flx-ch\">\"</span></span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">13</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">}</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">14</span><span class=\"flx-tx\"><span class=\"flx-ch\"> </span><span class=\"flx-ch\"> </span><span class=\"flx-ch\">]</span></span></div><div class=\"flx-ln\"><span class=\"flx-no\">15</span><span class=\"flx-tx\"><span class=\"flx-ch\">}</span></span></div></div></div></div></div> </div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-fraud-api { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-fraud-api:not([data-flx-ready]) { visibility: hidden; } .flx-fraud-api *, .flx-fraud-api *::before, .flx-fraud-api *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-fraud-api div, .flx-fraud-api p { display: block; } .flx-fraud-api span, .flx-fraud-api strong, .flx-fraud-api em, .flx-fraud-api b { display: inline; } .flx-fraud-api svg { display: block; max-width: none; max-height: none; } .flx-fraud-api .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-fraud-api .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-fraud-api.is-static *, .flx-fraud-api.is-static *::before { transition: none !important; animation: none !important; } .flx-fraud-api svg.flx-i { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; } .flx-fraud-api .flx-gb { padding:4px; border-radius:24px; background:linear-gradient(160deg,#8FD6F2 0%,#DDF3FB 45%,#A9DFF5 100%); box-shadow:0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06); } .flx-fraud-api .flx-in { border-radius:20px; overflow:hidden; position:relative; } .flx-fraud-api .flx-in.flx-light { background:#fff; } .flx-fraud-api .flx-in.flx-dark { background:#1B1B3C; color:#fff; } .flx-fraud-api .flx-pill { display:inline-flex; align-items:center; background:var(--flx-red,#E5484D); color:#fff; font-weight:600; border-radius:999px; white-space:nowrap; } .flx-fraud-api .flx-badge { width:38px; height:38px; border-radius:50%; background:#E6F6FC; color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-fraud-api .flx-badge svg { width:20px; height:20px; } .flx-fraud-api .flx-shield { width:18px; height:18px; color:var(--flx-accent,#00ACE4); flex:none; } .flx-fraud-api .flx-mono, .flx-fraud-api .flx-code { font-family:'Flinks Roboto Mono','Roboto Mono',ui-monospace,Menlo,Consolas,monospace; } .flx-fraud-api .flx-dk { background:#11132A; color:#fff; } .flx-fraud-api .flx-tb { display:flex; align-items:center; gap:12px; height:38px; padding:0 16px; } .flx-fraud-api .flx-dots { display:flex; gap:6px; } .flx-fraud-api .flx-dots i { width:9px; height:9px; border-radius:50%; background:#3A3E57; display:block; } .flx-fraud-api .flx-lab { font-family:'Flinks Roboto Mono','Roboto Mono',ui-monospace,Menlo,monospace; font-size:11.5px; color:#8C93A8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; } .flx-fraud-api .flx-code { padding:6px 16px 0 10px; font-size:13px; line-height:22px; } .flx-fraud-api .flx-ln { display:flex; } .flx-fraud-api .flx-no { width:34px; text-align:right; padding-right:14px; color:#5B6078; flex:none; user-select:none; } .flx-fraud-api .flx-tx { white-space:pre; color:#E6E9F5; } .flx-fraud-api .flx-k { color:#FFFFFF; } .flx-fraud-api .flx-s { color:#2DC08E; } .flx-fraud-api .flx-n { color:#6DD5F5; } .flx-fraud-api .flx-m { color:#00ACE4; font-weight:500; } .flx-fraud-api .flx-pth { color:#C9CEDE; } .flx-fraud-api .flx-chip { display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; color:#fff; font-family:'Flinks Inter','Inter',sans-serif; } .flx-fraud-api .flx-c200 { background:#27AE60; } .flx-fraud-api .flx-c202 { background:#F2994A; } .flx-fraud-api .flx-spn { width:14px; height:14px; color:#8C93A8; } .flx-fraud-api .flx-pill { display:inline-flex; align-items:center; background:var(--flx-red,#E5484D); color:#fff; font-weight:600; border-radius:999px; white-space:nowrap; font-size:13px; padding:6px 14px; } .flx-fraud-api .flx-ind { display:flex; align-items:center; gap:12px; height:46px; padding:0 14px; background:#F6F8FB; border-radius:12px; font-size:14px; font-weight:500; } .flx-fraud-api .flx-ic { width:30px; height:30px; border-radius:50%; background:var(--flx-red-soft,#FDECEC); color:var(--flx-red,#E5484D); display:grid; place-items:center; flex:none; } .flx-fraud-api .flx-ic svg { width:16px; height:16px; } .flx-fraud-api .flx-fn { font-size:12.5px; color:var(--flx-muted,#6B7088); margin-bottom:10px; } .flx-fraud-api .flx-rows { display:flex; flex-direction:column; gap:6px; margin-top:12px; } .flx-fraud-api .flx-c1 { position:absolute; left:57px; top:62px; width:420px; } .flx-fraud-api .flx-c2 { position:absolute; left:326px; top:213px; width:336px; } .flx-fraud-api .flx-c1 .flx-code, .flx-fraud-api .flx-c2 .flx-code { font-size:12px; line-height:21px; padding:6px 12px 0 8px; } .flx-fraud-api .flx-c1 .flx-no, .flx-fraud-api .flx-c2 .flx-no { width:28px; padding-right:12px; } .flx-fraud-api .flx-poll { position:absolute; left:70px; top:281px; display:inline-flex; align-items:center; gap:8px; background:#fff; border-radius:999px; padding:8px 14px; box-shadow:0 10px 24px -10px rgba(27,27,60,.28), 0 1px 3px rgba(27,27,60,.08); font-family:'Flinks Roboto Mono','Roboto Mono',ui-monospace,Menlo,monospace; font-size:12px; color:#1B1B3C; } .flx-fraud-api .flx-poll svg { width:15px; height:15px; color:#00ACE4; } .flx-fraud-api .flx-c1, .flx-fraud-api .flx-c2, .flx-fraud-api .flx-poll { transition:left .9s cubic-bezier(.4,0,.2,1), top .9s cubic-bezier(.4,0,.2,1), opacity .6s, transform .8s cubic-bezier(.4,0,.2,1); } .flx-fraud-api .flx-c1 { left:150px; top:124px; } .flx-fraud-api .flx-poll { left:164px; top:346px; } .flx-fraud-api .flx-p2 .flx-c1 { left:57px; top:62px; } .flx-fraud-api .flx-p2 .flx-poll { left:70px; top:281px; } .flx-fraud-api .flx-boot .flx-c1 { opacity:0; transform:translateY(14px); } .flx-fraud-api .flx-poll { opacity:0; transform:scale(.9); } .flx-fraud-api .flx-poll.flx-show { opacity:1; transform:none; } .flx-fraud-api .flx-c2 { opacity:0; transform:translate(60px,60px); } .flx-fraud-api .flx-c2.flx-in { opacity:1; transform:none; } .flx-fraud-api .flx-c2.flx-out { opacity:1; transform:translateX(440px); } .flx-fraud-api .flx-rst { transition:none ; } .flx-fraud-api .flx-ch { opacity:0; } .flx-fraud-api .flx-ch.flx-on { opacity:1; } .flx-fraud-api .flx-no { opacity:0; } .flx-fraud-api .flx-ln.flx-on .flx-no { opacity:1; } .flx-fraud-api .flx-st { display:flex; align-items:center; gap:10px; opacity:0; transform:scale(.7); transition:opacity .35s, transform .35s; transform-origin:right center; } .flx-fraud-api .flx-done .flx-st { opacity:1; transform:none; } @keyframes flx-fa-rot { to{ transform:rotate(360deg); } } .flx-fraud-api .flx-c1 .flx-spn, .flx-fraud-api .flx-poll svg { animation:flx-fa-rot 1.3s linear infinite; } .flx-fraud-api .flx-c1.flx-stop .flx-spn { animation:none; opacity:.35; } .flx-fraud-api .flx-poll.flx-stop svg { animation:none; } .flx-fraud-api .flx-cur { display:inline-block; width:7px; height:14px; background:#6DD5F5; vertical-align:-2px; margin-left:1px; animation:flx-fa-blink 1s steps(1) infinite; } @keyframes flx-fa-blink { 50%{ opacity:0; } }";
  if(!window.customElements||customElements.get(TAG))return;
  function px(v){return /^d+(.d+)?$/.test(v)?v+'px':v;}
  class FlinksEl extends HTMLElement{
    connectedCallback(){
      if(this._flx)return;
      var sr=this.shadowRoot||this.attachShadow({mode:'open'});
      sr.innerHTML='<style>'+CSS+'</style>'+MARKUP;
      var r=sr.querySelector('.'+ROOT), a=this.getAttribute.bind(this);
      if(this.hasAttribute('width'))this.style.setProperty('--flx-width',px(a('width')));
      if(this.hasAttribute('height'))this.style.setProperty('--flx-height',px(a('height')));
      if(this.hasAttribute('max-width'))this.style.setProperty('--flx-max-width',px(a('max-width')));
      ['autoplay','static','font','font-base'].forEach(function(k){ if(this.hasAttribute(k))r.setAttribute('data-'+k,a(k)); },this);
      if(this.hasAttribute('respect-reduced-motion'))r.setAttribute('data-respect-reduced-motion',a('respect-reduced-motion'));
      this._flx=window.FlinksAnimations['fraud-api'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
