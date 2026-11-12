/*! Flinks upload-documents – single-file embed (Shadow DOM web component <flinks-upload-documents>) */
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

/* ===== Flinks · Upload documents (card 01) — animation logic =====
 * Sequence and timings are 1:1 with the original (see original/a1.html). */
(function () {
  var els;
  function setup(c) {
    els = {
      stage: c.q('.flx-stage'), screen: c.q('.flx-screen'), success: c.q('.flx-view--success'),
      rows: c.qa('.flx-file'), submit: c.q('[data-flx="submit"]'), more: c.q('[data-flx="more"]'),
      pick: c.q('[data-flx="pick"]'), cursor: c.q('.flx-cursor')
    };
    els.fills = els.rows.map(function (r) { return r.querySelector('.flx-bar-fill'); });
  }

  function reset() {
    els.screen.classList.remove('is-done'); els.success.classList.remove('is-play');
    els.rows.forEach(function (r) { r.classList.remove('is-in', 'is-up', 'is-ok'); r.classList.add('is-snap'); });
    els.submit.classList.add('is-off');
    els.cursor.classList.add('is-snap'); els.cursor.style.opacity = '0'; els.cursor.style.transform = 'translate(500px,380px)';
  }
  function final() {                                           // static / reduced-motion frame = original "static" card
    reset();
    els.rows.forEach(function (r) { r.classList.add('is-in', 'is-ok'); });
    els.submit.classList.remove('is-off');
  }

  function moveTo(c, el) {
    var s = c.scale(), a = els.stage.getBoundingClientRect(), b = el.getBoundingClientRect();
    els.cursor.style.transform = 'translate(' + ((b.left - a.left) / s + b.width * .55) + 'px,' + ((b.top - a.top) / s + b.height * .55) + 'px)';
  }
  function click(c, el) { el.classList.add('is-pressed'); return c.sleep(160).then(function () { el.classList.remove('is-pressed'); }); }

  async function run(c) {
    for (;;) {
      reset(); await c.sleep(60);
      els.cursor.classList.remove('is-snap'); await c.sleep(900);
      els.cursor.style.opacity = '1'; moveTo(c, els.pick); await c.sleep(1000); await click(c, els.pick);
      for (var i = 0; i < els.rows.length; i++) {
        var r = els.rows[i];
        r.classList.remove('is-snap'); r.classList.add('is-in'); await c.sleep(260);
        r.classList.add('is-up');
        c.after(850, (function (r) { return function () { r.classList.add('is-ok'); }; })(r));
        await c.sleep(520);
      }
      await c.sleep(700); els.submit.classList.remove('is-off'); moveTo(c, els.submit); await c.sleep(1050); await click(c, els.submit);
      els.screen.classList.add('is-done'); els.success.classList.add('is-play');
      await c.sleep(900); moveTo(c, els.more); await c.sleep(1900); await click(c, els.more);
      els.cursor.style.opacity = '0'; await c.sleep(500);
    }
  }

  window.FlinksAnimations.register('upload-documents', 'flx-upload-documents', { setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-upload-documents', ROOT='flx-upload-documents';
  var MARKUP="<div class=\"flx-upload-documents\" role=\"img\" aria-label=\"Animation: three bank statements and a void cheque are uploaded, then a success confirmation appears.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage\"> <div class=\"flx-frame\"><div class=\"flx-screen\"> <div class=\"flx-view flx-view--upload\"> <p class=\"flx-title\">Upload new document</p> <p class=\"flx-sub\">Upload 3–12 months of bank statements and also include a void cheque if applicable.</p> <div class=\"flx-dz\"> <div class=\"flx-dz-drag\"> <svg class=\"flx-i\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\"><path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6M9 17h6\"/></svg> Drag &amp; drop your file(s) here </div> <span class=\"flx-pill\" data-flx=\"pick\">Upload <svg class=\"flx-i\" viewBox=\"0 0 24 24\" width=\"16\" height=\"16\"><path d=\"M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4\"/><path d=\"M12 15V4\"/><path d=\"M8 8l4-4 4 4\"/></svg> </span> </div> <div class=\"flx-files\"> <div class=\"flx-file\"><span class=\"flx-file-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" width=\"18\" height=\"18\"><path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6M9 17h6\"/></svg></span> <span class=\"flx-file-name\">Monthly Statement - Apr 2026.pdf</span> <svg class=\"flx-i flx-file-act\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\"><path d=\"M20 11a8 8 0 00-14-4.9L4 8\"/><path d=\"M4 3.5V8h4.5\"/><path d=\"M4 13a8 8 0 0014 4.9L20 16\"/><path d=\"M20 20.5V16h-4.5\"/></svg><span class=\"flx-bar\"><span class=\"flx-bar-fill\"></span></span></div> <div class=\"flx-file\"><span class=\"flx-file-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" width=\"18\" height=\"18\"><path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6M9 17h6\"/></svg></span> <span class=\"flx-file-name\">Monthly Statement - Mar 2026.pdf</span> <svg class=\"flx-i flx-file-act\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\"><path d=\"M4 7h16\"/><path d=\"M9 7V4.5h6V7\"/><path d=\"M6 7l1 13h10l1-13\"/><path d=\"M10 11v6M14 11v6\"/></svg><span class=\"flx-bar\"><span class=\"flx-bar-fill\"></span></span></div> <div class=\"flx-file\"><span class=\"flx-file-ic\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\" width=\"18\" height=\"18\"><path d=\"M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M9 13h6M9 17h6\"/></svg></span> <span class=\"flx-file-name\">Void Cheque.pdf</span> <svg class=\"flx-i flx-file-act\" viewBox=\"0 0 24 24\" width=\"20\" height=\"20\"><path d=\"M4 7h16\"/><path d=\"M9 7V4.5h6V7\"/><path d=\"M6 7l1 13h10l1-13\"/><path d=\"M10 11v6M14 11v6\"/></svg><span class=\"flx-bar\"><span class=\"flx-bar-fill\"></span></span></div> </div> <div class=\"flx-btn is-off\" data-flx=\"submit\">Upload Documents</div> </div> <div class=\"flx-view flx-view--success\"> <p class=\"flx-title\">Your document upload was successful</p> <svg class=\"flx-okmark\" viewBox=\"0 0 64 64\" width=\"84\" height=\"84\"><circle cx=\"32\" cy=\"32\" r=\"28\"/><path d=\"M20 33l8.5 8.5L44.5 24\"/></svg> <p class=\"flx-lead\">Once processed, you can manage the documents within the <strong>Document Check</strong> tab.</p> <div class=\"flx-btn\" data-flx=\"more\">Upload more documents</div> </div> </div></div> <svg class=\"flx-cursor\" viewBox=\"0 0 24 24\" width=\"22\" height=\"22\"><path d=\"M5 3l14 8-6.2 1.6L9.6 19z\" fill=\"#1B1B3C\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg> </div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-upload-documents { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-upload-documents:not([data-flx-ready]) { visibility: hidden; } .flx-upload-documents *, .flx-upload-documents *::before, .flx-upload-documents *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-upload-documents div, .flx-upload-documents p { display: block; } .flx-upload-documents span, .flx-upload-documents strong { display: inline; } .flx-upload-documents svg { display: block; max-width: none; max-height: none; } .flx-upload-documents .flx-i { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; } .flx-upload-documents .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-upload-documents .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-upload-documents .flx-frame { position: absolute; left: 156px; top: 35px; width: 440px; height: 680px; padding: 4px; transform: scale(.927); transform-origin: 0 0; border-radius: 25.9px; background: linear-gradient(160deg, #8FD6F2 0%, #DDF3FB 45%, #A9DFF5 100%); box-shadow: 0 30px 70px -18px rgba(0,172,228,.38), 0 6px 18px rgba(0,172,228,.12); } .flx-upload-documents .flx-screen { position: relative; width: 100%; height: 100%; border-radius: 21.6px; overflow: hidden; background: linear-gradient(#fff 0%, #fff 30%, #F4F7FB 100%); } .flx-upload-documents .flx-view { position: absolute; left: 0; right: 0; top: 0; padding: 30px 26px 0; transition: opacity .4s; } .flx-upload-documents .flx-view--success { opacity: 0; pointer-events: none; } .flx-upload-documents .flx-screen.is-done .flx-view--upload { opacity: 0; } .flx-upload-documents .flx-screen.is-done .flx-view--success { opacity: 1; } .flx-upload-documents .flx-title { font-size: 24px; line-height: 30px; font-weight: 600; letter-spacing: -.015em; } .flx-upload-documents .flx-sub { font-size: 13.5px; line-height: 19px; font-weight: 400; color: var(--flx-muted, #6B7088); margin-top: 8px; } .flx-upload-documents .flx-dz { margin-top: 19px; border: 1.5px dashed #B3DDEF; border-radius: 18px; background: #F2FAFD; padding: 16px 12px; text-align: center; } .flx-upload-documents .flx-dz-drag { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14.5px; font-weight: 500; } .flx-upload-documents .flx-dz-drag svg { width: 20px; height: 20px; color: var(--flx-accent, #00ACE4); } .flx-upload-documents .flx-pill { display: inline-flex; align-items: center; gap: 10px; height: 34px; padding: 0 18px; margin-top: 10px; background: #fff; border: 1px solid #DDE4EE; border-radius: 999px; font-size: 13.5px; font-weight: 600; transition: transform .15s; } .flx-upload-documents .flx-pill svg { width: 16px; height: 16px; color: var(--flx-accent, #00ACE4); } .flx-upload-documents .flx-files { margin-top: 20px; } .flx-upload-documents .flx-file { position: relative; display: flex; align-items: center; gap: 12px; height: 0; margin-bottom: 0; padding: 0 16px; opacity: 0; overflow: hidden; background: #fff; border-radius: 16px; box-shadow: 0 1px 4px rgba(27,27,60,.07); transition: height .4s cubic-bezier(.4,0,.2,1), margin .4s, opacity .4s; font-size: 15px; font-weight: 500; } .flx-upload-documents .flx-file.is-in { height: 52px; margin-bottom: 8px; opacity: 1; } .flx-upload-documents .flx-file-ic { width: 34px; height: 34px; border-radius: 50%; background: var(--flx-accent-soft, #E6F6FC); color: var(--flx-accent, #00ACE4); display: grid; place-items: center; flex: none; } .flx-upload-documents .flx-file-ic svg { width: 18px; height: 18px; } .flx-upload-documents .flx-file-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .flx-upload-documents .flx-file-act { width: 20px; height: 20px; color: var(--flx-muted, #6B7088); flex: none; opacity: 0; transition: opacity .3s; } .flx-upload-documents .flx-file.is-ok .flx-file-act { opacity: 1; } .flx-upload-documents .flx-bar { position: absolute; left: 62px; right: 52px; bottom: 6px; height: 2px; background: #E3E7EF; border-radius: 2px; opacity: 0; transition: opacity .3s; overflow: hidden; } .flx-upload-documents .flx-bar-fill { display: block; height: 100%; width: 100%; background: var(--flx-accent, #00ACE4); transform: scaleX(0); transform-origin: 0 50%; } .flx-upload-documents .flx-file.is-up .flx-bar { opacity: 1; } .flx-upload-documents .flx-file.is-up .flx-bar-fill { transform: scaleX(1); transition: transform .75s cubic-bezier(.3,.6,.3,1); } .flx-upload-documents .flx-file.is-ok .flx-bar { opacity: 0; } .flx-upload-documents .flx-file.is-snap .flx-bar-fill { transition: none; } .flx-upload-documents .flx-btn { display: flex; align-items: center; justify-content: center; height: 48px; margin-top: 12px; border-radius: 999px; background: var(--flx-accent, #00ACE4); color: #fff; font-size: 15.5px; font-weight: 600; transition: background .3s, transform .15s; } .flx-upload-documents .flx-btn.is-off { background: var(--flx-accent-dim, #9ADBF3); } .flx-upload-documents .is-pressed { transform: scale(.96); } .flx-upload-documents .flx-okmark { display: block; width: 84px; height: 84px; margin: 34px auto 28px; color: var(--flx-success, #27AE60); } .flx-upload-documents .flx-okmark circle { fill: none; stroke: currentColor; stroke-width: 4; stroke-dasharray: 176; } .flx-upload-documents .flx-okmark path { fill: none; stroke: currentColor; stroke-width: 4.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; } .flx-upload-documents .flx-view--success.is-play .flx-okmark circle { animation: flx-ud-ring .6s .1s cubic-bezier(.4,0,.2,1) both; } .flx-upload-documents .flx-view--success.is-play .flx-okmark path { animation: flx-ud-tick .35s .6s ease-out both; } @keyframes flx-ud-ring { from { stroke-dashoffset: 176; } to { stroke-dashoffset: 0; } } @keyframes flx-ud-tick { from { stroke-dashoffset: 40; } to { stroke-dashoffset: 0; } } .flx-upload-documents .flx-view--success .flx-lead { font-size: 15px; line-height: 22px; font-weight: 400; } .flx-upload-documents .flx-view--success .flx-lead strong { font-weight: 700; } .flx-upload-documents .flx-view--success .flx-btn { margin-top: 22px; } .flx-upload-documents .flx-cursor { position: absolute; left: 0; top: 0; width: 22px; height: 22px; z-index: 5; opacity: 0; pointer-events: none; transition: transform .8s cubic-bezier(.45,0,.2,1), opacity .3s; filter: drop-shadow(0 2px 3px rgba(27,27,60,.3)); } .flx-upload-documents .flx-cursor.is-snap { transition: none; } .flx-upload-documents.is-static *, .flx-upload-documents.is-static *::before { transition: none !important; animation: none !important; } .flx-upload-documents.is-static .flx-cursor { display: none; } @media (prefers-reduced-motion: reduce) { .flx-upload-documents[data-flx-respect-rm] *, .flx-upload-documents[data-flx-respect-rm] *::before { transition: none; animation: none; } .flx-upload-documents[data-flx-respect-rm] .flx-cursor { display: none; } }";
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
      this._flx=window.FlinksAnimations['upload-documents'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
