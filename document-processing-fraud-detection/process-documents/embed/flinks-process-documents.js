/*! Flinks process-documents – single-file embed (Shadow DOM web component <flinks-process-documents>) */
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

/* ===== Flinks · Process documents (card 02) — animation logic. Sequence/timings 1:1 with original/a2.html ===== */
(function () {
  var stage;
  function setup(c) { stage = c.q('.flx-stage'); }
  function st(s) { stage.className = 'flx-stage' + (s ? ' flx-' + s : ''); }
  function reset() { st(''); }
  function final() { st('sc2'); }                       // reduced-motion / static frame (as original)
  async function run(c) {
    for (;;) {
      st('');    await c.sleep(800);    // reset: everything faded out
      st('sc1'); await c.sleep(3200);   // 1 · bank statement scanned, fields found
      st('sc2'); await c.sleep(2500);   // 2 · statement moves left, stats card in
      st('sc3'); await c.sleep(2900);   // 3 · void cheque scanned, fields found
      st('sc4'); await c.sleep(2700);   // 4 · cheque moves left, stats card in
    }
  }
  window.FlinksAnimations.register('process-documents', 'flx-process-documents', {
    fonts: [['Flinks Inter', 400, 'inter-latin-400-normal'], ['Flinks Inter', 500, 'inter-latin-500-normal'], ['Flinks Inter', 600, 'inter-latin-600-normal'],
            ['Flinks Inter', 700, 'inter-latin-700-normal'], ['Flinks Inter', 800, 'inter-latin-800-normal']],
    setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-process-documents', ROOT='flx-process-documents';
  var MARKUP="<div class=\"flx-process-documents\" role=\"img\" aria-label=\"Animation: a bank statement and a void cheque are scanned, and the account details found in each are shown in a data card.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage\" data-flx=\"stage\"> <div class=\"flx-grp flx-gs\"> <div class=\"flx-el flx-doc-s\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"><div class=\"flx-content\"> <div class=\"flx-top\"><div class=\"flx-logo\">BMO</div><div class=\"flx-addr\"><i style=\"width:70%\"></i><i style=\"width:52%\"></i><i style=\"width:60%\"></i></div></div> <div class=\"flx-ttl\">Monthly Statement</div> <div class=\"flx-sum\"> <div class=\"flx-fd flx-fd-s\" style=\"--flx-d:1.37s\"><em>Account number</em><b>589349348</b></div><div class=\"flx-fd flx-fd-s\" style=\"--flx-d:1.44s\"><em>Account balance</em><b>$ 49,982.86</b></div> <div class=\"flx-fd flx-fd-s\" style=\"--flx-d:1.66s\"><em>Account type</em><b>Chequing CAD</b></div><div class=\"flx-fd flx-fd-s\" style=\"--flx-d:1.73s\"><em>Account name</em><b>Chequing CAD</b></div></div> <div class=\"flx-r flx-th\"><span>Date</span><span>Description</span><span>Withdrawals</span></div> <div class=\"flx-r flx-fd flx-fd-s\" style=\"--flx-d:2.05s\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-n\">Wire Transfer Fee</span><span class=\"flx-n\">$30.00</span></div><div class=\"flx-r flx-fd flx-fd-s\" style=\"--flx-d:2.2s\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-n\">WIRE TYPE:BOOK OUT DATE:261227 TIME:1338 ET...</span><span class=\"flx-n\">$91,970.30</span></div><div class=\"flx-r flx-fd flx-fd-s\" style=\"--flx-d:2.35s\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-n\">E-transfer payment to Walter Ruiz Conf# walzmhgwg</span><span class=\"flx-n\">$3,500.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:46%\"></span><span class=\"flx-n\">$412.15</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:62%\"></span><span class=\"flx-n\">$86.40</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:38%\"></span><span class=\"flx-n\">$1,250.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:72%\"></span><span class=\"flx-n\">$215.30</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:54%\"></span><span class=\"flx-n\">$64.90</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:66%\"></span><span class=\"flx-n\">$740.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:44%\"></span><span class=\"flx-n\">$412.15</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:58%\"></span><span class=\"flx-n\">$86.40</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:46%\"></span><span class=\"flx-n\">$1,250.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:62%\"></span><span class=\"flx-n\">$215.30</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:38%\"></span><span class=\"flx-n\">$64.90</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:72%\"></span><span class=\"flx-n\">$740.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:54%\"></span><span class=\"flx-n\">$412.15</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:66%\"></span><span class=\"flx-n\">$86.40</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:44%\"></span><span class=\"flx-n\">$1,250.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:58%\"></span><span class=\"flx-n\">$215.30</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:46%\"></span><span class=\"flx-n\">$64.90</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:62%\"></span><span class=\"flx-n\">$740.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:38%\"></span><span class=\"flx-n\">$412.15</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:72%\"></span><span class=\"flx-n\">$86.40</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:54%\"></span><span class=\"flx-n\">$1,250.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:66%\"></span><span class=\"flx-n\">$215.30</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:44%\"></span><span class=\"flx-n\">$64.90</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:58%\"></span><span class=\"flx-n\">$740.00</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:46%\"></span><span class=\"flx-n\">$412.15</span></div><div class=\"flx-r\"><span class=\"flx-n\">2026-12-31</span><span class=\"flx-b\" style=\"width:62%\"></span><span class=\"flx-n\">$86.40</span></div> </div><div class=\"flx-beam\"></div></div></div></div> <div class=\"flx-el flx-data-s\"><div class=\"flx-gb\"><div class=\"flx-in flx-dark\"><div class=\"flx-dh\"><span class=\"flx-fn\">Monthly Statement - Apr 2026.pdf</span><svg class=\"flx-ck\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#27AE60\"/><path d=\"M7.5 12.3l3 3 6-6.3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></div><div class=\"flx-pairs\"><div class=\"flx-pair\" style=\"--flx-i:0\"><div class=\"flx-l\">Account number</div><div class=\"flx-v\">589349348</div></div><div class=\"flx-pair\" style=\"--flx-i:1\"><div class=\"flx-l\">Account type</div><div class=\"flx-v\">Chequing CAD</div></div><div class=\"flx-pair\" style=\"--flx-i:2\"><div class=\"flx-l\">Account balance</div><div class=\"flx-v\">$ 49,982.86</div></div><div class=\"flx-pair\" style=\"--flx-i:3\"><div class=\"flx-l\">Withdrawals</div><div class=\"flx-v\">$30.00</div><div class=\"flx-nt\">Wire Transfer Fee</div></div></div></div></div></div> </div> <div class=\"flx-grp flx-gc\"> <div class=\"flx-el flx-doc-c\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"><div class=\"flx-content flx-cq\"> <div class=\"flx-void\">VOID</div> <div class=\"flx-ctop\"><div class=\"flx-logo flx-fd flx-fd-c\" style=\"--flx-d:.96s\">BMO</div><div class=\"flx-addr\"><i style=\"width:80%\"></i><i style=\"width:56%\"></i><i style=\"width:64%\"></i></div><div class=\"flx-date flx-fd flx-fd-c\" style=\"--flx-d:1.02s\"><span>DATE</span><u></u></div></div> <div class=\"flx-ttl flx-cqt\">Void Cheque</div> <div class=\"flx-pay\"><span>PAY TO THE<br>ORDER OF</span><u></u><em class=\"flx-fd flx-fd-c\" style=\"--flx-d:1.47s\">$</em></div> <div class=\"flx-line2\"><u class=\"flx-memo\"></u><u class=\"flx-sig\"></u></div> <div class=\"flx-micr flx-fd flx-fd-c\" style=\"--flx-d:1.95s\">:00438:  003:  589349348:</div> </div><div class=\"flx-beam\"></div></div></div></div> <div class=\"flx-el flx-data-c\"><div class=\"flx-gb\"><div class=\"flx-in flx-dark\"><div class=\"flx-dh\"><span class=\"flx-fn\">Void Cheque.pdf</span><svg class=\"flx-ck\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#27AE60\"/><path d=\"M7.5 12.3l3 3 6-6.3\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></div><div class=\"flx-pairs\"><div class=\"flx-pair\" style=\"--flx-i:0\"><div class=\"flx-l\">FINANCIAL INSTITUTION</div><div class=\"flx-v\">BMO</div></div><div class=\"flx-pair\" style=\"--flx-i:1\"><div class=\"flx-l\">TRANSIT NUMBER</div><div class=\"flx-v\">00438</div></div><div class=\"flx-pair\" style=\"--flx-i:2\"><div class=\"flx-l\">INSTITUTION NUMBER</div><div class=\"flx-v\">003</div></div><div class=\"flx-pair\" style=\"--flx-i:3\"><div class=\"flx-l\">ACCOUNT NUMBER</div><div class=\"flx-v\">589349348</div></div></div></div></div></div> </div> </div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-process-documents { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-process-documents:not([data-flx-ready]) { visibility: hidden; } .flx-process-documents *, .flx-process-documents *::before, .flx-process-documents *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-process-documents div, .flx-process-documents p { display: block; } .flx-process-documents span, .flx-process-documents strong, .flx-process-documents em, .flx-process-documents b { display: inline; } .flx-process-documents svg { display: block; max-width: none; max-height: none; } .flx-process-documents .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-process-documents .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-process-documents.is-static *, .flx-process-documents.is-static *::before { transition: none !important; animation: none !important; } .flx-process-documents .flx-grp { position:absolute; left:0; top:0; width:720px; height:500px; transform-origin:0 0; pointer-events:none; } .flx-process-documents .flx-gb { padding:4px; border-radius:24px; background:linear-gradient(160deg,#8FD6F2 0%,#DDF3FB 45%,#A9DFF5 100%); box-shadow:0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06); } .flx-process-documents .flx-in { border-radius:20px; overflow:hidden; position:relative; } .flx-process-documents .flx-in.flx-light { background:#fff; height:100%; } .flx-process-documents .flx-in.flx-dark { background:#1B1B3C; color:#fff; padding:22px 26px 24px; height:100%; display:flex; flex-direction:column; } .flx-process-documents .flx-el { position:absolute; opacity:0; transition:opacity .7s, transform .9s cubic-bezier(.4,0,.2,1); } .flx-process-documents .flx-doc-s { left:172px; top:100px; width:376px; height:900px; } .flx-process-documents .flx-doc-c { left:172px; top:126px; width:377px; height:248px; } .flx-process-documents .flx-data-s { left:320px; top:67px; width:313px; height:380px; transform:translateX(50px); } .flx-process-documents .flx-data-c { left:320px; top:67px; width:313px; height:380px; transform:translateX(50px); } .flx-process-documents .flx-doc-s .flx-gb, .flx-process-documents .flx-doc-c .flx-gb, .flx-process-documents .flx-data-s .flx-gb, .flx-process-documents .flx-data-c .flx-gb { height:100%; } .flx-process-documents .flx-sc1 .flx-doc-s { opacity:1; } .flx-process-documents .flx-sc2 .flx-doc-s { opacity:1; transform:translateX(-99px); } .flx-process-documents .flx-sc2 .flx-data-s { opacity:1; transform:none; transition-delay:.55s; } .flx-process-documents .flx-sc3 .flx-doc-c { opacity:1; } .flx-process-documents .flx-sc3 .flx-doc-s { transform:translateX(-99px); } .flx-process-documents .flx-sc3 .flx-data-s { transform:none; } .flx-process-documents .flx-sc4 .flx-doc-c { opacity:1; transform:translateX(-86px); } .flx-process-documents .flx-sc4 .flx-data-c { opacity:1; transform:none; transition-delay:.55s; } .flx-process-documents .flx-content { padding:24px 24px 0; font-size:11px; color:var(--flx-text,#1B1B3C); } .flx-process-documents .flx-top, .flx-process-documents .flx-ctop { display:flex; gap:12px; align-items:center; } .flx-process-documents .flx-logo { background:#E6F6FC; color:#00ACE4; font-weight:700; font-size:15px; letter-spacing:.04em; padding:8px 12px; border-radius:8px; flex:none; } .flx-process-documents .flx-addr { flex:1; display:flex; flex-direction:column; gap:5px; } .flx-process-documents i { display:block; height:6px; background:#E3E8F0; border-radius:3px; } .flx-process-documents .flx-ttl { font-size:22px; font-weight:600; margin:20px 0 14px; letter-spacing:-.01em; } .flx-process-documents .flx-sum { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:18px; } .flx-process-documents .flx-sum div { background:#F4F7FB; border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:3px; } .flx-process-documents .flx-sum em { font-style:normal; font-size:10px; color:var(--flx-muted,#6B7088); } .flx-process-documents .flx-sum b { font-size:14px; font-weight:600; } .flx-process-documents .flx-r { display:grid; grid-template-columns:72px 1fr 74px; gap:10px; align-items:center; height:32px; border-bottom:1px solid #EEF1F6; } .flx-process-documents .flx-r.flx-th { font-weight:700; font-size:10.5px; color:var(--flx-muted,#6B7088); height:28px; } .flx-process-documents .flx-r .flx-b { height:6px; background:#E3E8F0; border-radius:3px; display:block; } .flx-process-documents .flx-r .flx-n { font-size:10.5px; color:#3B405C; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .flx-process-documents .flx-cq { position:relative; height:240px; padding:22px 24px; } .flx-process-documents .flx-cqt { margin:14px 0 0; } .flx-process-documents .flx-ctop .flx-date { display:flex; align-items:flex-end; gap:6px; font-size:10px; font-weight:700; color:var(--flx-muted,#6B7088); } .flx-process-documents .flx-ctop .flx-date u, .flx-process-documents .flx-pay u, .flx-process-documents .flx-line2 u { display:block; border-bottom:1.5px solid #CBD3E0; height:14px; } .flx-process-documents .flx-ctop .flx-date u { width:80px; } .flx-process-documents .flx-pay { display:flex; align-items:flex-end; gap:12px; margin-top:16px; } .flx-process-documents .flx-pay span { font-size:9.5px; font-weight:700; line-height:12px; color:var(--flx-muted,#6B7088); } .flx-process-documents .flx-pay u { flex:1; } .flx-process-documents .flx-pay em { position:relative; font-style:normal; font-weight:700; border:1.5px solid #CBD3E0; border-radius:5px; width:100px; padding:4px 8px; font-size:13px; color:var(--flx-muted,#6B7088); } .flx-process-documents .flx-line2 { display:flex; gap:48px; margin-top:20px; } .flx-process-documents .flx-line2 .flx-memo { width:130px; } .flx-process-documents .flx-line2 .flx-sig { flex:1; } .flx-process-documents .flx-void { position:absolute; right:72px; top:70px; font-size:64px; font-weight:800; letter-spacing:.2em; color:rgba(0,172,228,.10); transform:rotate(-8deg); } .flx-process-documents .flx-micr { position:absolute; left:24px; right:24px; bottom:14px; font-family:'Courier New',monospace; font-weight:700; font-size:16px; letter-spacing:.14em; color:#3B405C; } .flx-process-documents .flx-beam { position:absolute; left:0; right:0; top:-80px; height:80px; opacity:0; background:linear-gradient(180deg,transparent,rgba(0,172,228,.10) 30%,rgba(0,172,228,.34) 50%,rgba(0,172,228,.10) 70%,transparent); pointer-events:none; z-index:3; } .flx-process-documents .flx-beam::after { content:\"\"; position:absolute; left:0; right:0; top:50%; height:2px; margin-top:-1px; background:rgba(0,172,228,.75); box-shadow:0 0 12px rgba(0,172,228,.7); } .flx-process-documents .flx-sc1 .flx-doc-s .flx-beam { animation:flx-pd-sweepS 2.2s linear .5s 1 both; } .flx-process-documents .flx-sc3 .flx-doc-c .flx-beam { animation:flx-pd-sweepC 1.8s linear .5s 1 both; } @keyframes flx-pd-sweepS { 0%{ top:-80px; opacity:1; } 94%{ opacity:1; } 100%{ top:430px; opacity:0; } } @keyframes flx-pd-sweepC { 0%{ top:-80px; opacity:1; } 94%{ opacity:1; } 100%{ top:248px; opacity:0; } } .flx-process-documents .flx-fd { position:relative; } .flx-process-documents .flx-fd::after { content:\"\"; position:absolute; inset:-2px; border-radius:8px; background:rgba(0,172,228,.10); box-shadow:inset 0 0 0 1.5px rgba(0,172,228,.85); opacity:0; pointer-events:none; } .flx-process-documents .flx-sum .flx-fd::after { inset:0; border-radius:10px; } .flx-process-documents .flx-r.flx-fd::after { inset:2px -4px; border-radius:6px; } .flx-process-documents .flx-micr.flx-fd { position:absolute; } .flx-process-documents .flx-micr.flx-fd::after { inset:-6px -8px; border-radius:6px; } .flx-process-documents .flx-date.flx-fd::after { inset:-6px -8px; border-radius:6px; } .flx-process-documents .flx-sc1 .flx-fd-s::after, .flx-process-documents .flx-sc3 .flx-fd-c::after { animation:flx-pd-foundIn .35s var(--flx-d) both; } .flx-process-documents .flx-sc2 .flx-fd-s::after, .flx-process-documents .flx-sc4 .flx-fd-c::after { animation:flx-pd-foundOut .6s .15s both; } @keyframes flx-pd-foundIn { from{ opacity:0; } to{ opacity:1; } } @keyframes flx-pd-foundOut { from{ opacity:1; } to{ opacity:0; } } .flx-process-documents .flx-dh { display:flex; align-items:center; gap:10px; } .flx-process-documents .flx-fn { flex:1; font-size:13px; color:rgba(255,255,255,.75); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .flx-process-documents .flx-ck { width:22px; height:22px; flex:none; opacity:0; transform:scale(.6); transition:opacity .35s, transform .35s; } .flx-process-documents .flx-pairs { flex:1; display:flex; flex-direction:column; justify-content:space-between; margin-top:16px; } .flx-process-documents .flx-pair { padding-top:13px; border-top:1px solid rgba(255,255,255,.12); opacity:0; transform:translateY(8px); transition:opacity .45s, transform .45s; } .flx-process-documents .flx-l { font-size:11.5px; letter-spacing:.02em; color:rgba(255,255,255,.58); } .flx-process-documents .flx-v { font-size:21px; font-weight:600; margin-top:3px; letter-spacing:-.01em; } .flx-process-documents .flx-nt { font-size:12px; color:rgba(255,255,255,.58); margin-top:2px; } .flx-process-documents .flx-sc2 .flx-data-s .flx-pair, .flx-process-documents .flx-sc4 .flx-data-c .flx-pair { opacity:1; transform:none; transition-delay:calc(var(--flx-i) * .16s + 1.0s); } .flx-process-documents .flx-sc2 .flx-data-s .flx-ck, .flx-process-documents .flx-sc4 .flx-data-c .flx-ck { opacity:1; transform:none; transition-delay:1.9s; } .flx-process-documents .flx-both .flx-gs { transform:translate(-21px,84px) scale(.56); } .flx-process-documents .flx-both .flx-gc { transform:translate(346px,84px) scale(.56); }";
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
      this._flx=window.FlinksAnimations['process-documents'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
