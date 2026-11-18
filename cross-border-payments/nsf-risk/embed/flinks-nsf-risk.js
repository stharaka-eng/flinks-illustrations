/*! Flinks nsf-risk – single-file embed (Shadow DOM web component <flinks-nsf-risk>) */
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

/* ===== Flinks · NSF risk (Cross-Border Payments, card 03) — animation logic. Sequence/timings 1:1 with original-xborder/a3.html ===== */
(function () {
  var stage, ch, els, VALS = [['vnsf', 3, 0], ['vdays', 21, 0], ['vbal', 182.40, 2]];
  function fmt(v, d) { return (d ? '$' : '') + v.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function setFinal() { VALS.forEach(function (v) { els[v[0]].textContent = fmt(v[1], v[2]); }); }
  function setup(c) {
    stage = c.q('.flx-stage'); ch = c.q('.flx-ch'); els = {};
    VALS.forEach(function (v) { els[v[0]] = c.q('[data-flx="' + v[0] + '"]'); });
    setFinal();
  }
  function reset() { stage.className = 'flx-stage flx-s1'; ch.classList.remove('flx-out', 'flx-rst'); setFinal(); }
  function final() { reset(); stage.className = 'flx-stage flx-s3'; }
  async function count(c, v, delay) {                                    // number counts up over 800ms (ease-out cubic), as in the original
    await c.sleep(delay);
    var t0 = performance.now(), dur = 800, el = els[v[0]];
    return new Promise(function (res) {
      (function tick(now) {
        var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(v[1] * e, v[2]);
        if (p < 1) c.raf(tick); else { el.textContent = fmt(v[1], v[2]); res(); }
      })(t0);
    });
  }
  async function run(c) {
    for (;;) {
      await c.sleep(1600);                                               // 01 · credit risk card, results not in yet
      stage.className = 'flx-stage flx-s2';
      await Promise.all([count(c, VALS[0], 0), count(c, VALS[1], 350), count(c, VALS[2], 700)]); await c.sleep(600);   // 02 · NSFs, negative days, available balance
      stage.className = 'flx-stage flx-s3'; await c.sleep(4300);         // 03 · High Risk verdict + 12-month chart slides up
      ch.classList.add('flx-out'); stage.className = 'flx-stage flx-s1'; await c.sleep(1200);   // chart slides away, card reverts
      ch.classList.remove('flx-out');
    }
  }
  window.FlinksAnimations.register('nsf-risk', 'flx-nsf-risk', { setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-nsf-risk', ROOT='flx-nsf-risk';
  var MARKUP="<div class=\"flx-nsf-risk\" role=\"img\" aria-label=\"Animation: a credit risk card counts NSFs, negative-balance days and available balance, then shows a High Risk verdict with a 12-month chart.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage flx-s1\" data-flx=\"stage\"><div class=\"flx-canvas\" data-flx=\"canvas\"> <div class=\"flx-abs flx-vr\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"> <div class=\"flx-hd\"><span class=\"flx-badge\"><svg class=\"flx-isx\" viewBox=\"8.645 8.645 20.71 20.71\" width=\"20.71\" height=\"20.71\" fill=\"currentColor\" style=\"width:20.71px;height:20.71px;display:block\"><path d=\"M18.9998 28.2771C18.7927 28.2771 18.5857 28.2512 18.3872 28.1908C13.9086 26.9569 10.6641 22.7717 10.6641 18.2328V14.4445C10.6641 13.4781 11.363 12.434 12.2605 12.0629L17.0669 10.0955C18.3182 9.58634 19.6901 9.58634 20.9327 10.0955L25.7392 12.0629C26.6366 12.434 27.3357 13.4781 27.3357 14.4445V18.2328C27.3357 22.7631 24.0824 26.9482 19.6125 28.1908C19.414 28.2512 19.2069 28.2771 18.9998 28.2771ZM18.9998 11.0188C18.5079 11.0188 18.0247 11.1137 17.5587 11.3036L12.7523 13.271C12.3381 13.4436 11.9584 14.0045 11.9584 14.4532V18.2414C11.9584 22.2022 14.8061 25.861 18.7323 26.9482C18.9049 27 19.0947 27 19.2673 26.9482C23.1936 25.861 26.0413 22.2022 26.0413 18.2414V14.4532C26.0413 14.0045 25.6615 13.4436 25.2473 13.271L20.441 11.3036C19.975 11.1137 19.4917 11.0188 18.9998 11.0188Z\"/></svg></span><div class=\"flx-t\"><b>Credit Risk</b><em>Last 12 months</em></div><span class=\"flx-pill flx-danger\">High Risk</span></div> <div class=\"flx-row\"><span class=\"flx-ic\"><svg class=\"flx-isx\" viewBox=\"9.645 9.645 16.71 16.71\" width=\"16.71\" height=\"16.71\" fill=\"currentColor\" style=\"width:16.71px;height:16.71px;display:block\"><path d=\"M18 19.9147C17.7145 19.9147 17.4778 19.678 17.4778 19.3925V15.9113C17.4778 15.6259 17.7145 15.3892 18 15.3892C18.2855 15.3892 18.5222 15.6259 18.5222 15.9113V19.3925C18.5222 19.678 18.2855 19.9147 18 19.9147Z\"/><path d=\"M18 22.1777C17.9582 22.1777 17.9095 22.1707 17.8607 22.1637C17.819 22.1568 17.7772 22.1429 17.7354 22.122C17.6936 22.108 17.6519 22.0872 17.6101 22.0593C17.5753 22.0315 17.5405 22.0036 17.5057 21.9758C17.3803 21.8435 17.3037 21.6625 17.3037 21.4814C17.3037 21.3004 17.3803 21.1194 17.5057 20.9871C17.5405 20.9592 17.5753 20.9314 17.6101 20.9035C17.6519 20.8757 17.6936 20.8548 17.7354 20.8409C17.7772 20.82 17.819 20.8061 17.8607 20.7991C17.9512 20.7782 18.0487 20.7782 18.1323 20.7991C18.181 20.8061 18.2228 20.82 18.2646 20.8409C18.3063 20.8548 18.3481 20.8757 18.3899 20.9035C18.4247 20.9314 18.4595 20.9592 18.4943 20.9871C18.6196 21.1194 18.6962 21.3004 18.6962 21.4814C18.6962 21.6625 18.6196 21.8435 18.4943 21.9758C18.4595 22.0036 18.4247 22.0315 18.3899 22.0593C18.3481 22.0872 18.3063 22.108 18.2646 22.122C18.2228 22.1429 18.181 22.1568 18.1323 22.1637C18.0905 22.1707 18.0418 22.1777 18 22.1777Z\"/><path d=\"M22.2192 25.0736H13.7808C12.4231 25.0736 11.3857 24.5793 10.8565 23.6881C10.3344 22.7969 10.404 21.6481 11.0654 20.4575L15.2846 12.8685C15.9809 11.6153 16.9417 10.926 18 10.926C19.0583 10.926 20.0191 11.6153 20.7153 12.8685L24.9345 20.4645C25.596 21.6551 25.6726 22.7969 25.1434 23.6951C24.6143 24.5793 23.5769 25.0736 22.2192 25.0736ZM18 11.9704C17.3455 11.9704 16.705 12.4717 16.1967 13.3768L11.9845 20.9728C11.511 21.8222 11.4344 22.602 11.7617 23.1659C12.0889 23.7299 12.813 24.0362 13.7877 24.0362H22.2262C23.2009 24.0362 23.918 23.7299 24.2522 23.1659C24.5864 22.602 24.5029 21.8291 24.0294 20.9728L19.8033 13.3768C19.295 12.4717 18.6545 11.9704 18 11.9704Z\"/></svg></span>NSFs<span class=\"flx-v flx-bad\" data-flx=\"vnsf\">3</span></div> <div class=\"flx-row\"><span class=\"flx-ic\"><svg class=\"flx-isx\" viewBox=\"9.645 9.645 16.71 16.71\" width=\"16.71\" height=\"16.71\" fill=\"currentColor\" style=\"width:16.71px;height:16.71px;display:block\"><path d=\"M15.215 13.6485C14.9296 13.6485 14.6928 13.4117 14.6928 13.1263V11.0376C14.6928 10.7521 14.9296 10.5154 15.215 10.5154C15.5005 10.5154 15.7372 10.7521 15.7372 11.0376V13.1263C15.7372 13.4117 15.5005 13.6485 15.215 13.6485Z\"/><path d=\"M20.7849 13.6485C20.4995 13.6485 20.2628 13.4117 20.2628 13.1263V11.0376C20.2628 10.7521 20.4995 10.5154 20.7849 10.5154C21.0704 10.5154 21.3071 10.7521 21.3071 11.0376V13.1263C21.3071 13.4117 21.0704 13.6485 20.7849 13.6485Z\"/><path d=\"M15.5632 19.7407C15.4726 19.7407 15.3821 19.7198 15.2986 19.685C15.2081 19.6502 15.1384 19.6014 15.0688 19.5388C14.9435 19.4065 14.8669 19.2324 14.8669 19.0444C14.8669 18.9539 14.8878 18.8634 14.9226 18.7799C14.9574 18.6963 15.0062 18.6197 15.0688 18.5501C15.1384 18.4874 15.2081 18.4387 15.2986 18.4039C15.5492 18.2994 15.8625 18.3551 16.0575 18.5501C16.1828 18.6824 16.2594 18.8634 16.2594 19.0444C16.2594 19.0862 16.2524 19.1349 16.2455 19.1837C16.2385 19.2254 16.2246 19.2672 16.2037 19.309C16.1898 19.3508 16.1689 19.3925 16.141 19.4343C16.1201 19.4691 16.0853 19.5039 16.0575 19.5388C15.9252 19.6641 15.7442 19.7407 15.5632 19.7407Z\"/><path d=\"M18 19.7411C17.9095 19.7411 17.819 19.7202 17.7354 19.6854C17.6449 19.6506 17.5753 19.6018 17.5057 19.5391C17.3803 19.4069 17.3037 19.2328 17.3037 19.0448C17.3037 18.9543 17.3246 18.8638 17.3594 18.7802C17.3943 18.6967 17.443 18.6202 17.5057 18.5506C17.5753 18.4879 17.6449 18.4391 17.7354 18.4043C17.9861 18.2929 18.2994 18.3556 18.4943 18.5506C18.6196 18.6828 18.6962 18.8638 18.6962 19.0448C18.6962 19.0866 18.6893 19.1354 18.6823 19.1841C18.6753 19.2259 18.6614 19.2677 18.6405 19.3095C18.6266 19.3512 18.6057 19.3929 18.5779 19.4347C18.557 19.4695 18.5222 19.5043 18.4943 19.5391C18.362 19.6645 18.181 19.7411 18 19.7411Z\"/><path d=\"M20.4368 19.7411C20.3463 19.7411 20.2558 19.7202 20.1723 19.6854C20.0818 19.6506 20.0121 19.6018 19.9425 19.5391C19.9147 19.5043 19.8868 19.4695 19.859 19.4347C19.8311 19.3929 19.8102 19.3512 19.7963 19.3095C19.7754 19.2677 19.7615 19.2259 19.7545 19.1841C19.7476 19.1354 19.7406 19.0866 19.7406 19.0448C19.7406 18.8638 19.8172 18.6828 19.9425 18.5506C20.0121 18.4879 20.0818 18.4391 20.1723 18.4043C20.4299 18.2929 20.7362 18.3556 20.9312 18.5506C21.0565 18.6828 21.1331 18.8638 21.1331 19.0448C21.1331 19.0866 21.1261 19.1354 21.1192 19.1841C21.1122 19.2259 21.0983 19.2677 21.0774 19.3095C21.0635 19.3512 21.0426 19.3929 21.0147 19.4347C20.9938 19.4695 20.959 19.5043 20.9312 19.5391C20.7989 19.6645 20.6179 19.7411 20.4368 19.7411Z\"/><path d=\"M15.5632 22.1767C15.4726 22.1767 15.3821 22.1559 15.2986 22.121C15.215 22.0862 15.1384 22.0375 15.0688 21.9748C14.9435 21.8426 14.8669 21.6615 14.8669 21.4805C14.8669 21.39 14.8878 21.2995 14.9226 21.2159C14.9574 21.1254 15.0062 21.0488 15.0688 20.9862C15.3264 20.7286 15.7999 20.7286 16.0575 20.9862C16.1828 21.1185 16.2594 21.2995 16.2594 21.4805C16.2594 21.6615 16.1828 21.8426 16.0575 21.9748C15.9252 22.1002 15.7442 22.1767 15.5632 22.1767Z\"/><path d=\"M18 22.1767C17.819 22.1767 17.6379 22.1002 17.5057 21.9748C17.3803 21.8426 17.3037 21.6615 17.3037 21.4805C17.3037 21.39 17.3246 21.2995 17.3594 21.2159C17.3943 21.1254 17.443 21.0488 17.5057 20.9862C17.7633 20.7286 18.2367 20.7286 18.4943 20.9862C18.557 21.0488 18.6057 21.1254 18.6405 21.2159C18.6753 21.2995 18.6962 21.39 18.6962 21.4805C18.6962 21.6615 18.6196 21.8426 18.4943 21.9748C18.362 22.1002 18.181 22.1767 18 22.1767Z\"/><path d=\"M20.4368 22.178C20.2558 22.178 20.0748 22.1014 19.9425 21.9761C19.8798 21.9134 19.8311 21.8368 19.7963 21.7463C19.7615 21.6628 19.7406 21.5723 19.7406 21.4818C19.7406 21.3913 19.7615 21.3007 19.7963 21.2172C19.8311 21.1267 19.8798 21.0501 19.9425 20.9874C20.1026 20.8273 20.3463 20.7507 20.5691 20.7995C20.6179 20.8064 20.6596 20.8203 20.7014 20.8412C20.7432 20.8551 20.785 20.876 20.8267 20.9039C20.8615 20.9248 20.8964 20.9596 20.9312 20.9874C21.0565 21.1197 21.1331 21.3007 21.1331 21.4818C21.1331 21.6628 21.0565 21.8438 20.9312 21.9761C20.7989 22.1014 20.6179 22.178 20.4368 22.178Z\"/><path d=\"M23.918 16.496H12.0819C11.7965 16.496 11.5598 16.2593 11.5598 15.9738C11.5598 15.6884 11.7965 15.4517 12.0819 15.4517H23.918C24.2035 15.4517 24.4402 15.6884 24.4402 15.9738C24.4402 16.2593 24.2035 16.496 23.918 16.496Z\"/><path d=\"M20.7849 25.4846H15.215C12.6737 25.4846 11.2116 24.0225 11.2116 21.4812V15.5632C11.2116 13.0219 12.6737 11.5598 15.215 11.5598H20.7849C23.3262 11.5598 24.7883 13.0219 24.7883 15.5632V21.4812C24.7883 24.0225 23.3262 25.4846 20.7849 25.4846ZM15.215 12.6042C13.2238 12.6042 12.256 13.572 12.256 15.5632V21.4812C12.256 23.4725 13.2238 24.4403 15.215 24.4403H20.7849C22.7762 24.4403 23.744 23.4725 23.744 21.4812V15.5632C23.744 13.572 22.7762 12.6042 20.7849 12.6042H15.215Z\"/></svg></span>Days with a negative balance<span class=\"flx-v flx-bad\" data-flx=\"vdays\">21</span></div> <div class=\"flx-row\"><span class=\"flx-ic flx-accent\"><svg class=\"flx-isx\" viewBox=\"9.645 9.645 16.71 16.71\" width=\"16.71\" height=\"16.71\" fill=\"currentColor\" style=\"width:16.71px;height:16.71px;display:block\"><path d=\"M18.9747 21.7736H17.2271C16.0853 21.7736 15.1593 20.8128 15.1593 19.6292C15.1593 19.3437 15.396 19.107 15.6815 19.107C15.9669 19.107 16.2036 19.3437 16.2036 19.6292C16.2036 20.2349 16.6631 20.7292 17.2271 20.7292H18.9747C19.4272 20.7292 19.8032 20.3254 19.8032 19.838C19.8032 19.2323 19.5874 19.1139 19.2323 18.9886L16.4264 18C15.8834 17.812 15.1523 17.4082 15.1523 16.1619C15.1523 15.0897 15.9948 14.2263 17.0252 14.2263H18.7728C19.9146 14.2263 20.8406 15.1871 20.8406 16.3707C20.8406 16.6562 20.6039 16.8929 20.3184 16.8929C20.033 16.8929 19.7962 16.6562 19.7962 16.3707C19.7962 15.765 19.3367 15.2707 18.7728 15.2707H17.0252C16.5726 15.2707 16.1967 15.6745 16.1967 16.1619C16.1967 16.7676 16.4125 16.886 16.7676 17.0113L19.5734 18C20.1165 18.1879 20.8476 18.5918 20.8476 19.838C20.8406 20.9033 20.0051 21.7736 18.9747 21.7736Z\"/><path d=\"M18 22.6995C17.7145 22.6995 17.4778 22.4628 17.4778 22.1774V13.8225C17.4778 13.537 17.7145 13.3003 18 13.3003C18.2855 13.3003 18.5222 13.537 18.5222 13.8225V22.1774C18.5222 22.4628 18.2855 22.6995 18 22.6995Z\"/><path d=\"M18 25.4846C13.8713 25.4846 10.5154 22.1287 10.5154 18C10.5154 13.8713 13.8713 10.5154 18 10.5154C22.1287 10.5154 25.4846 13.8713 25.4846 18C25.4846 22.1287 22.1287 25.4846 18 25.4846ZM18 11.5597C14.4492 11.5597 11.5598 14.4491 11.5598 18C11.5598 21.5508 14.4492 24.4402 18 24.4402C21.5508 24.4402 24.4402 21.5508 24.4402 18C24.4402 14.4491 21.5508 11.5597 18 11.5597Z\"/></svg></span>Available balance<span class=\"flx-v\" data-flx=\"vbal\">$182.40</span></div> </div></div></div> <div class=\"flx-abs flx-ch\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"> <div class=\"flx-ct\">Negative balance days<em>Last 12 months</em></div> <div class=\"flx-bars\"><i class=\"\" style=\"height:34px;--flx-i:0\"></i><i class=\"\" style=\"height:50px;--flx-i:1\"></i><i class=\"\" style=\"height:28px;--flx-i:2\"></i><i class=\"\" style=\"height:44px;--flx-i:3\"></i><i class=\"flx-r\" style=\"height:60px;--flx-i:4\"></i><i class=\"\" style=\"height:30px;--flx-i:5\"></i><i class=\"\" style=\"height:22px;--flx-i:6\"></i><i class=\"flx-r\" style=\"height:56px;--flx-i:7\"></i><i class=\"\" style=\"height:40px;--flx-i:8\"></i><i class=\"\" style=\"height:26px;--flx-i:9\"></i><i class=\"flx-r\" style=\"height:48px;--flx-i:10\"></i><i class=\"\" style=\"height:36px;--flx-i:11\"></i></div><div class=\"flx-mo\"><span>J</span><span>F</span><span>M</span><span>A</span><span>M</span><span>J</span><span>J</span><span>A</span><span>S</span><span>O</span><span>N</span><span>D</span></div> <div class=\"flx-lg\"><i></i>Months with an NSF</div> </div></div></div> <svg class=\"flx-cursor\" data-flx=\"cursor\" viewBox=\"0 0 24 24\"><path d=\"M5 3l14 8-6.2 1.6L9.6 19z\" fill=\"#1B1B3C\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg> </div></div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-nsf-risk { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-nsf-risk:not([data-flx-ready]) { visibility: hidden; } .flx-nsf-risk *, .flx-nsf-risk *::before, .flx-nsf-risk *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-nsf-risk div, .flx-nsf-risk p { display: block; } .flx-nsf-risk span, .flx-nsf-risk strong, .flx-nsf-risk em, .flx-nsf-risk b { display: inline; } .flx-nsf-risk b, .flx-nsf-risk strong { font-weight: 700; } .flx-nsf-risk em { font-style: italic; } .flx-nsf-risk svg { display: block; max-width: none; max-height: none; } .flx-nsf-risk .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-nsf-risk .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-nsf-risk.is-static *, .flx-nsf-risk.is-static *::before { transition: none !important; animation: none !important; } .flx-nsf-risk .flx-canvas { position:absolute; left:0; top:0; width:720px; height:500px; transform:scale(1.00000); transform-origin:0 0; } .flx-nsf-risk svg.flx-i { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; } .flx-nsf-risk .flx-abs { position:absolute; } .flx-nsf-risk .flx-gb { padding:var(--flx-gb-w,4px); border-radius:var(--flx-gb-outer,24px); background:var(--flx-gb-gradient,linear-gradient(160deg, #8FD6F2 0%, #DDF3FB 45%, #A9DFF5 100%)); box-shadow:var(--flx-gb-shadow,0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06)); } .flx-nsf-risk .flx-in { position:relative; overflow:hidden; border-radius:var(--flx-gb-inner,20px); } .flx-nsf-risk .flx-in.flx-light { background:var(--flx-white,#FFFFFF); } .flx-nsf-risk .flx-in.flx-dark { background:var(--flx-text,#1B1B3C); color:#fff; } .flx-nsf-risk .flx-in.flx-code { background:var(--flx-code-bg,#11132A); color:var(--flx-code-text,#E6E9F5); } .flx-nsf-risk .flx-badge { width:38px; height:38px; border-radius:50%; background:var(--flx-accent-soft,#E6F6FC); color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-nsf-risk .flx-badge svg { width:20px; height:20px; } .flx-nsf-risk .flx-pill { display:inline-flex; align-items:center; font-weight:600; font-size:13px; padding:6px 14px; border-radius:999px; color:#fff; white-space:nowrap; flex:none; } .flx-nsf-risk .flx-pill.flx-danger { background:var(--flx-danger,#E5484D); } .flx-nsf-risk .flx-pill.flx-warning { background:var(--flx-warning,#F2994A); } .flx-nsf-risk .flx-pill.flx-success { background:var(--flx-success,#27AE60); } .flx-nsf-risk .flx-pill.flx-neutral { background:#E8ECF2; color:#4A4F6A; } .flx-nsf-risk .flx-pill.flx-sm { font-size:11px; padding:3px 10px; } .flx-nsf-risk .flx-row { display:flex; align-items:center; gap:14px; height:56px; padding:0 16px; background:var(--flx-surface,#F6F8FB); border-radius:14px; font-size:var(--flx-t-item,15px); font-weight:500; } .flx-nsf-risk .flx-row.flx-sel { background:#E8F6FC; box-shadow:inset 3px 0 0 var(--flx-accent,#00ACE4); } .flx-nsf-risk .flx-ic { width:36px; height:36px; border-radius:50%; background:var(--flx-danger-soft,#FDECEC); color:var(--flx-danger,#E5484D); display:grid; place-items:center; flex:none; } .flx-nsf-risk .flx-ic svg { width:18px; height:18px; } .flx-nsf-risk .flx-ic.flx-accent { background:var(--flx-accent-soft,#E6F6FC); color:var(--flx-accent,#00ACE4); } .flx-nsf-risk .flx-btn { display:flex; align-items:center; justify-content:center; height:48px; border-radius:999px; background:var(--flx-accent,#00ACE4); color:#fff; font-size:15.5px; font-weight:600; } .flx-nsf-risk .flx-btn.flx-off { background:#9ADBF3; } .flx-nsf-risk .flx-btn-o { display:inline-block; background:#fff; border:1px solid #D5DBE5; border-radius:10px; padding:7px 13px; font-size:12.5px; font-weight:500; color:var(--flx-text,#1B1B3C); white-space:nowrap; } .flx-nsf-risk .flx-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border-radius:999px; background:#fff; border:1px solid var(--flx-hairline,#E3E7EF); font-size:12px; font-weight:500; white-space:nowrap; } .flx-nsf-risk .flx-chip i { width:8px; height:8px; border-radius:50%; display:block; } .flx-nsf-risk .flx-chip.flx-sel { border-color:var(--flx-accent,#00ACE4); background:#EAF7FD; } .flx-nsf-risk .flx-dots { display:flex; gap:6px; align-items:center; } .flx-nsf-risk .flx-dots i { width:9px; height:9px; border-radius:50%; background:#D9DEE7; display:block; } .flx-nsf-risk .flx-tip { background:var(--flx-text,#1B1B3C); color:#fff; font-size:12.5px; line-height:17px; padding:9px 14px; border-radius:10px; } .flx-nsf-risk .flx-num { position:absolute; right:-9px; top:-10px; width:20px; height:20px; border-radius:50%; background:var(--flx-danger,#E5484D); color:#fff; font-size:11px; font-weight:700; display:grid; place-items:center; z-index:2; box-shadow:0 0 0 2px #fff; } .flx-nsf-risk .flx-flag { position:relative; } .flx-nsf-risk .flx-flag::after { content:\"\"; position:absolute; inset:-3px -6px; border-radius:9px; background:rgba(229,72,77,.035); box-shadow:inset 0 0 0 2px var(--flx-danger,#E5484D); pointer-events:none; } .flx-nsf-risk .flx-spn { width:14px; height:14px; color:#9AA3B5; animation:flx-nr-cb-rot 1.4s linear infinite; } @keyframes flx-nr-cb-rot { to{ transform:rotate(360deg); } } .flx-nsf-risk .flx-shadow-soft { box-shadow:0 1px 4px rgba(27,27,60,.07); } .flx-nsf-risk .flx-floating { box-shadow:0 10px 24px -10px rgba(27,27,60,.28), 0 1px 3px rgba(27,27,60,.08); } .flx-nsf-risk .flx-dz { border:1.5px dashed #B3DDEF; border-radius:18px; background:#F2FAFD; padding:16px 12px; text-align:center; } .flx-nsf-risk .flx-frow { position:relative; display:flex; align-items:center; gap:12px; height:52px; padding:0 16px; background:#fff; border-radius:16px; box-shadow:0 1px 4px rgba(27,27,60,.07); font-size:15px; font-weight:500; } .flx-nsf-risk .flx-tb { display:flex; align-items:center; gap:12px; height:38px; padding:0 16px; } .flx-nsf-risk .flx-tb .flx-dots i { background:#3A3E57; } .flx-nsf-risk .flx-code { font-family:var(--flx-mono,'Flinks Roboto Mono','Roboto Mono',ui-monospace,Menlo,Consolas,monospace); font-size:12px; line-height:21px; padding:6px 12px 0 8px; color:var(--flx-code-text,#E6E9F5); } .flx-nsf-risk .flx-code .flx-ln { display:flex; } .flx-nsf-risk .flx-code .flx-no { width:28px; padding-right:12px; text-align:right; color:var(--flx-code-line,#5B6078); flex:none; user-select:none; } .flx-nsf-risk .flx-code .flx-tx { white-space:pre; } .flx-nsf-risk .flx-code .flx-k { color:var(--flx-code-key,#FFFFFF); } .flx-nsf-risk .flx-code .flx-s { color:var(--flx-code-string,#2DC08E); } .flx-nsf-risk .flx-code .flx-n { color:var(--flx-code-number,#6DD5F5); } .flx-nsf-risk .flx-code .flx-m { color:var(--flx-accent,#00ACE4); font-weight:500; } .flx-nsf-risk .flx-status { display:inline-flex; align-items:center; font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; color:#fff; } .flx-nsf-risk .flx-status.flx-s200 { background:var(--flx-success,#27AE60); } .flx-nsf-risk .flx-status.flx-s202 { background:var(--flx-warning,#F2994A); } .flx-nsf-risk .flx-nt *, .flx-nsf-risk .flx-rst, .flx-nsf-risk .flx-rst * { transition:none !important; } .flx-nsf-risk .flx-out { opacity:1 !important; transition-delay:0s !important; } .flx-nsf-risk .flx-vr { left:54px; top:59px; width:470px; z-index:1; } .flx-nsf-risk .flx-vr .flx-in { padding:20px 22px 20px; } .flx-nsf-risk .flx-vr .flx-hd { display:flex; align-items:center; gap:12px; } .flx-nsf-risk .flx-vr .flx-hd .flx-t { flex:1; } .flx-nsf-risk .flx-vr .flx-hd b { display:block; font-size:17px; font-weight:600; letter-spacing:-.01em; line-height:21px; } .flx-nsf-risk .flx-vr .flx-hd em { display:block; font-style:normal; font-size:12px; color:var(--flx-muted,#6B7088); line-height:16px; } .flx-nsf-risk .flx-vr .flx-row { margin-top:10px; height:54px; } .flx-nsf-risk .flx-vr .flx-hd + .flx-row { margin-top:16px; } .flx-nsf-risk .flx-vr .flx-row span.flx-v { margin-left:auto; font-size:17px; font-weight:600; } .flx-nsf-risk .flx-vr .flx-row span.flx-v.flx-bad { color:var(--flx-danger,#E5484D); } .flx-nsf-risk .flx-ch { left:328px; top:257px; width:336px; z-index:2; } .flx-nsf-risk .flx-ch .flx-in { padding:16px 18px 16px; } .flx-nsf-risk .flx-ch .flx-ct { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; font-weight:600; } .flx-nsf-risk .flx-ch .flx-ct em { font-style:normal; font-weight:500; font-size:11.5px; color:var(--flx-muted,#6B7088); } .flx-nsf-risk .flx-ch .flx-bars { display:flex; align-items:flex-end; gap:7px; height:74px; margin-top:12px; } .flx-nsf-risk .flx-ch .flx-bars i { flex:1; border-radius:5px 5px 3px 3px; background:#CDEBF8; display:block; } .flx-nsf-risk .flx-ch .flx-bars i.flx-r { background:var(--flx-danger,#E5484D); } .flx-nsf-risk .flx-ch .flx-mo { display:flex; gap:7px; margin-top:6px; font-size:9.5px; color:var(--flx-muted,#6B7088); text-align:center; } .flx-nsf-risk .flx-ch .flx-mo span { flex:1; } .flx-nsf-risk .flx-ch .flx-lg { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--flx-muted,#6B7088); margin-top:10px; } .flx-nsf-risk .flx-ch .flx-lg i { width:8px; height:8px; border-radius:50%; background:var(--flx-danger,#E5484D); display:block; } .flx-nsf-risk .flx-vr .flx-row .flx-v { position:relative; transition:color .2s; } .flx-nsf-risk .flx-vr .flx-row .flx-v::after { content:\"\"; position:absolute; left:-2px; right:-2px; top:3px; bottom:3px; border-radius:6px; background:#E3E7EF; opacity:0; transition:opacity .3s; } .flx-nsf-risk .flx-vr { transition:transform .95s cubic-bezier(.4,0,.2,1); } .flx-nsf-risk .flx-s1 .flx-vr, .flx-nsf-risk .flx-s2 .flx-vr { transform:translate(71px,49px); } .flx-nsf-risk .flx-s1 .flx-vr .flx-row .flx-v { color:transparent !important; } .flx-nsf-risk .flx-s1 .flx-vr .flx-row .flx-v::after { opacity:1; } .flx-nsf-risk .flx-vr .flx-pill { transition:opacity .3s ease, transform .35s cubic-bezier(.3,1.5,.5,1); transform-origin:100% 50%; } .flx-nsf-risk .flx-s1 .flx-vr .flx-pill, .flx-nsf-risk .flx-s2 .flx-vr .flx-pill { opacity:0; transform:scale(.7); } .flx-nsf-risk .flx-ch { transition:transform .95s cubic-bezier(.4,0,.2,1); } .flx-nsf-risk .flx-s1 .flx-ch, .flx-nsf-risk .flx-s2 .flx-ch { transform:translateY(300px); } .flx-nsf-risk .flx-ch.flx-out { transform:translateY(300px) !important; opacity:1 !important; } .flx-nsf-risk .flx-ch .flx-bars i { transform-origin:50% 100%; transition:transform .5s cubic-bezier(.3,1.2,.5,1); transition-delay:0s; } .flx-nsf-risk .flx-s1 .flx-ch .flx-bars i, .flx-nsf-risk .flx-s2 .flx-ch .flx-bars i { transform:scaleY(0); } .flx-nsf-risk .flx-s3 .flx-ch .flx-bars i { transition-delay:calc(var(--flx-i) * .06s + .55s); } .flx-nsf-risk .flx-ch.flx-out .flx-bars i { transition:none !important; transform:none !important; } .flx-nsf-risk .flx-ch .flx-mo, .flx-nsf-risk .flx-ch .flx-lg { transition:opacity .4s ease; } .flx-nsf-risk .flx-s1 .flx-ch .flx-mo, .flx-nsf-risk .flx-s2 .flx-ch .flx-mo, .flx-nsf-risk .flx-s1 .flx-ch .flx-lg, .flx-nsf-risk .flx-s2 .flx-ch .flx-lg { opacity:0; } .flx-nsf-risk .flx-s3 .flx-ch .flx-mo, .flx-nsf-risk .flx-s3 .flx-ch .flx-lg { transition-delay:1s; } .flx-nsf-risk .flx-ch.flx-out .flx-mo, .flx-nsf-risk .flx-ch.flx-out .flx-lg { opacity:1 !important; transition:none !important; } .flx-nsf-risk .flx-cursor { position:absolute; left:0; top:0; width:22px; height:22px; z-index:30; opacity:0; pointer-events:none; transform:translate(660px,470px); transition:transform .85s cubic-bezier(.45,0,.2,1), opacity .3s; filter:drop-shadow(0 2px 3px rgba(27,27,60,.3)); } .flx-nsf-risk .flx-pr { transform:scale(.96) !important; }";
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
      this._flx=window.FlinksAnimations['nsf-risk'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
