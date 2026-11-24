/*!
 * Flinks animation runtime (shared by every illustration; inlined into each package's animation.js).
 * Vanilla JS, no dependencies. Provides: scaling, lifecycle (visibility / viewport / reduced motion),
 * cancellable timers, duplicate-init protection and a small public API.
 */
(function (global) {
  'use strict';

  var DEFAULT_FRAME = [720, 500];
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

    var FRAME_W = (def.frame || DEFAULT_FRAME)[0], FRAME_H = (def.frame || DEFAULT_FRAME)[1];
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

/* ===== Flinks · Document enrich (Document Processing & Fraud Detection, card 04) — animation logic. Sequence/timings 1:1 with original-docfraud/a4.html ===== */
(function () {
  var st, canvas, zm, v, kp, FINAL = 6947.63;
  function fmt(n) { return '$ ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function setup(c) {
    st = c.q('.flx-stage'); canvas = c.q('.flx-canvas'); zm = c.q('.flx-zm'); v = zm.querySelector('.flx-v');
    var tile = c.q('.flx-tl > div'); tile.classList.add('flx-emp'); kp = tile.querySelector('.flx-kp');
  }
  function from() {                           // transform that places the popup over the Employer Info tile
    var cr = canvas.getBoundingClientRect(), k = cr.width / canvas.offsetWidth, t = kp.getBoundingClientRect(), z = { x: zm.offsetLeft, y: zm.offsetTop, w: zm.offsetWidth, h: zm.offsetHeight };
    var tx = (t.left - cr.left) / k, ty = (t.top - cr.top) / k, tw = t.width / k, th = t.height / k, s = Math.min(tw / z.w, th / z.h);
    var dx = tx + tw / 2 - (z.x + z.w * s / 2), dy = ty + th / 2 - (z.y + z.h * s / 2);
    return 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
  }
  function setZ(tr, op, dur, ease) { zm.style.transition = 'transform ' + dur + 'ms ' + ease + ', opacity ' + Math.min(dur, 260) + 'ms ease'; zm.style.transform = tr; zm.style.opacity = op; }
  function count(c, ms) {
    return new Promise(function (res) {
      var t0 = performance.now();
      (function f(now) { var p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3); v.textContent = fmt(FINAL * e); if (p < 1) c.raf(f); else res(); })(t0);
    });
  }
  function hide() { zm.style.transition = 'none'; zm.style.transform = from(); zm.style.opacity = 0; v.textContent = fmt(0); st.classList.remove('flx-t'); }
  function reset() { st.classList.remove('flx-glow', 'flx-t'); hide(); }
  function final() {                          // reduced-motion / static frame: employer trend shown (as original)
    st.classList.remove('flx-glow'); zm.style.transition = ''; zm.style.transform = ''; zm.style.opacity = ''; v.textContent = fmt(FINAL); st.classList.add('flx-t');
  }
  async function run(c) {
    for (;;) {
      await c.sleep(1400);
      st.classList.add('flx-glow'); await c.sleep(350);
      setZ('none', 1, 700, 'cubic-bezier(.2,1.1,.3,1)'); await c.sleep(750);          // pops out of the Employer Info tile
      await count(c, 1300); await c.sleep(250);                                       // numbers count in
      st.classList.add('flx-t'); await c.sleep(4200);                                 // employer trend appears, hold
      setZ(from(), 1, 650, 'cubic-bezier(.5,0,.8,.4)'); await c.sleep(520); zm.style.opacity = 0; await c.sleep(200);   // back into the tile
      st.classList.remove('flx-glow'); hide(); await c.sleep(300);
    }
  }
  window.FlinksAnimations.register('document-enrich', 'flx-document-enrich', { frame: [700, 500], setup: setup, reset: reset, final: final, run: run });
})();
