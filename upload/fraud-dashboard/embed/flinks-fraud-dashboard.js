/*! Flinks fraud-dashboard – single-file embed (Shadow DOM web component <flinks-fraud-dashboard>) */
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

/* ===== Flinks · Fraud dashboard (card 04) — animation logic. Sequence/timings 1:1 with original/a4.html ===== */
(function () {
  var stage, cursor;
  function setup(c) { stage = c.q('.flx-stage'); cursor = c.q('.flx-cursor'); }
  var STATES = ['flx-sel1', 'flx-sel2', 'flx-f1', 'flx-f2', 'flx-tabB', 'flx-chg', 'flx-mg'];
  function reset() {
    STATES.forEach(function (s) { stage.classList.remove(s); });
    cursor.classList.add('is-snap'); cursor.style.opacity = '0'; cursor.style.transform = 'translate(560px,430px)';
  }
  function final() { reset(); stage.classList.add('flx-f2', 'flx-sel2'); }
  function q(s) { return stage.querySelector(s); }
  function moveTo(c, el, fx, fy) {
    var s = c.scale(), a = stage.getBoundingClientRect(), b = el.getBoundingClientRect();
    cursor.style.transform = 'translate(' + ((b.left - a.left) / s + b.width * (fx || .5)) + 'px,' + ((b.top - a.top) / s + b.height * (fy || .5)) + 'px)';
  }
  function press(c, el) { el.classList.add('flx-pr'); return c.sleep(170).then(function () { el.classList.remove('flx-pr'); }); }
  async function run(c) {
    for (;;) {
      reset(); await c.sleep(60); cursor.classList.remove('is-snap');
      await c.sleep(1700);                                                                   // 01 · starting screen: verdict + signals
      cursor.style.opacity = '1'; moveTo(c, q('.flx-r1'), .4, .5); await c.sleep(1000);       // 02 · examine flagged signals
      await press(c, q('.flx-r1')); stage.classList.add('flx-sel1', 'flx-f2'); await c.sleep(1500);
      moveTo(c, q('.flx-r2'), .4, .5); await c.sleep(900);
      await press(c, q('.flx-r2')); stage.classList.remove('flx-sel1', 'flx-f2'); stage.classList.add('flx-sel2', 'flx-f1'); await c.sleep(1600);
      moveTo(c, q('.flx-cA'), .5, .5); await c.sleep(1000);                                   // 03 · another document
      await press(c, q('.flx-cA')); stage.classList.remove('flx-sel2', 'flx-f1'); stage.classList.add('flx-tabB'); await c.sleep(2100);
      moveTo(c, q('[data-flx="mgb"]'), .5, .55); await c.sleep(1000);                         // 04 · manage documents
      await press(c, q('[data-flx="mgb"]')); stage.classList.add('flx-mg'); await c.sleep(1400);
      stage.classList.remove('flx-mg'); await c.sleep(350); stage.classList.add('flx-chg'); await c.sleep(1900);
      moveTo(c, q('.flx-cM'), .5, .5); await c.sleep(1000);                                   // back to May_2026.pdf = starting screen
      await press(c, q('.flx-cM')); stage.classList.remove('flx-tabB', 'flx-chg'); await c.sleep(1300);
      cursor.style.opacity = '0'; await c.sleep(500);
    }
  }
  window.FlinksAnimations.register('fraud-dashboard', 'flx-fraud-dashboard', { setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-fraud-dashboard', ROOT='flx-fraud-dashboard';
  var MARKUP="<div class=\"flx-fraud-dashboard\" role=\"img\" aria-label=\"Animation: a fraud analysis dashboard shows a High Risk verdict and risk signals for a bank statement, then switches to another document.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage\" data-flx=\"stage\"><div class=\"flx-win\"><div class=\"flx-gb\"><div class=\"flx-in2\"> <div class=\"flx-bar\"><div class=\"flx-dots\"><i></i><i></i><i></i></div></div> <div class=\"flx-whd\"><div class=\"flx-wt\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M15 6l-6 6 6 6\"/></svg><span class=\"flx-t1\">May_2026.pdf</span><span class=\"flx-t2\">August_2026.pdf</span></div><div class=\"flx-btn-o\" data-flx=\"mgb\">Manage Documents</div></div> <div class=\"flx-chips\"><span class=\"flx-chip flx-cM\"><i style=\"background:#E5484D\"></i>May_2026.pdf</span><span class=\"flx-chip flx-cJ\"><i style=\"background:#9AA3B5\"></i>June_2026.pdf</span><span class=\"flx-chip flx-cA\"><i style=\"background:#B8C0CE\"></i>August_2026.pdf</span><span class=\"flx-chip flx-cS\"><i style=\"background:#F2994A\"></i>September_2026.pdf</span><span class=\"flx-chip flx-cN\"><i style=\"background:#27AE60\"></i>November_2026.pdf</span></div> <div class=\"flx-wb\"><div class=\"flx-pg\"><div class=\"flx-dp flx-docA\"><span class=\"flx-lg\">BMO</span><div class=\"flx-ad\"><i style=\"width:55%\"></i><i style=\"width:42%\"></i></div> <div><span class=\"flx-hl flx-fg flx-fg1\">103116234 CANADA CORP Test</span></div> <div class=\"flx-sm\"><div><b>Statement Of:</b>Business Account</div><div><b>From:</b>Apr 28 2026</div><div><b>To:</b>May 31 2026</div></div> <div class=\"flx-ts\"><div class=\"flx-tr3 flx-h\"><span>Date</span><span>Description</span><span style=\"justify-self:end\">Debits ($)</span><span style=\"justify-self:end\">Balance ($)</span></div> <div class=\"flx-tr3\"><span>04/28/2026</span><span>BALANCE FORWARD</span><span></span><span class=\"flx-rb flx-fg flx-fg2\" style=\"justify-self:end\">1,863.70</span></div> <div class=\"flx-tr3\"><span>05/01/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">125.00</span><span style=\"justify-self:end\">1,738.70</span></div><div class=\"flx-tr3\"><span>05/01/2026</span><span>SERVICE CHARGE</span><span style=\"justify-self:end\">1.00</span><span style=\"justify-self:end\">1,737.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">100.00</span><span style=\"justify-self:end\">1,637.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">200.00</span><span style=\"justify-self:end\">1,437.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">200.00</span><span style=\"justify-self:end\">1,237.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>SERVICE CHARGE</span><span style=\"justify-self:end\">1.00</span><span style=\"justify-self:end\">1,236.70</span></div></div></div><div class=\"flx-dp flx-docB\"><span class=\"flx-lg\">BMO</span><div class=\"flx-ad\"><i style=\"width:55%\"></i><i style=\"width:42%\"></i></div> <div><span class=\"flx-hl\">John Doe</span></div> <div class=\"flx-sm\"><div><b>Statement Of:</b>Business Account</div><div><b>From:</b>Apr 28 2026</div><div><b>To:</b>May 31 2026</div></div> <div class=\"flx-ts\"><div class=\"flx-tr3 flx-h\"><span>Date</span><span>Description</span><span style=\"justify-self:end\">Debits ($)</span><span style=\"justify-self:end\">Balance ($)</span></div> <div class=\"flx-tr3\"><span>04/28/2026</span><span>BALANCE FORWARD</span><span></span><span class=\"flx-rb\" style=\"justify-self:end\">1,863.70</span></div> <div class=\"flx-tr3\"><span>05/01/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">125.00</span><span style=\"justify-self:end\">1,738.70</span></div><div class=\"flx-tr3\"><span>05/01/2026</span><span>SERVICE CHARGE</span><span style=\"justify-self:end\">1.00</span><span style=\"justify-self:end\">1,737.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">100.00</span><span style=\"justify-self:end\">1,637.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">200.00</span><span style=\"justify-self:end\">1,437.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>DEBIT MEMO</span><span style=\"justify-self:end\">200.00</span><span style=\"justify-self:end\">1,237.70</span></div><div class=\"flx-tr3\"><span>05/03/2026</span><span>SERVICE CHARGE</span><span style=\"justify-self:end\">1.00</span><span style=\"justify-self:end\">1,236.70</span></div></div></div></div><div class=\"flx-ap\"><div class=\"flx-an flx-ap-a\"><div class=\"flx-vrow flx-stg\" style=\"--flx-i:0\"><div><div class=\"flx-vbig\">High Risk</div><div class=\"flx-vlab\">VERDICT ISSUED</div></div><div class=\"flx-dv\"></div><div><div class=\"flx-vbig\">Low</div><div class=\"flx-vlab\">DOCUMENT QUALITY</div></div></div> <div class=\"flx-rh flx-stg\" style=\"--flx-i:1\"><b>Risk Signals</b><a>Hide</a></div><div class=\"flx-sg flx-stg flx-r1\" style=\"--flx-i:2\"><svg class=\"flx-i flx-ch\" viewBox=\"0 0 24 24\" ><path d=\"M6 15l6-6 6 6\"/></svg><span class=\"flx-cnt\">3</span><span>Unreconciled balance</span></div><div class=\"flx-sg flx-stg flx-r2\" style=\"--flx-i:3\"><svg class=\"flx-i flx-ch\" viewBox=\"0 0 24 24\" ><path d=\"M6 9l6 6 6-6\"/></svg><span class=\"flx-cnt\">3</span><span>Account Holder Edit</span></div><div class=\"flx-sg flx-stg\" style=\"--flx-i:4\"><svg class=\"flx-i flx-ch\" viewBox=\"0 0 24 24\" ><path d=\"M6 9l6 6 6-6\"/></svg><span class=\"flx-sp\"></span><span>Content modified</span></div><div class=\"flx-sg flx-stg\" style=\"--flx-i:5\"><svg class=\"flx-i flx-ch\" viewBox=\"0 0 24 24\" ><path d=\"M6 9l6 6 6-6\"/></svg><span class=\"flx-sp\"></span><span>Concealed text update</span></div><div class=\"flx-sg flx-stg\" style=\"--flx-i:6\"><svg class=\"flx-i flx-ch\" viewBox=\"0 0 24 24\" ><path d=\"M6 9l6 6 6-6\"/></svg><span class=\"flx-sp\"></span><span>Anomalous fonts</span></div></div><div class=\"flx-an flx-ap-b\"><div class=\"flx-vrow\"><div><div class=\"flx-vbig flx-nrm\">Normal</div><div class=\"flx-vlab\">VERDICT ISSUED</div></div><div class=\"flx-dv\"></div><div><div class=\"flx-vbig flx-grn\">High</div><div class=\"flx-vlab\">DOCUMENT QUALITY</div></div></div> <div class=\"flx-rh\"><b>Trust Signals</b><a>Hide</a></div> <div class=\"flx-sg\"><svg class=\"flx-gk\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#27AE60\"/><path d=\"M7.5 12.3l3 3 6-6.3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><span>Document has expected metadata</span></div> <div class=\"flx-sg\"><svg class=\"flx-gk\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#27AE60\"/><path d=\"M7.5 12.3l3 3 6-6.3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><span>No modification in document trailer</span></div></div></div></div> <div class=\"flx-tip\">Add new or manage existing documents</div> </div></div></div> <svg class=\"flx-cursor\" data-flx=\"cursor\" viewBox=\"0 0 24 24\"><path d=\"M5 3l14 8-6.2 1.6L9.6 19z\" fill=\"#1B1B3C\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg> </div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-fraud-dashboard { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-fraud-dashboard:not([data-flx-ready]) { visibility: hidden; } .flx-fraud-dashboard *, .flx-fraud-dashboard *::before, .flx-fraud-dashboard *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-fraud-dashboard div, .flx-fraud-dashboard p { display: block; } .flx-fraud-dashboard span, .flx-fraud-dashboard strong, .flx-fraud-dashboard em, .flx-fraud-dashboard b { display: inline; } .flx-fraud-dashboard svg { display: block; max-width: none; max-height: none; } .flx-fraud-dashboard .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-fraud-dashboard .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-fraud-dashboard.is-static *, .flx-fraud-dashboard.is-static *::before { transition: none !important; animation: none !important; } .flx-fraud-dashboard svg.flx-i { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; } .flx-fraud-dashboard .flx-gb { padding:4px; border-radius:24px; background:linear-gradient(160deg,#8FD6F2 0%,#DDF3FB 45%,#A9DFF5 100%); box-shadow:0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06); } .flx-fraud-dashboard .flx-in { border-radius:20px; overflow:hidden; position:relative; } .flx-fraud-dashboard .flx-in.flx-light { background:#fff; } .flx-fraud-dashboard .flx-in.flx-dark { background:#1B1B3C; color:#fff; } .flx-fraud-dashboard .flx-pill { display:inline-flex; align-items:center; background:var(--flx-red,#E5484D); color:#fff; font-weight:600; border-radius:999px; white-space:nowrap; } .flx-fraud-dashboard .flx-badge { width:38px; height:38px; border-radius:50%; background:#E6F6FC; color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-fraud-dashboard .flx-badge svg { width:20px; height:20px; } .flx-fraud-dashboard .flx-shield { width:18px; height:18px; color:var(--flx-accent,#00ACE4); flex:none; } .flx-fraud-dashboard .flx-vp { display:inline-flex; align-items:center; font-size:11px; font-weight:600; padding:3px 10px; border-radius:999px; white-space:nowrap; flex:none; } .flx-fraud-dashboard .flx-hr { background:#E5484D; color:#fff; } .flx-fraud-dashboard .flx-wr { background:#F2994A; color:#fff; } .flx-fraud-dashboard .flx-nm { background:#E8ECF2; color:#4A4F6A; } .flx-fraud-dashboard .flx-tr { background:#27AE60; color:#fff; } .flx-fraud-dashboard .flx-prog { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:var(--flx-muted,#6B7088); white-space:nowrap; flex:none; } .flx-fraud-dashboard .flx-spn { width:14px; height:14px; color:#9AA3B5; } .flx-fraud-dashboard .flx-fr { display:flex; align-items:center; gap:10px; } .flx-fraud-dashboard .flx-fr .flx-nmf { flex:1; font-size:12.5px; font-weight:500; color:var(--flx-text,#1B1B3C); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .flx-fraud-dashboard .flx-fr svg.flx-fi { width:16px; height:16px; color:var(--flx-accent,#00ACE4); flex:none; } .flx-fraud-dashboard .flx-btn-o { background:#fff; border:1px solid #D5DBE5; border-radius:10px; padding:7px 13px; font-size:12.5px; font-weight:500; color:var(--flx-text,#1B1B3C); white-space:nowrap; } .flx-fraud-dashboard .flx-vrow { display:grid; grid-template-columns:1fr 1px 1fr; align-items:center; text-align:center; padding:6px 0 4px; } .flx-fraud-dashboard .flx-vrow .flx-dv { width:1px; height:44px; background:#E8ECF3; } .flx-fraud-dashboard .flx-vbig { font-size:21px; font-weight:600; color:var(--flx-red,#E5484D); letter-spacing:-.01em; } .flx-fraud-dashboard .flx-vlab { font-size:10px; letter-spacing:.06em; color:var(--flx-muted,#6B7088); margin-top:3px; } .flx-fraud-dashboard .flx-rh { display:flex; align-items:center; justify-content:space-between; margin:14px 0 8px; } .flx-fraud-dashboard .flx-rh b { font-size:13.5px; font-weight:600; } .flx-fraud-dashboard .flx-rh a { font-size:12px; color:var(--flx-accent,#00ACE4); font-weight:500; } .flx-fraud-dashboard .flx-sg { display:flex; align-items:center; gap:10px; height:42px; padding:0 12px; background:#F6F8FB; border-radius:10px; margin-bottom:6px; font-size:12.5px; color:var(--flx-text,#1B1B3C); } .flx-fraud-dashboard .flx-sg svg.flx-ch { width:14px; height:14px; color:#8C93A8; flex:none; } .flx-fraud-dashboard .flx-sg .flx-cnt { width:20px; height:20px; border-radius:50%; background:var(--flx-red,#E5484D); color:#fff; font-size:11px; font-weight:700; display:grid; place-items:center; flex:none; } .flx-fraud-dashboard .flx-sg .flx-sp { width:20px; flex:none; } .flx-fraud-dashboard .flx-dots { display:flex; gap:6px; align-items:center; } .flx-fraud-dashboard .flx-dots i { width:9px; height:9px; border-radius:50%; background:#D9DEE7; display:block; } @keyframes flx-fd-rot { to{ transform:rotate(360deg); } } .flx-fraud-dashboard .flx-spn { animation:flx-fd-rot 1.4s linear infinite; } .flx-fraud-dashboard .flx-win { position:absolute; left:60px; top:48px; width:600px; height:560px; } .flx-fraud-dashboard .flx-win .flx-gb, .flx-fraud-dashboard .flx-win .flx-in2 { height:100%; } .flx-fraud-dashboard .flx-in2 { border-radius:20px; overflow:hidden; background:#F7F9FC; position:relative; } .flx-fraud-dashboard .flx-bar { height:34px; display:flex; align-items:center; padding-left:18px; background:#fff; } .flx-fraud-dashboard .flx-whd { height:52px; display:flex; align-items:center; justify-content:space-between; padding:0 18px; background:#fff; border-bottom:1px solid #EDF0F5; } .flx-fraud-dashboard .flx-wt { position:relative; display:flex; align-items:center; gap:8px; font-size:16px; font-weight:600; width:260px; height:24px; } .flx-fraud-dashboard .flx-wt svg { width:18px; height:18px; flex:none; } .flx-fraud-dashboard .flx-wt span { position:absolute; left:26px; top:0; line-height:24px; white-space:nowrap; transition:opacity .35s; } .flx-fraud-dashboard .flx-wt .flx-t2 { opacity:0; } .flx-fraud-dashboard .flx-tabB .flx-wt .flx-t1 { opacity:0; } .flx-fraud-dashboard .flx-tabB .flx-wt .flx-t2 { opacity:1; } .flx-fraud-dashboard .flx-wt svg { position:absolute; left:0; top:3px; } .flx-fraud-dashboard [data-flx=\"mgb\"] { transition:transform .15s, box-shadow .3s; } .flx-fraud-dashboard .flx-mg [data-flx=\"mgb\"] { box-shadow:0 0 0 3px rgba(0,172,228,.25); } .flx-fraud-dashboard .flx-pr { transform:scale(.95) ; } .flx-fraud-dashboard .flx-chips { display:flex; padding:12px 16px 0; } .flx-fraud-dashboard .flx-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border-radius:999px; background:#fff; border:1px solid #E3E8F0; font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; margin-right:7px; max-width:170px; transition:max-width .55s, opacity .4s, padding .55s, margin .55s, border-color .3s, background .3s, transform .15s; } .flx-fraud-dashboard .flx-chip i { width:8px; height:8px; border-radius:50%; display:block; flex:none; } .flx-fraud-dashboard .flx-cM { border-color:var(--flx-accent,#00ACE4); background:#EAF7FD; } .flx-fraud-dashboard .flx-tabB .flx-cM { border-color:#E3E8F0; background:#fff; } .flx-fraud-dashboard .flx-tabB .flx-cA { border-color:var(--flx-accent,#00ACE4); background:#EAF7FD; } .flx-fraud-dashboard .flx-cN { max-width:0; opacity:0; padding:0; border-width:0; margin-right:0; margin-left:-7px; } .flx-fraud-dashboard .flx-chg .flx-cJ { max-width:0; opacity:0; padding:0; border-width:0; margin-right:-7px; } .flx-fraud-dashboard .flx-chg .flx-cN { max-width:170px; opacity:1; padding:0 10px; border-width:1px; margin-left:0; margin-right:7px; } .flx-fraud-dashboard .flx-wb { display:flex; gap:14px; padding:12px 16px; align-items:flex-start; } .flx-fraud-dashboard .flx-pg { position:relative; width:306px; background:#fff; border-radius:12px; box-shadow:0 1px 4px rgba(27,27,60,.07); flex:none; height:440px; overflow:hidden; } .flx-fraud-dashboard .flx-dp { position:absolute; inset:0; padding:16px 14px; transition:opacity .4s; } .flx-fraud-dashboard .flx-docB { opacity:0; } .flx-fraud-dashboard .flx-tabB .flx-docB { opacity:1; } .flx-fraud-dashboard .flx-tabB .flx-docA { opacity:0; } .flx-fraud-dashboard .flx-lg { background:#E6F6FC; color:#00ACE4; font-weight:700; font-size:12px; letter-spacing:.04em; padding:5px 9px; border-radius:6px; display:inline-block; } .flx-fraud-dashboard .flx-ad { margin-top:8px; display:flex; flex-direction:column; gap:4px; } .flx-fraud-dashboard .flx-ad i { display:block; height:5px; background:#E3E8F0; border-radius:3px; } .flx-fraud-dashboard .flx-hl { display:inline-block; margin-top:10px; font-size:10.5px; padding:1px 3px; color:var(--flx-text,#1B1B3C); } .flx-fraud-dashboard .flx-fg { box-shadow:0 0 0 0 rgba(229,72,77,0), 0 0 0 1.5px rgba(229,72,77,0); background:rgba(229,72,77,0); transition:box-shadow .4s, background .4s; } .flx-fraud-dashboard .flx-f1 .flx-fg1, .flx-fraud-dashboard .flx-f2 .flx-fg2 { box-shadow:0 0 0 0 rgba(229,72,77,0), 0 0 0 1.5px #E5484D; background:rgba(229,72,77,.18); } .flx-fraud-dashboard .flx-sm { display:flex; justify-content:space-between; font-size:9.5px; margin-top:12px; color:#3B405C; } .flx-fraud-dashboard .flx-sm b { display:block; font-weight:700; color:var(--flx-text,#1B1B3C); } .flx-fraud-dashboard .flx-ts { margin-top:12px; border-top:1.5px solid #1B1B3C; } .flx-fraud-dashboard .flx-tr3 { display:grid; grid-template-columns:56px 1fr 46px 54px; gap:6px; white-space:nowrap; align-items:center; height:22px; font-size:9.5px; color:#3B405C; border-bottom:1px solid #EEF1F6; } .flx-fraud-dashboard .flx-tr3.flx-h { font-weight:700; color:var(--flx-text,#1B1B3C); } .flx-fraud-dashboard .flx-tr3 .flx-rb { justify-self:end; padding:1px 3px; } .flx-fraud-dashboard .flx-ap { position:relative; flex:1; background:#fff; border-radius:12px; box-shadow:0 1px 4px rgba(27,27,60,.07); height:440px; overflow:hidden; } .flx-fraud-dashboard .flx-an { position:absolute; inset:0; padding:12px 10px; transition:opacity .4s; } .flx-fraud-dashboard .flx-ap-b { opacity:0; } .flx-fraud-dashboard .flx-tabB .flx-ap-b { opacity:1; } .flx-fraud-dashboard .flx-tabB .flx-ap-a { opacity:0; } .flx-fraud-dashboard .flx-an .flx-vbig { font-size:18px; } .flx-fraud-dashboard .flx-an .flx-vlab { letter-spacing:.03em; font-size:9px; white-space:nowrap; } .flx-fraud-dashboard .flx-an .flx-sg { height:38px; font-size:12px; transition:background .3s, box-shadow .3s; } .flx-fraud-dashboard .flx-vbig.flx-nrm { color:#4A4F6A; } .flx-fraud-dashboard .flx-vbig.flx-grn { color:#27AE60; } .flx-fraud-dashboard .flx-sel1 .flx-r1, .flx-fraud-dashboard .flx-sel2 .flx-r2 { background:#E8F6FC; box-shadow:inset 3px 0 0 var(--flx-accent,#00ACE4); } .flx-fraud-dashboard .flx-sg svg.flx-gk { width:18px; height:18px; flex:none; } .flx-fraud-dashboard .flx-tip { position:absolute; right:18px; top:92px; width:196px; background:#1B1B3C; color:#fff; font-size:12.5px; line-height:17px; padding:9px 14px; border-radius:10px; opacity:0; transform:translateY(-4px); transition:opacity .3s, transform .3s; z-index:6; } .flx-fraud-dashboard .flx-tip::before { content:\"\"; position:absolute; right:46px; top:-5px; width:10px; height:10px; background:#1B1B3C; transform:rotate(45deg); border-radius:2px; } .flx-fraud-dashboard .flx-mg .flx-tip { opacity:1; transform:none; } .flx-fraud-dashboard .flx-cursor { position:absolute; left:0; top:0; width:22px; height:22px; z-index:20; opacity:0; pointer-events:none; transition:transform .85s cubic-bezier(.45,0,.2,1), opacity .3s; filter:drop-shadow(0 2px 3px rgba(27,27,60,.3)); } .flx-fraud-dashboard .flx-cursor.is-snap { transition: none; } .flx-fraud-dashboard.is-static .flx-cursor { display: none; }";
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
      this._flx=window.FlinksAnimations['fraud-dashboard'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
