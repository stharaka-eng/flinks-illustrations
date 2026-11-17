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

/* ===== Flinks · Bank connectivity (Gaming & Lottery, card 01) — animation logic. Sequence/timings 1:1 with original-gaming/a1.html ===== */
(function () {
  var stage, canvas, cursor, cn, sel, inp, a1;
  function setup(c) {
    stage = c.q('.flx-stage'); canvas = c.q('.flx-canvas'); cursor = c.q('.flx-cursor'); cn = c.q('.flx-cn');
    sel = c.q('[data-flx="selrow"]'); inp = c.q('[data-flx="inp"]'); a1 = c.q('[data-flx="a1"]');
  }
  function reset() {
    stage.className = 'flx-stage'; cn.classList.remove('flx-out', 'flx-rst'); inp.classList.remove('flx-focus');
    a1.textContent = ''; cursor.style.opacity = ''; cursor.style.transform = '';
  }
  function final() { reset(); stage.className = 'flx-stage flx-amt flx-p2'; a1.textContent = '$200.00'; }
  function moveTo(c, el, fx, fy) {
    var cr = canvas.getBoundingClientRect(), k = cr.width / canvas.offsetWidth, b = el.getBoundingClientRect();
    cursor.style.opacity = '1'; cursor.style.transform = 'translate(' + ((b.left - cr.left) / k + b.width * (fx || .5)) + 'px,' + ((b.top - cr.top) / k + b.height * (fy || .5)) + 'px)';
  }
  function press(c, el) { el.classList.add('flx-pr'); return c.sleep(170).then(function () { el.classList.remove('flx-pr'); }); }
  function hideCursor() { cursor.style.opacity = '0'; }
  async function typeAmount(c) {
    inp.classList.add('flx-focus'); stage.classList.add('flx-amt'); a1.textContent = '';
    var t = '$200.00'; for (var i = 0; i < t.length; i++) { a1.textContent += t[i]; await c.sleep(i === 0 ? 260 : 150); }
    await c.sleep(450); inp.classList.remove('flx-focus');
  }
  async function run(c) {
    for (;;) {
      await c.sleep(1200);                                               // 01 · operator withdrawal screen, amount at $0.00
      moveTo(c, inp, .3, .5); await c.sleep(950); await press(c, inp);
      await typeAmount(c);                                               // $200.00 is typed in
      moveTo(c, sel, .35, .5); await c.sleep(1000); await press(c, sel);
      stage.classList.add('flx-p2'); await c.sleep(2900);                // 02 · Connect sheet in, banks listed
      var b1 = stage.querySelector('.flx-bk.flx-b1');
      moveTo(c, b1, .55, .5); await c.sleep(1000); await press(c, b1);
      stage.classList.add('flx-pick'); await c.sleep(900);               // choose a bank
      hideCursor(); cn.classList.add('flx-out'); stage.classList.remove('flx-p2'); stage.classList.add('flx-done'); await c.sleep(1100);   // sheet slides out, selection confirmed
      cn.classList.add('flx-rst'); cn.classList.remove('flx-out'); stage.classList.remove('flx-pick');   // snap back without transition
      c.raf(function () { c.raf(function () { cn.classList.remove('flx-rst'); }); });
      await c.sleep(1700);
      stage.classList.remove('flx-done', 'flx-amt'); await c.sleep(700);  // revert in place (amount back to $0.00)
      a1.textContent = '';
    }
  }
  window.FlinksAnimations.register('bank-connectivity', 'flx-bank-connectivity', { setup: setup, reset: reset, final: final, run: run });
})();
