/*! Flinks fraud-verdict – single-file embed (Shadow DOM web component <flinks-fraud-verdict>) */
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

/* ===== Flinks · Fraud verdict (card 03) — animation logic. Sequence/timings 1:1 with original/a3.html ===== */
(function () {
  var stage, tk;
  function setup(c) { stage = c.q('.flx-stage'); tk = c.q('.flx-tk'); }
  function setK(n) { stage.style.setProperty('--flx-k', n); }
  function reset() { stage.className = 'flx-stage'; stage.style.removeProperty('--flx-k'); tk.classList.remove('flx-fz'); }
  function final() { stage.className = 'flx-stage flx-s2'; }
  function resetTicker(c) {                  // snap the ticker back without animating (no forced reflow needed)
    tk.classList.add('flx-fz'); setK(0);
    c.raf(function () { c.raf(function () { tk.classList.remove('flx-fz'); }); });
  }
  async function run(c) {
    var first = true;
    for (;;) {
      if (!first) await c.sleep(600);                                  // brief hold on the start frame
      first = false;
      await c.sleep(900); setK(1); await c.sleep(850); setK(2); await c.sleep(850); setK(3); await c.sleep(900);   // In-Progress steps through the 3 checks
      stage.className = 'flx-stage flx-s2'; await c.sleep(5000);       // becomes the verdict card
      resetTicker(c); stage.className = 'flx-stage flx-s1'; await c.sleep(1200);   // returns to the start frame, content reverts (no fade)
    }
  }
  window.FlinksAnimations.register('fraud-verdict', 'flx-fraud-verdict', { setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-fraud-verdict', ROOT='flx-fraud-verdict';
  var MARKUP="<div class=\"flx-fraud-verdict\" role=\"img\" aria-label=\"Animation: a bank statement is checked and flagged High Risk with three signals: fake template match, edited metadata and a balance that does not reconcile.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage\" data-flx=\"stage\"> <div class=\"flx-vcard\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"> <div class=\"flx-hd\"><span class=\"flx-badge\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6M9 17h6\"/></svg></span><span class=\"flx-name\">Monthly Statement - Apr 2026.pdf</span><span class=\"flx-pill\">High Risk</span></div> <div class=\"flx-rows\"> <div class=\"flx-rw flx-proc\"><div class=\"flx-row\"><svg class=\"flx-spin\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8.5\" stroke-dasharray=\"0.1 4.4\"/></svg> <div class=\"flx-tkw\"><div class=\"flx-tk\"><span>In-Progress</span><span>Fake template match</span><span>Edited metadata</span><span>Balance doesn’t reconcile</span></div></div></div></div> <div class=\"flx-rw flx-r\" style=\"--flx-i:0\"><div class=\"flx-ind\"><span class=\"flx-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><rect x=\"9\" y=\"9\" width=\"11\" height=\"11\" rx=\"2\"/><path d=\"M5 15V6a2 2 0 012-2h9\"/></svg></span>Fake template match</div></div> <div class=\"flx-rw flx-r\" style=\"--flx-i:1\"><div class=\"flx-ind\"><span class=\"flx-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M4 20h4L19 9l-4-4L4 16z\"/><path d=\"M13.5 6.5l4 4\"/></svg></span>Edited metadata</div></div> <div class=\"flx-rw flx-r\" style=\"--flx-i:2\"><div class=\"flx-ind\"><span class=\"flx-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" ><path d=\"M5 9h14M5 15h14M8 20L16 4\"/></svg></span>Balance doesn’t reconcile</div></div> </div> <div class=\"flx-ftw\"><div class=\"flx-ft\"><svg class=\"flx-i flx-shield\" viewBox=\"0 0 24 24\" ><path d=\"M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z\"/><path d=\"M9 12l2 2 4-4\"/></svg>Checked against 300,000+ known counterfeit templates</div></div> </div></div></div> </div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-fraud-verdict { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-fraud-verdict:not([data-flx-ready]) { visibility: hidden; } .flx-fraud-verdict *, .flx-fraud-verdict *::before, .flx-fraud-verdict *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-fraud-verdict div, .flx-fraud-verdict p { display: block; } .flx-fraud-verdict span, .flx-fraud-verdict strong, .flx-fraud-verdict em, .flx-fraud-verdict b { display: inline; } .flx-fraud-verdict svg { display: block; max-width: none; max-height: none; } .flx-fraud-verdict .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-fraud-verdict .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-fraud-verdict.is-static *, .flx-fraud-verdict.is-static *::before { transition: none !important; animation: none !important; } .flx-fraud-verdict svg.flx-i { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; } .flx-fraud-verdict .flx-gb { padding:4px; border-radius:24px; background:linear-gradient(160deg,#8FD6F2 0%,#DDF3FB 45%,#A9DFF5 100%); box-shadow:0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06); } .flx-fraud-verdict .flx-in { border-radius:20px; overflow:hidden; position:relative; } .flx-fraud-verdict .flx-in.flx-light { background:#fff; } .flx-fraud-verdict .flx-in.flx-dark { background:#1B1B3C; color:#fff; } .flx-fraud-verdict .flx-pill { display:inline-flex; align-items:center; background:var(--flx-red,#E5484D); color:#fff; font-weight:600; border-radius:999px; white-space:nowrap; } .flx-fraud-verdict .flx-badge { width:38px; height:38px; border-radius:50%; background:#E6F6FC; color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-fraud-verdict .flx-badge svg { width:20px; height:20px; } .flx-fraud-verdict .flx-shield { width:18px; height:18px; color:var(--flx-accent,#00ACE4); flex:none; } .flx-fraud-verdict .flx-vcard { position:absolute; left:107px; top:156px; width:460px; transform:scale(1.1); transform-origin:0 0; opacity:1; transition:top .9s cubic-bezier(.4,0,.2,1), left .9s cubic-bezier(.4,0,.2,1), opacity .6s; } .flx-fraud-verdict .flx-s2 .flx-vcard, .flx-fraud-verdict .flx-s3 .flx-vcard { top:69.5px; } .flx-fraud-verdict .flx-vcard .flx-gb { padding:3.636px; border-radius:21.82px; } .flx-fraud-verdict .flx-vcard .flx-gb .flx-in { border-radius:18.18px; } .flx-fraud-verdict .flx-vcard .flx-in { padding:22px 24px 22px; } .flx-fraud-verdict .flx-hd { display:flex; align-items:center; gap:12px; margin-bottom:18px; } .flx-fraud-verdict .flx-name { flex:1; font-size:15px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .flx-fraud-verdict .flx-pill { font-size:13px; padding:6px 14px; opacity:0; transform:scale(.85); transition:opacity .4s, transform .4s; } .flx-fraud-verdict .flx-s2 .flx-pill, .flx-fraud-verdict .flx-s3 .flx-pill { opacity:1; transform:none; transition-delay:.7s; } .flx-fraud-verdict .flx-rw { max-height:0; opacity:0; overflow:hidden; padding-bottom:0; transition:max-height .55s cubic-bezier(.4,0,.2,1), opacity .4s, padding .55s; } .flx-fraud-verdict .flx-rw.flx-proc { max-height:64px; opacity:1; padding-bottom:8px; } .flx-fraud-verdict .flx-s2 .flx-rw.flx-proc, .flx-fraud-verdict .flx-s3 .flx-rw.flx-proc { max-height:0; opacity:0; padding-bottom:0; } .flx-fraud-verdict .flx-s2 .flx-rw.flx-r, .flx-fraud-verdict .flx-s3 .flx-rw.flx-r { max-height:64px; opacity:1; padding-bottom:8px; transition-delay:calc(var(--flx-i) * .16s + .25s); } .flx-fraud-verdict .flx-row, .flx-fraud-verdict .flx-ind { display:flex; align-items:center; gap:14px; height:56px; padding:0 16px; background:#F6F8FB; border-radius:14px; font-size:15.5px; font-weight:500; } .flx-fraud-verdict .flx-row { gap:12px; } .flx-fraud-verdict .flx-spin { width:22px; height:22px; flex:none; color:#9AA3B5; animation:flx-fv-rot 1.4s linear infinite; } @keyframes flx-fv-rot { to{ transform:rotate(360deg); } } .flx-fraud-verdict .flx-tkw { height:20px; overflow:hidden; } .flx-fraud-verdict .flx-tk { transition:transform .4s cubic-bezier(.4,0,.2,1); transform:translateY(calc(var(--flx-k,0) * -20px)); } .flx-fraud-verdict .flx-tk span { display:block; height:20px; line-height:20px; font-size:15.5px; font-weight:400; color:var(--flx-muted,#6B7088); } .flx-fraud-verdict .flx-tk span + span { color:var(--flx-text,#1B1B3C); font-weight:500; } .flx-fraud-verdict .flx-ic { width:36px; height:36px; border-radius:50%; background:var(--flx-red-soft,#FDECEC); color:var(--flx-red,#E5484D); display:grid; place-items:center; flex:none; } .flx-fraud-verdict .flx-ic svg { width:18px; height:18px; } .flx-fraud-verdict .flx-ftw { max-height:0; opacity:0; overflow:hidden; transition:max-height .5s, opacity .4s; } .flx-fraud-verdict .flx-s2 .flx-ftw, .flx-fraud-verdict .flx-s3 .flx-ftw { max-height:40px; opacity:1; transition-delay:.95s; } .flx-fraud-verdict .flx-ft { display:flex; align-items:center; gap:10px; padding-top:10px; font-size:12.5px; color:var(--flx-muted,#6B7088); } .flx-fraud-verdict .flx-tk.flx-fz { transition:none ; }";
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
      this._flx=window.FlinksAnimations['fraud-verdict'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
