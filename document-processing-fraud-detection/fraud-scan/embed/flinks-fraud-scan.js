/*! Flinks fraud-scan – single-file embed (Shadow DOM web component <flinks-fraud-scan>) */
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
      fontBase: opts.fontBase || root.getAttribute('data-font-base') || def.fontBase || (SCRIPT_BASE + '../assets/fonts/')
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

/* ===== Flinks · Fraud scan (Document Processing & Fraud Detection, card 02) — animation logic. Sequence/timings 1:1 with original-docfraud/a2.html ===== */
(function () {
  var st, pt;
  function setup(c) { st = c.q('.flx-stage'); pt = c.q('.flx-pt'); }
  function reset() { st.className = 'flx-stage'; pt.textContent = 'Scanning'; }
  function final() { st.className = 'flx-stage flx-r1 flx-r2 flx-r3 flx-done'; pt.textContent = 'High Risk'; }
  async function run(c) {
    for (;;) {
      pt.textContent = 'Scanning'; await c.sleep(1400);
      st.classList.add('flx-r1'); await c.sleep(750); st.classList.add('flx-r2'); await c.sleep(750); st.classList.add('flx-r3'); await c.sleep(800);
      pt.textContent = 'High Risk'; st.classList.add('flx-done'); await c.sleep(4200);
      st.classList.remove('flx-done', 'flx-r3', 'flx-r2', 'flx-r1'); pt.textContent = 'Scanning'; await c.sleep(900);
    }
  }
  window.FlinksAnimations.register('fraud-scan', 'flx-fraud-scan', { setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-fraud-scan', ROOT='flx-fraud-scan';
  var MARKUP="<div class=\"flx-fraud-scan\" role=\"img\" aria-label=\"Animation: a bank statement card shows Scanning, then flags High Risk as three fraud indicators appear one by one: fake template match, edited metadata and a balance that does not reconcile.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage\"> <div class=\"flx-card\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"> <div class=\"flx-hd\"><span class=\"flx-badge\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6M9 17h6\"/></svg></span><span class=\"flx-name\">Monthly Statement - Apr 2026.pdf</span><span class=\"flx-pill\"><i class=\"flx-spn2\"></i><span class=\"flx-pt\">High Risk</span></span></div> <div class=\"flx-rows\"> <div class=\"flx-ind\"><span class=\"flx-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><rect x=\"9\" y=\"9\" width=\"11\" height=\"11\" rx=\"2\"/><path d=\"M5 15V6a2 2 0 012-2h9\"/></svg></span>Fake template match</div> <div class=\"flx-ind\"><span class=\"flx-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M4 20h4L19 9l-4-4L4 16z\"/><path d=\"M13.5 6.5l4 4\"/></svg></span>Edited metadata</div> <div class=\"flx-ind\"><span class=\"flx-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M5 9h14M5 15h14M8 20L16 4\"/></svg></span>Balance doesn’t reconcile</div> </div> <div class=\"flx-ft\"><svg class=\"flx-i flx-shield\" viewBox=\"0 0 24 24\" ><path d=\"M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z\"/><path d=\"M9 12l2 2 4-4\"/></svg>Checked against 300,000+ known counterfeit templates</div> </div></div></div> </div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-fraud-scan { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-fraud-scan:not([data-flx-ready]) { visibility: hidden; } .flx-fraud-scan *, .flx-fraud-scan *::before, .flx-fraud-scan *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-fraud-scan div, .flx-fraud-scan p { display: block; } .flx-fraud-scan span, .flx-fraud-scan strong, .flx-fraud-scan em, .flx-fraud-scan b { display: inline; } .flx-fraud-scan b, .flx-fraud-scan strong { font-weight: 700; } .flx-fraud-scan em { font-style: italic; } .flx-fraud-scan svg { display: block; max-width: none; max-height: none; } .flx-fraud-scan .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-fraud-scan .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-fraud-scan.is-static *, .flx-fraud-scan.is-static *::before { transition: none !important; animation: none !important; } .flx-fraud-scan svg.flx-i { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; } .flx-fraud-scan .flx-gb { padding:4px; border-radius:24px; background:linear-gradient(160deg,#8FD6F2 0%,#DDF3FB 45%,#A9DFF5 100%); box-shadow:0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06); } .flx-fraud-scan .flx-in { border-radius:20px; overflow:hidden; position:relative; } .flx-fraud-scan .flx-in.flx-light { background:#fff; } .flx-fraud-scan .flx-in.flx-dark { background:#1B1B3C; color:#fff; } .flx-fraud-scan .flx-pill { display:inline-flex; align-items:center; background:var(--flx-red,#E5484D); color:#fff; font-weight:600; border-radius:999px; white-space:nowrap; } .flx-fraud-scan .flx-badge { width:38px; height:38px; border-radius:50%; background:#E6F6FC; color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-fraud-scan .flx-badge svg { width:20px; height:20px; } .flx-fraud-scan .flx-shield { width:18px; height:18px; color:var(--flx-accent,#00ACE4); flex:none; } .flx-fraud-scan .flx-card { position:absolute; left:130px; top:88px; width:460px; } .flx-fraud-scan .flx-card .flx-in { padding:22px 24px 22px; } .flx-fraud-scan .flx-hd { display:flex; align-items:center; gap:12px; } .flx-fraud-scan .flx-name { flex:1; font-size:15px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .flx-fraud-scan .flx-pill { font-size:13px; padding:6px 14px; } .flx-fraud-scan .flx-rows { display:flex; flex-direction:column; gap:8px; margin-top:18px; } .flx-fraud-scan .flx-ind { display:flex; align-items:center; gap:14px; height:56px; padding:0 16px; background:#F6F8FB; border-radius:14px; font-size:15.5px; font-weight:500; } .flx-fraud-scan .flx-ic { width:36px; height:36px; border-radius:50%; background:var(--flx-red-soft,#FDECEC); color:var(--flx-red,#E5484D); display:grid; place-items:center; flex:none; } .flx-fraud-scan .flx-ic svg { width:18px; height:18px; } .flx-fraud-scan .flx-ft { display:flex; align-items:center; gap:10px; margin-top:18px; font-size:12.5px; color:var(--flx-muted,#6B7088); } .flx-fraud-scan .flx-stage .flx-ind, .flx-fraud-scan .flx-stage .flx-ft { transition:opacity .5s ease, transform .5s ease; } .flx-fraud-scan .flx-stage .flx-pill { transition:background .35s ease, color .35s ease; } .flx-fraud-scan .flx-stage:not(.flx-r1) .flx-ind:nth-child(1), .flx-fraud-scan .flx-stage:not(.flx-r2) .flx-ind:nth-child(2), .flx-fraud-scan .flx-stage:not(.flx-r3) .flx-ind:nth-child(3) { opacity:0; transform:translateY(12px); } .flx-fraud-scan .flx-stage:not(.flx-done) .flx-pill { background:#E8ECF2 !important; color:#4A4F6A !important; } .flx-fraud-scan .flx-stage:not(.flx-done) .flx-ft { opacity:.45; } .flx-fraud-scan .flx-pill { min-width:var(--flx-pw,0px); justify-content:center; } .flx-fraud-scan .flx-name { white-space:nowrap; } .flx-fraud-scan .flx-spn2 { width:12px;height:12px;border:2px solid #9AA3B5;border-top-color:transparent;border-radius:50%;display:inline-block;margin-right:7px;vertical-align:-2px;animation:flx-fs-cb-rot 1s linear infinite; } .flx-fraud-scan .flx-stage.flx-done .flx-pill { min-width:var(--flx-pw,0px); justify-content:center; } .flx-fraud-scan .flx-name { white-space:nowrap; } .flx-fraud-scan .flx-spn2 { display:none; } @keyframes flx-fs-cb-rot { to{ transform:rotate(360deg);} }";
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
      this._flx=window.FlinksAnimations['fraud-scan'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
