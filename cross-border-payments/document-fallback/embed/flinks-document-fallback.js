/*! Flinks document-fallback – single-file embed (Shadow DOM web component <flinks-document-fallback>) */
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

/* ===== Flinks · Document fallback (Cross-Border Payments, card 02) — animation logic. Sequence/timings 1:1 with original-xborder/a2.html ===== */
(function () {
  var stage, canvas, cursor, ex, pill;
  function setup(c) {
    stage = c.q('.flx-stage'); canvas = c.q('.flx-canvas'); cursor = c.q('.flx-cursor'); ex = c.q('[data-flx="ex"]'); pill = c.q('[data-flx="uppill"]');
  }
  function reset() { stage.className = 'flx-stage'; ex.classList.remove('flx-out', 'flx-rst'); cursor.style.opacity = ''; cursor.style.transform = ''; }
  function final() { reset(); stage.className = 'flx-stage flx-f1 flx-f2 flx-ok flx-p2'; }
  function moveTo(c, el, fx, fy) {
    var cr = canvas.getBoundingClientRect(), k = cr.width / canvas.offsetWidth, b = el.getBoundingClientRect();
    cursor.style.opacity = '1'; cursor.style.transform = 'translate(' + ((b.left - cr.left) / k + b.width * (fx || .5)) + 'px,' + ((b.top - cr.top) / k + b.height * (fy || .5)) + 'px)';
  }
  function press(c, el) { el.classList.add('flx-pr'); return c.sleep(170).then(function () { el.classList.remove('flx-pr'); }); }
  function hideCursor() { cursor.style.opacity = '0'; }
  async function run(c) {
    for (;;) {
      await c.sleep(1300);                                               // 01 · empty upload card
      moveTo(c, pill, .5, .5); await c.sleep(1000); await press(c, pill);
      stage.classList.add('flx-f1'); await c.sleep(450);                 // files are added and uploaded
      stage.classList.add('flx-f2'); await c.sleep(1500);
      stage.classList.add('flx-ok'); hideCursor(); await c.sleep(700);
      stage.classList.add('flx-p2'); await c.sleep(3400);                // 02 · account details extracted
      ex.classList.add('flx-out'); stage.classList.remove('flx-p2', 'flx-f1', 'flx-f2', 'flx-ok'); await c.sleep(1100);   // card slides away, upload card returns, rows collapse
      ex.classList.remove('flx-out');
    }
  }
  window.FlinksAnimations.register('document-fallback', 'flx-document-fallback', { setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-document-fallback', ROOT='flx-document-fallback';
  var MARKUP="<div class=\"flx-document-fallback\" role=\"img\" aria-label=\"Animation: documents are uploaded from a fallback upload card and the account details extracted from them are shown.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage\" data-flx=\"stage\"><div class=\"flx-canvas\" data-flx=\"canvas\"> <div class=\"flx-abs flx-up\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"> <h3>Upload new document</h3> <div class=\"flx-dz\"><div class=\"flx-dzt\"><svg class=\"flx-isx\" width=\"16.7\" height=\"16.7\" viewBox=\"0 0 16.7098 16.7098\" fill=\"currentColor\" style=\"width:16.7px;height:16.7px;display:block;flex:none\"><path d=\"M10.4436 15.8395H6.26614C2.48555 15.8395 0.87027 14.2243 0.87027 10.4437V6.26623C0.87027 2.48564 2.48555 0.870361 6.26614 0.870361H9.74734C10.0328 0.870361 10.2695 1.10708 10.2695 1.39254C10.2695 1.678 10.0328 1.91472 9.74734 1.91472H6.26614C3.05647 1.91472 1.91463 3.05656 1.91463 6.26623V10.4437C1.91463 13.6533 3.05647 14.7952 6.26614 14.7952H10.4436C13.6533 14.7952 14.7951 13.6533 14.7951 10.4437V6.96247C14.7951 6.67701 15.0318 6.44029 15.3173 6.44029C15.6027 6.44029 15.8394 6.67701 15.8394 6.96247V10.4437C15.8394 14.2243 14.2242 15.8395 10.4436 15.8395Z\"/><path d=\"M15.3172 7.4851H12.5323C10.1511 7.4851 9.22513 6.55909 9.22513 4.17794V1.39298C9.22513 1.18411 9.35045 0.989159 9.5454 0.912573C9.74035 0.829024 9.96314 0.877761 10.1163 1.02397L15.6862 6.5939C15.8325 6.74011 15.8812 6.96988 15.7976 7.16483C15.7141 7.35978 15.5261 7.4851 15.3172 7.4851ZM10.2695 2.65317V4.17794C10.2695 5.97424 10.736 6.44072 12.5323 6.44072H14.057L10.2695 2.65317Z\"/><path d=\"M9.05107 9.57341H4.87362C4.58816 9.57341 4.35144 9.33669 4.35144 9.05123C4.35144 8.76577 4.58816 8.52905 4.87362 8.52905H9.05107C9.33652 8.52905 9.57325 8.76577 9.57325 9.05123C9.57325 9.33669 9.33652 9.57341 9.05107 9.57341Z\"/><path d=\"M7.65858 12.3583H4.87362C4.58816 12.3583 4.35144 12.1216 4.35144 11.8361C4.35144 11.5507 4.58816 11.314 4.87362 11.314H7.65858C7.94404 11.314 8.18076 11.5507 8.18076 11.8361C8.18076 12.1216 7.94404 12.3583 7.65858 12.3583Z\"/></svg>Drag &amp; drop your file(s) here</div><span class=\"flx-pl\" data-flx=\"uppill\">Upload <svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4\"/><path d=\"M12 15V4\"/><path d=\"M8 8l4-4 4 4\"/></svg></span></div> <div class=\"flx-rw flx-rw1\"><div class=\"flx-fr\"><span class=\"flx-b\"><svg class=\"flx-isx\" width=\"16.7\" height=\"16.7\" viewBox=\"0 0 16.7098 16.7098\" fill=\"currentColor\" style=\"width:16.7px;height:16.7px;display:block;flex:none\"><path d=\"M10.4436 15.8395H6.26614C2.48555 15.8395 0.87027 14.2243 0.87027 10.4437V6.26623C0.87027 2.48564 2.48555 0.870361 6.26614 0.870361H9.74734C10.0328 0.870361 10.2695 1.10708 10.2695 1.39254C10.2695 1.678 10.0328 1.91472 9.74734 1.91472H6.26614C3.05647 1.91472 1.91463 3.05656 1.91463 6.26623V10.4437C1.91463 13.6533 3.05647 14.7952 6.26614 14.7952H10.4436C13.6533 14.7952 14.7951 13.6533 14.7951 10.4437V6.96247C14.7951 6.67701 15.0318 6.44029 15.3173 6.44029C15.6027 6.44029 15.8394 6.67701 15.8394 6.96247V10.4437C15.8394 14.2243 14.2242 15.8395 10.4436 15.8395Z\"/><path d=\"M15.3172 7.4851H12.5323C10.1511 7.4851 9.22513 6.55909 9.22513 4.17794V1.39298C9.22513 1.18411 9.35045 0.989159 9.5454 0.912573C9.74035 0.829024 9.96314 0.877761 10.1163 1.02397L15.6862 6.5939C15.8325 6.74011 15.8812 6.96988 15.7976 7.16483C15.7141 7.35978 15.5261 7.4851 15.3172 7.4851ZM10.2695 2.65317V4.17794C10.2695 5.97424 10.736 6.44072 12.5323 6.44072H14.057L10.2695 2.65317Z\"/><path d=\"M9.05107 9.57341H4.87362C4.58816 9.57341 4.35144 9.33669 4.35144 9.05123C4.35144 8.76577 4.58816 8.52905 4.87362 8.52905H9.05107C9.33652 8.52905 9.57325 8.76577 9.57325 9.05123C9.57325 9.33669 9.33652 9.57341 9.05107 9.57341Z\"/><path d=\"M7.65858 12.3583H4.87362C4.58816 12.3583 4.35144 12.1216 4.35144 11.8361C4.35144 11.5507 4.58816 11.314 4.87362 11.314H7.65858C7.94404 11.314 8.18076 11.5507 8.18076 11.8361C8.18076 12.1216 7.94404 12.3583 7.65858 12.3583Z\"/></svg></span><span class=\"flx-n\">Void Cheque.pdf</span><svg class=\"flx-i flx-t\" viewBox=\"0 0 24 24\" ><path d=\"M4 7h16\"/><path d=\"M9 7V4.5h6V7\"/><path d=\"M6 7l1 13h10l1-13\"/><path d=\"M10 11v6M14 11v6\"/></svg><span class=\"flx-bar\"><i></i></span></div></div> <div class=\"flx-rw flx-rw2\"><div class=\"flx-fr\"><span class=\"flx-b\"><svg class=\"flx-isx\" width=\"16.7\" height=\"16.7\" viewBox=\"0 0 16.7098 16.7098\" fill=\"currentColor\" style=\"width:16.7px;height:16.7px;display:block;flex:none\"><path d=\"M10.4436 15.8395H6.26614C2.48555 15.8395 0.87027 14.2243 0.87027 10.4437V6.26623C0.87027 2.48564 2.48555 0.870361 6.26614 0.870361H9.74734C10.0328 0.870361 10.2695 1.10708 10.2695 1.39254C10.2695 1.678 10.0328 1.91472 9.74734 1.91472H6.26614C3.05647 1.91472 1.91463 3.05656 1.91463 6.26623V10.4437C1.91463 13.6533 3.05647 14.7952 6.26614 14.7952H10.4436C13.6533 14.7952 14.7951 13.6533 14.7951 10.4437V6.96247C14.7951 6.67701 15.0318 6.44029 15.3173 6.44029C15.6027 6.44029 15.8394 6.67701 15.8394 6.96247V10.4437C15.8394 14.2243 14.2242 15.8395 10.4436 15.8395Z\"/><path d=\"M15.3172 7.4851H12.5323C10.1511 7.4851 9.22513 6.55909 9.22513 4.17794V1.39298C9.22513 1.18411 9.35045 0.989159 9.5454 0.912573C9.74035 0.829024 9.96314 0.877761 10.1163 1.02397L15.6862 6.5939C15.8325 6.74011 15.8812 6.96988 15.7976 7.16483C15.7141 7.35978 15.5261 7.4851 15.3172 7.4851ZM10.2695 2.65317V4.17794C10.2695 5.97424 10.736 6.44072 12.5323 6.44072H14.057L10.2695 2.65317Z\"/><path d=\"M9.05107 9.57341H4.87362C4.58816 9.57341 4.35144 9.33669 4.35144 9.05123C4.35144 8.76577 4.58816 8.52905 4.87362 8.52905H9.05107C9.33652 8.52905 9.57325 8.76577 9.57325 9.05123C9.57325 9.33669 9.33652 9.57341 9.05107 9.57341Z\"/><path d=\"M7.65858 12.3583H4.87362C4.58816 12.3583 4.35144 12.1216 4.35144 11.8361C4.35144 11.5507 4.58816 11.314 4.87362 11.314H7.65858C7.94404 11.314 8.18076 11.5507 8.18076 11.8361C8.18076 12.1216 7.94404 12.3583 7.65858 12.3583Z\"/></svg></span><span class=\"flx-n\">Monthly Statement – Apr 2026.pdf</span><svg class=\"flx-i flx-t\" viewBox=\"0 0 24 24\" ><path d=\"M4 7h16\"/><path d=\"M9 7V4.5h6V7\"/><path d=\"M6 7l1 13h10l1-13\"/><path d=\"M10 11v6M14 11v6\"/></svg><span class=\"flx-bar\"><i></i></span></div></div> </div></div></div> <div class=\"flx-abs flx-ex\" data-flx=\"ex\"><div class=\"flx-gb\"><div class=\"flx-in flx-dark\"> <div class=\"flx-hd\"><span class=\"flx-fn\">Void Cheque.pdf</span><svg class=\"flx-gk\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#27AE60\"/><path d=\"M7.5 12.3l3 3 6-6.3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></div> <div class=\"flx-pairs\"><div class=\"flx-pair\" style=\"--flx-i:0\"><div class=\"flx-l\">FINANCIAL INSTITUTION</div><div class=\"flx-v\">BMO</div></div><div class=\"flx-pair\" style=\"--flx-i:1\"><div class=\"flx-l\">TRANSIT NUMBER</div><div class=\"flx-v\">00438</div></div><div class=\"flx-pair\" style=\"--flx-i:2\"><div class=\"flx-l\">INSTITUTION NUMBER</div><div class=\"flx-v\">003</div></div><div class=\"flx-pair\" style=\"--flx-i:3\"><div class=\"flx-l\">ACCOUNT NUMBER</div><div class=\"flx-v\">589349348</div></div></div> </div></div></div> <svg class=\"flx-cursor\" data-flx=\"cursor\" viewBox=\"0 0 24 24\"><path d=\"M5 3l14 8-6.2 1.6L9.6 19z\" fill=\"#1B1B3C\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg> </div></div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-document-fallback { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-document-fallback:not([data-flx-ready]) { visibility: hidden; } .flx-document-fallback *, .flx-document-fallback *::before, .flx-document-fallback *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-document-fallback div, .flx-document-fallback p { display: block; } .flx-document-fallback span, .flx-document-fallback strong, .flx-document-fallback em, .flx-document-fallback b { display: inline; } .flx-document-fallback b, .flx-document-fallback strong { font-weight: 700; } .flx-document-fallback em { font-style: italic; } .flx-document-fallback svg { display: block; max-width: none; max-height: none; } .flx-document-fallback .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-document-fallback .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-document-fallback.is-static *, .flx-document-fallback.is-static *::before { transition: none !important; animation: none !important; } .flx-document-fallback .flx-canvas { position:absolute; left:0; top:0; width:720px; height:500px; transform:scale(1.00000); transform-origin:0 0; } .flx-document-fallback svg.flx-i { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; } .flx-document-fallback .flx-abs { position:absolute; } .flx-document-fallback .flx-gb { padding:var(--flx-gb-w,4px); border-radius:var(--flx-gb-outer,24px); background:var(--flx-gb-gradient,linear-gradient(160deg, #8FD6F2 0%, #DDF3FB 45%, #A9DFF5 100%)); box-shadow:var(--flx-gb-shadow,0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06)); } .flx-document-fallback .flx-in { position:relative; overflow:hidden; border-radius:var(--flx-gb-inner,20px); } .flx-document-fallback .flx-in.flx-light { background:var(--flx-white,#FFFFFF); } .flx-document-fallback .flx-in.flx-dark { background:var(--flx-text,#1B1B3C); color:#fff; } .flx-document-fallback .flx-in.flx-code { background:var(--flx-code-bg,#11132A); color:var(--flx-code-text,#E6E9F5); } .flx-document-fallback .flx-badge { width:38px; height:38px; border-radius:50%; background:var(--flx-accent-soft,#E6F6FC); color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-document-fallback .flx-badge svg { width:20px; height:20px; } .flx-document-fallback .flx-pill { display:inline-flex; align-items:center; font-weight:600; font-size:13px; padding:6px 14px; border-radius:999px; color:#fff; white-space:nowrap; flex:none; } .flx-document-fallback .flx-pill.flx-danger { background:var(--flx-danger,#E5484D); } .flx-document-fallback .flx-pill.flx-warning { background:var(--flx-warning,#F2994A); } .flx-document-fallback .flx-pill.flx-success { background:var(--flx-success,#27AE60); } .flx-document-fallback .flx-pill.flx-neutral { background:#E8ECF2; color:#4A4F6A; } .flx-document-fallback .flx-pill.flx-sm { font-size:11px; padding:3px 10px; } .flx-document-fallback .flx-row { display:flex; align-items:center; gap:14px; height:56px; padding:0 16px; background:var(--flx-surface,#F6F8FB); border-radius:14px; font-size:var(--flx-t-item,15px); font-weight:500; } .flx-document-fallback .flx-row.flx-sel { background:#E8F6FC; box-shadow:inset 3px 0 0 var(--flx-accent,#00ACE4); } .flx-document-fallback .flx-ic { width:36px; height:36px; border-radius:50%; background:var(--flx-danger-soft,#FDECEC); color:var(--flx-danger,#E5484D); display:grid; place-items:center; flex:none; } .flx-document-fallback .flx-ic svg { width:18px; height:18px; } .flx-document-fallback .flx-ic.flx-accent { background:var(--flx-accent-soft,#E6F6FC); color:var(--flx-accent,#00ACE4); } .flx-document-fallback .flx-btn { display:flex; align-items:center; justify-content:center; height:48px; border-radius:999px; background:var(--flx-accent,#00ACE4); color:#fff; font-size:15.5px; font-weight:600; } .flx-document-fallback .flx-btn.flx-off { background:#9ADBF3; } .flx-document-fallback .flx-btn-o { display:inline-block; background:#fff; border:1px solid #D5DBE5; border-radius:10px; padding:7px 13px; font-size:12.5px; font-weight:500; color:var(--flx-text,#1B1B3C); white-space:nowrap; } .flx-document-fallback .flx-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border-radius:999px; background:#fff; border:1px solid var(--flx-hairline,#E3E7EF); font-size:12px; font-weight:500; white-space:nowrap; } .flx-document-fallback .flx-chip i { width:8px; height:8px; border-radius:50%; display:block; } .flx-document-fallback .flx-chip.flx-sel { border-color:var(--flx-accent,#00ACE4); background:#EAF7FD; } .flx-document-fallback .flx-dots { display:flex; gap:6px; align-items:center; } .flx-document-fallback .flx-dots i { width:9px; height:9px; border-radius:50%; background:#D9DEE7; display:block; } .flx-document-fallback .flx-tip { background:var(--flx-text,#1B1B3C); color:#fff; font-size:12.5px; line-height:17px; padding:9px 14px; border-radius:10px; } .flx-document-fallback .flx-num { position:absolute; right:-9px; top:-10px; width:20px; height:20px; border-radius:50%; background:var(--flx-danger,#E5484D); color:#fff; font-size:11px; font-weight:700; display:grid; place-items:center; z-index:2; box-shadow:0 0 0 2px #fff; } .flx-document-fallback .flx-flag { position:relative; } .flx-document-fallback .flx-flag::after { content:\"\"; position:absolute; inset:-3px -6px; border-radius:9px; background:rgba(229,72,77,.035); box-shadow:inset 0 0 0 2px var(--flx-danger,#E5484D); pointer-events:none; } .flx-document-fallback .flx-spn { width:14px; height:14px; color:#9AA3B5; animation:flx-df-cb-rot 1.4s linear infinite; } @keyframes flx-df-cb-rot { to{ transform:rotate(360deg); } } .flx-document-fallback .flx-shadow-soft { box-shadow:0 1px 4px rgba(27,27,60,.07); } .flx-document-fallback .flx-floating { box-shadow:0 10px 24px -10px rgba(27,27,60,.28), 0 1px 3px rgba(27,27,60,.08); } .flx-document-fallback .flx-dz { border:1.5px dashed #B3DDEF; border-radius:18px; background:#F2FAFD; padding:16px 12px; text-align:center; } .flx-document-fallback .flx-frow { position:relative; display:flex; align-items:center; gap:12px; height:52px; padding:0 16px; background:#fff; border-radius:16px; box-shadow:0 1px 4px rgba(27,27,60,.07); font-size:15px; font-weight:500; } .flx-document-fallback .flx-tb { display:flex; align-items:center; gap:12px; height:38px; padding:0 16px; } .flx-document-fallback .flx-tb .flx-dots i { background:#3A3E57; } .flx-document-fallback .flx-code { font-family:var(--flx-mono,'Flinks Roboto Mono','Roboto Mono',ui-monospace,Menlo,Consolas,monospace); font-size:12px; line-height:21px; padding:6px 12px 0 8px; color:var(--flx-code-text,#E6E9F5); } .flx-document-fallback .flx-code .flx-ln { display:flex; } .flx-document-fallback .flx-code .flx-no { width:28px; padding-right:12px; text-align:right; color:var(--flx-code-line,#5B6078); flex:none; user-select:none; } .flx-document-fallback .flx-code .flx-tx { white-space:pre; } .flx-document-fallback .flx-code .flx-k { color:var(--flx-code-key,#FFFFFF); } .flx-document-fallback .flx-code .flx-s { color:var(--flx-code-string,#2DC08E); } .flx-document-fallback .flx-code .flx-n { color:var(--flx-code-number,#6DD5F5); } .flx-document-fallback .flx-code .flx-m { color:var(--flx-accent,#00ACE4); font-weight:500; } .flx-document-fallback .flx-status { display:inline-flex; align-items:center; font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; color:#fff; } .flx-document-fallback .flx-status.flx-s200 { background:var(--flx-success,#27AE60); } .flx-document-fallback .flx-status.flx-s202 { background:var(--flx-warning,#F2994A); } .flx-document-fallback .flx-nt *, .flx-document-fallback .flx-rst, .flx-document-fallback .flx-rst * { transition:none !important; } .flx-document-fallback .flx-out { opacity:1 !important; transition-delay:0s !important; } .flx-document-fallback .flx-up { left:53px; top:48px; width:336px; z-index:1; } .flx-document-fallback .flx-up .flx-in { padding:18px 18px 18px; } .flx-document-fallback .flx-up h3 { font-size:16px; line-height:20px; font-weight:600; letter-spacing:-.01em; } .flx-document-fallback .flx-up .flx-sub { font-size:11px; line-height:15px; color:var(--flx-muted,#6B7088); margin-top:4px; } .flx-document-fallback .flx-up .flx-dz { margin-top:12px; padding:14px 10px; } .flx-document-fallback .flx-up .flx-dzt { display:flex; align-items:center; justify-content:center; gap:7px; font-size:12.5px; font-weight:500; } .flx-document-fallback .flx-up .flx-dzt svg { width:16px; height:16px; color:var(--flx-accent,#00ACE4); } .flx-document-fallback .flx-up .flx-pl { display:inline-flex; align-items:center; gap:9px; height:30px; padding:0 14px; margin-top:9px; background:#fff; border:1px solid #DDE4EE; border-radius:999px; font-size:12px; font-weight:600; } .flx-document-fallback .flx-up .flx-pl svg { width:14px; height:14px; color:var(--flx-accent,#00ACE4); } .flx-document-fallback .flx-up .flx-fr { display:flex; align-items:center; gap:9px; height:44px; padding:0 10px; background:var(--flx-surface,#F6F8FB); border-radius:12px; margin-top:8px; font-size:12px; font-weight:500; } .flx-document-fallback .flx-up .flx-fr:first-of-type { margin-top:12px; } .flx-document-fallback .flx-up .flx-fr .flx-b { width:26px; height:26px; border-radius:50%; background:var(--flx-accent-soft,#E6F6FC); color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-document-fallback .flx-up .flx-fr .flx-b svg { width:15px; height:15px; } .flx-document-fallback .flx-up .flx-fr .flx-n { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .flx-document-fallback .flx-up .flx-fr .flx-t { width:15px; height:15px; color:var(--flx-danger,#E5484D); flex:none; } .flx-document-fallback .flx-ex { left:337px; top:106px; width:312px; z-index:2; } .flx-document-fallback .flx-ex .flx-in { padding:20px 24px 22px; } .flx-document-fallback .flx-ex .flx-hd { display:flex; align-items:center; gap:10px; } .flx-document-fallback .flx-ex .flx-fn { flex:1; font-size:13px; color:rgba(255,255,255,.75); } .flx-document-fallback .flx-ex .flx-gk { width:22px; height:22px; flex:none; } .flx-document-fallback .flx-ex .flx-pairs { margin-top:14px; } .flx-document-fallback .flx-ex .flx-pair { padding:13px 0 12px; border-top:1px solid rgba(255,255,255,.12); } .flx-document-fallback .flx-ex .flx-l { font-size:11.5px; letter-spacing:.02em; color:rgba(255,255,255,.58); } .flx-document-fallback .flx-ex .flx-v { font-size:21px; font-weight:600; margin-top:3px; letter-spacing:-.01em; } .flx-document-fallback .flx-up, .flx-document-fallback .flx-ex { transition:left .9s cubic-bezier(.4,0,.2,1), top .9s cubic-bezier(.4,0,.2,1), transform .9s cubic-bezier(.4,0,.2,1); } .flx-document-fallback .flx-up { left:192px; top:163px; } .flx-document-fallback .flx-f1 .flx-up { top:137px; } .flx-document-fallback .flx-f2 .flx-up { top:111px; } .flx-document-fallback .flx-p2 .flx-up { left:53px; top:48px; } .flx-document-fallback .flx-ex { transform:translateX(440px); } .flx-document-fallback .flx-p2 .flx-ex { transform:none; } .flx-document-fallback .flx-rw { max-height:0; opacity:0; overflow:hidden; padding-top:0; transition:max-height .45s cubic-bezier(.4,0,.2,1), opacity .4s, padding .45s; } .flx-document-fallback .flx-f1 .flx-rw1, .flx-document-fallback .flx-f2 .flx-rw2 { max-height:70px; opacity:1; padding-top:8px; } .flx-document-fallback .flx-f1 .flx-rw1 { padding-top:12px; } .flx-document-fallback .flx-up .flx-fr { position:relative; margin-top:0 !important; } .flx-document-fallback .flx-up .flx-fr .flx-t { opacity:0; transition:opacity .3s; } .flx-document-fallback .flx-ok .flx-up .flx-fr .flx-t { opacity:1; } .flx-document-fallback .flx-up .flx-fr .flx-bar { position:absolute; left:46px; right:34px; bottom:6px; height:2px; background:#E3E8F0; border-radius:2px; opacity:0; transition:opacity .3s; } .flx-document-fallback .flx-up .flx-fr .flx-bar i { display:block; height:100%; width:0; background:var(--flx-accent,#00ACE4); border-radius:2px; } .flx-document-fallback .flx-f1 .flx-rw1 .flx-bar, .flx-document-fallback .flx-f2 .flx-rw2 .flx-bar { opacity:1; } .flx-document-fallback .flx-f1 .flx-rw1 .flx-bar i, .flx-document-fallback .flx-f2 .flx-rw2 .flx-bar i { width:100%; transition:width .85s cubic-bezier(.3,.6,.3,1); } .flx-document-fallback .flx-ok .flx-up .flx-fr .flx-bar { opacity:0; } .flx-document-fallback .flx-ex .flx-pair { opacity:0; transform:translateY(8px); transition:opacity .45s, transform .45s; } .flx-document-fallback .flx-p2 .flx-ex .flx-pair { opacity:1; transform:none; transition-delay:calc(var(--flx-i) * .16s + 1.0s); } .flx-document-fallback .flx-ex .flx-gk { opacity:0; transform:scale(.6); transition:opacity .35s, transform .35s; } .flx-document-fallback .flx-p2 .flx-ex .flx-gk { opacity:1; transform:none; transition-delay:1.9s; } .flx-document-fallback .flx-ex.flx-out { transform:translateX(440px) !important; } .flx-document-fallback .flx-ex.flx-out .flx-pair, .flx-document-fallback .flx-ex.flx-out .flx-gk { opacity:1 !important; transform:none !important; transition:none !important; } .flx-document-fallback .flx-cursor { position:absolute; left:0; top:0; width:22px; height:22px; z-index:30; opacity:0; pointer-events:none; transform:translate(640px,440px); transition:transform .85s cubic-bezier(.45,0,.2,1), opacity .3s; filter:drop-shadow(0 2px 3px rgba(27,27,60,.3)); } .flx-document-fallback .flx-pr { transform:scale(.96) !important; } .flx-document-fallback .flx-rst, .flx-document-fallback .flx-rst * { transition:none !important; }";
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
      this._flx=window.FlinksAnimations['document-fallback'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
