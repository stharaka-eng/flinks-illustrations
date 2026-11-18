/*! Flinks account-funding – single-file embed (Shadow DOM web component <flinks-account-funding>) */
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

/* ===== Flinks · Account funding (Cross-Border Payments, card 04) — animation logic. Sequence/timings 1:1 with original-xborder/a4.html ===== */
(function () {
  var stage, canvas, cursor, pl, p1, btn;
  function setup(c) {
    stage = c.q('.flx-stage'); canvas = c.q('.flx-canvas'); cursor = c.q('.flx-cursor'); pl = c.q('.flx-pl'); p1 = c.q('[data-flx="p1"]'); btn = c.q('[data-flx="accept"]');
  }
  function pill(txt, bg, fg) { p1.textContent = txt; p1.style.background = bg; p1.style.color = fg; }
  function pInit() { pill('Initiated', '#E8ECF2', '#4A4F6A'); }
  function pDone() { p1.style.background = ''; p1.style.color = ''; p1.textContent = 'Completed'; }
  function reset() { stage.className = 'flx-stage flx-s1'; pl.classList.remove('flx-out', 'flx-rst'); pInit(); cursor.style.opacity = ''; cursor.style.transform = ''; }
  function final() { reset(); stage.className = 'flx-stage flx-s3'; pDone(); }
  function moveTo(c, el, fx, fy) {
    var cr = canvas.getBoundingClientRect(), k = cr.width / canvas.offsetWidth, b = el.getBoundingClientRect();
    cursor.style.opacity = '1'; cursor.style.transform = 'translate(' + ((b.left - cr.left) / k + b.width * (fx || .5)) + 'px,' + ((b.top - cr.top) / k + b.height * (fy || .5)) + 'px)';
  }
  function press(c, el) { el.classList.add('flx-pr'); return c.sleep(170).then(function () { el.classList.remove('flx-pr'); }); }
  function hideCursor() { cursor.style.opacity = '0'; }
  async function run(c) {
    for (;;) {
      pInit();
      await c.sleep(1500);                                               // 01 · verified account, request ready
      moveTo(c, btn, .5, .5); await c.sleep(1050); await press(c, btn); hideCursor();   // 02 · customer accepts the request
      stage.className = 'flx-stage flx-s3'; await c.sleep(1900);         // 03 · payments list slides in
      pill('In Progress', '#F2994A', '#FFFFFF'); await c.sleep(1500);    // status follows the payment
      pDone(); await c.sleep(2600);
      pl.classList.add('flx-out'); stage.className = 'flx-stage flx-s1'; await c.sleep(1200);   // list slides away, request card returns to centre
      pl.classList.remove('flx-out');
    }
  }
  window.FlinksAnimations.register('account-funding', 'flx-account-funding', { setup: setup, reset: reset, final: final, run: run });
})();


(function(){
  var TAG='flinks-account-funding', ROOT='flx-account-funding';
  var MARKUP="<div class=\"flx-account-funding\" role=\"img\" aria-label=\"Animation: a customer accepts a request for money on a verified account, and the payment status moves from Initiated to In Progress to Completed.\"> <div class=\"flx-scaler\" aria-hidden=\"true\"> <div class=\"flx-stage flx-s1\" data-flx=\"stage\"><div class=\"flx-canvas\" data-flx=\"canvas\"> <div class=\"flx-abs flx-pay\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"> <div class=\"flx-logo\"><svg width=\"66\" height=\"25\" viewBox=\"0 0 66 25\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" style=\"width:66px;height:25px;flex:none\"><g clip-path=\"url(#flx-af-clipFL2)\"><path d=\"M21.5844 12.0309V10.113H23.1662C23.1777 7.52579 24.3328 6.23098 26.6318 6.22852C26.937 6.22998 27.2414 6.26094 27.5407 6.32093V8.10392C27.3746 8.08314 27.2076 8.071 27.0402 8.06756C26.8137 8.04571 26.585 8.07156 26.369 8.14344C26.1531 8.21532 25.9547 8.33167 25.7864 8.48494C25.5316 8.76357 25.4041 9.30637 25.4041 10.1133H27.541V12.0312H25.4035V19.4081H23.1656V12.0312L21.5844 12.0309Z\" fill=\"#1B1B3C\"/><path d=\"M29.7037 19.4077V6.5752H31.9411V19.4077H29.7037Z\" fill=\"#1B1B3C\"/><path d=\"M34.3163 19.4081V10.1133H36.5549V19.4081H34.3163Z\" fill=\"#1B1B3C\"/><path d=\"M34.3163 8.66116V6.53027H36.555V8.66116H34.3163Z\" fill=\"#1B1B3C\"/><path d=\"M39.0701 19.4077V10.9858C40.3923 10.317 41.8532 9.96817 43.335 9.96753C44.6323 9.96753 45.6463 10.3051 46.3771 10.9803C47.108 11.6579 47.4736 12.6037 47.4736 13.8234V19.4074H45.2362V13.633C45.241 13.4233 45.2177 13.2139 45.1672 13.0103C45.1107 12.8199 45.0183 12.6421 44.8947 12.4867C44.7221 12.2819 44.4878 12.1386 44.227 12.0783C43.8382 11.9775 43.4373 11.9316 43.0359 11.9418C42.4558 11.945 41.8773 11.9996 41.3068 12.1048V19.4084L39.0701 19.4077Z\" fill=\"#1B1B3C\"/><path d=\"M49.7084 19.4079V6.62964H51.9472V13.5226L55.0758 10.1128H58.0408L53.993 14.2507L58.4676 19.4076H55.6395L52.565 15.7424L51.9469 16.3716V19.4082L49.7084 19.4079Z\" fill=\"#1B1B3C\"/><path d=\"M59.2382 12.8708C59.2158 12.4589 59.294 12.0477 59.466 11.6727C59.638 11.2977 59.8986 10.9701 60.2253 10.7182C60.9381 10.2003 61.8038 9.936 62.6844 9.96763C63.5746 9.9589 64.4511 10.1879 65.2233 10.6311V12.3334C64.5496 12.0261 63.8158 11.8733 63.0755 11.8862C62.0092 11.8862 61.4753 12.1479 61.4739 12.6713C61.4792 12.8077 61.5255 12.9393 61.6065 13.0492C61.6876 13.159 61.7997 13.242 61.9285 13.2873C62.2839 13.4549 62.6555 13.586 63.0373 13.6787C63.4841 13.7955 63.9207 13.9484 64.3427 14.1358C64.7977 14.3464 65.1824 14.6833 65.4514 15.1063C65.7752 15.6285 65.9353 16.2356 65.911 16.8496C65.9156 17.224 65.8319 17.5943 65.6668 17.9303C65.5016 18.2664 65.2595 18.5588 64.9602 18.7838C64.2373 19.3254 63.348 19.5978 62.4457 19.5538C61.4141 19.5634 60.3981 19.3027 59.4985 18.7977V16.8148C60.2716 17.3478 61.1881 17.6341 62.1272 17.6359C62.7692 17.6359 63.1877 17.5612 63.3823 17.4117C63.4809 17.3314 63.5586 17.2285 63.6091 17.1118C63.6596 16.9951 63.6814 16.868 63.6724 16.7412C63.667 16.5988 63.6209 16.4609 63.5396 16.3439C63.4584 16.2269 63.3454 16.1356 63.2139 16.0808C62.8613 15.895 62.4895 15.7484 62.1051 15.6435C61.6723 15.5175 61.2389 15.3709 60.8046 15.2005C60.3656 15.0246 59.9824 14.7329 59.6958 14.3566C59.3783 13.928 59.2169 13.4038 59.2382 12.8708Z\" fill=\"#1B1B3C\"/><path d=\"M16.0825 11.3205C15.2846 10.3172 14.432 9.35872 13.5285 8.44932C15.33 6.64013 16.8857 5.07024 16.9165 5.03944C17.114 4.83333 17.2224 4.55776 17.2182 4.27234C17.214 3.98692 17.0976 3.71465 16.8941 3.51445C16.6906 3.31425 16.4165 3.20222 16.131 3.20265C15.8456 3.20308 15.5717 3.3159 15.3689 3.5167C15.3381 3.5475 13.8009 5.09705 12.0173 6.88868C11.4715 6.33151 10.9084 5.76356 10.3512 5.20423C11.7092 3.85858 12.9554 2.64046 13.7633 1.85876C13.9678 1.65715 14.084 1.38278 14.0868 1.09564C14.0895 0.808503 13.9786 0.531929 13.778 0.326433C13.5775 0.120938 13.3036 0.0032078 13.0165 -0.0010042C12.7293 -0.00521619 12.4522 0.104426 12.2457 0.30395C12.0979 0.447786 10.6272 1.87229 8.81094 3.671C6.99682 1.87259 5.5255 0.447786 5.37828 0.30395C5.27617 0.204309 5.15552 0.125781 5.02306 0.0727999C4.89059 0.0198186 4.74898 -0.00654618 4.60633 -0.00480156C4.46367 -0.00305693 4.32268 0.0267463 4.19155 0.0829512C4.06042 0.139156 3.94168 0.22064 3.84204 0.322749C3.7424 0.424857 3.66387 0.545579 3.61089 0.678046C3.55791 0.810513 3.53155 0.952119 3.53329 1.09478C3.53503 1.23744 3.56476 1.37839 3.62097 1.50952C3.67717 1.64065 3.75873 1.75942 3.86084 1.85906C4.66811 2.64076 5.91418 3.85858 7.27215 5.20453C6.71528 5.76355 6.15297 6.33122 5.60627 6.88808C3.82172 5.09706 2.28637 3.5475 2.25557 3.517C2.15597 3.41363 2.03674 3.33104 1.90501 3.27397C1.77329 3.21691 1.63167 3.18652 1.48813 3.18457C1.34459 3.18261 1.20208 3.20909 1.06884 3.26254C0.935607 3.31599 0.814207 3.39533 0.711815 3.49595C0.609424 3.59657 0.52801 3.71648 0.472243 3.84877C0.416477 3.98105 0.387518 4.12307 0.386972 4.26662C0.386426 4.41018 0.414326 4.55242 0.469085 4.68512C0.523844 4.81783 0.604327 4.93839 0.70595 5.03978C0.73829 5.07058 2.29276 6.64136 4.09395 8.44962C3.19055 9.35914 2.33786 10.3176 1.53971 11.3208C0.546962 12.6945 0.00896641 14.3445 0.0012207 16.0394C0.00933987 18.3683 0.938182 20.5994 2.58508 22.2461C4.23198 23.8927 6.46326 24.8213 8.79214 24.8291C8.79399 24.8291 8.79524 24.8291 8.79771 24.8291H8.82508C8.82508 24.8291 8.82821 24.8291 8.82944 24.8291C11.1584 24.8213 13.3897 23.8929 15.0367 22.2462C16.6836 20.5995 17.6123 18.3683 17.6204 16.0394C17.6139 14.3443 17.076 12.6939 16.0825 11.3205ZM8.81094 22.6657C7.05103 22.6595 5.36523 21.9567 4.12222 20.7108C2.87921 19.4649 2.18015 17.7774 2.17812 16.0175C2.17844 15.9994 2.17777 15.9813 2.17602 15.9633C2.20233 14.7456 2.59884 13.5648 3.31282 12.5781C4.03822 11.6738 4.81127 10.8089 5.62868 9.98687C6.19786 10.5557 6.75637 11.1147 7.26703 11.6226C7.19825 11.6902 7.13336 11.7533 7.07258 11.8121C4.83127 13.9887 4.7737 15.8207 4.77431 16.0178C4.77573 17.0832 5.19749 18.1049 5.94796 18.8611C6.69843 19.6173 7.71704 20.0468 8.78237 20.0563C8.78822 20.0563 8.79337 20.0563 8.79891 20.0563H8.82643C8.83074 20.0563 8.83654 20.0563 8.84147 20.0563C9.9064 20.0473 10.9248 19.6185 11.6754 18.863C12.426 18.1076 12.8483 17.0864 12.8504 16.0215C12.8504 15.8194 12.7943 13.9887 10.5514 11.8108C10.4913 11.7523 10.4261 11.6876 10.3574 11.6214C10.8681 11.1138 11.4263 10.5548 11.9961 9.98593C12.8131 10.8084 13.5861 11.6733 14.3121 12.5771C15.0245 13.5618 15.4208 14.7399 15.4481 15.955C15.4481 15.9756 15.4481 15.9971 15.4481 16.0166C15.4462 17.7774 14.7465 19.4657 13.5025 20.7119C12.2585 21.9581 10.5718 22.6606 8.81094 22.6657ZM9.03307 13.3641C10.5845 14.8705 10.6729 16.0162 10.6747 16.0166C10.6782 16.5105 10.4854 16.9856 10.1386 17.3374C9.79179 17.6892 9.31934 17.8888 8.82538 17.8923C8.33142 17.8958 7.85642 17.703 7.50465 17.3562C7.15288 17.0094 6.95322 16.537 6.94971 16.0431C6.94971 16.0307 7.0295 14.8806 8.59167 13.3634C8.65912 13.2981 8.73393 13.2249 8.81124 13.1479C8.88947 13.2261 8.96439 13.2994 9.03277 13.365L9.03307 13.3641ZM8.81094 10.0944C8.29196 9.57724 7.72191 9.00743 7.1404 8.42624C7.68187 7.8743 8.24603 7.30448 8.81275 6.73776C9.37823 7.30448 9.94228 7.87399 10.4831 8.42624C9.90163 9.00805 9.33147 9.57814 8.81064 10.0953L8.81094 10.0944Z\" fill=\"#00ACE4\"/></g><defs><clipPath id=\"flx-af-clipFL2\"><rect width=\"65.9156\" height=\"24.83\" fill=\"white\"/></clipPath></defs></svg></div> <h4>Request for Money</h4> <div class=\"flx-sub\">Interac e-Transfer</div> <div class=\"flx-amt\">$200.00</div> <div class=\"flx-ver\"><svg class=\"flx-i\" viewBox=\"0 0 24 24\"><path d=\"M5 12l5 5 9-10\"/></svg>Bank account verified</div> <div class=\"flx-kvs\"><div class=\"flx-kv\"><span>To</span><b>Remittance Provider Wallet</b></div><div class=\"flx-kv\"><span>Method</span><b>Interac e-Transfer</b></div></div> <div class=\"flx-btn\" data-flx=\"accept\">Accept request</div> </div></div></div> <div class=\"flx-abs flx-pl\"><div class=\"flx-gb\"><div class=\"flx-in flx-light\"> <div class=\"flx-ph\">Payments<em>Dashboard</em></div> <div class=\"flx-row\" style=\"--flx-i:0\"><span class=\"flx-ic flx-accent\"><svg class=\"flx-isx\" viewBox=\"0 0 17 17\" width=\"17\" height=\"17\" fill=\"currentColor\" style=\"width:17px;height:17px;display:block\"><path d=\"M12.0309 7.79809C11.8986 7.79809 11.7663 7.74935 11.6618 7.64492C11.4599 7.44301 11.4599 7.10881 11.6618 6.9069L13.8828 4.68589L11.6618 2.46488C11.4599 2.26297 11.4599 1.92878 11.6618 1.72687C11.8637 1.52496 12.1979 1.52496 12.3998 1.72687L14.9899 4.31691C15.0874 4.41438 15.143 4.54665 15.143 4.68589C15.143 4.82514 15.0874 4.95744 14.9899 5.05492L12.3998 7.64492C12.2954 7.74239 12.1632 7.79809 12.0309 7.79809Z\"/><path d=\"M14.6211 5.20818H2.08872C1.80327 5.20818 1.56654 4.97146 1.56654 4.686C1.56654 4.40054 1.80327 4.16382 2.08872 4.16382H14.6211C14.9065 4.16382 15.1432 4.40054 15.1432 4.686C15.1432 4.97146 14.9065 5.20818 14.6211 5.20818Z\"/><path d=\"M4.67872 15.1433C4.54643 15.1433 4.41417 15.0946 4.30973 14.9901L1.7197 12.4001C1.62222 12.3026 1.56654 12.1704 1.56654 12.0311C1.56654 11.8919 1.62222 11.7596 1.7197 11.6621L4.30973 9.07209C4.51164 8.87018 4.84584 8.87018 5.04775 9.07209C5.24966 9.274 5.24966 9.60819 5.04775 9.8101L2.82674 12.0311L5.04775 14.252C5.24966 14.454 5.24966 14.7882 5.04775 14.9901C4.95027 15.0946 4.81797 15.1433 4.67872 15.1433Z\"/><path d=\"M14.6211 12.5458H2.08872C1.80327 12.5458 1.56654 12.3091 1.56654 12.0236C1.56654 11.7382 1.80327 11.5015 2.08872 11.5015H14.6211C14.9065 11.5015 15.1432 11.7382 15.1432 12.0236C15.1432 12.3091 14.9065 12.5458 14.6211 12.5458Z\"/></svg></span><span class=\"flx-nm\"><b>John Doe</b><em>Interac RFM</em></span><span class=\"flx-a\">$200.00</span><span class=\"flx-pill flx-success flx-sm\" data-flx=\"p1\">Completed</span></div> <div class=\"flx-row\" style=\"--flx-i:1\"><span class=\"flx-ic flx-accent\"><svg class=\"flx-isx\" viewBox=\"0 0 17 17\" width=\"17\" height=\"17\" fill=\"currentColor\" style=\"width:17px;height:17px;display:block\"><path d=\"M12.0309 7.79809C11.8986 7.79809 11.7663 7.74935 11.6618 7.64492C11.4599 7.44301 11.4599 7.10881 11.6618 6.9069L13.8828 4.68589L11.6618 2.46488C11.4599 2.26297 11.4599 1.92878 11.6618 1.72687C11.8637 1.52496 12.1979 1.52496 12.3998 1.72687L14.9899 4.31691C15.0874 4.41438 15.143 4.54665 15.143 4.68589C15.143 4.82514 15.0874 4.95744 14.9899 5.05492L12.3998 7.64492C12.2954 7.74239 12.1632 7.79809 12.0309 7.79809Z\"/><path d=\"M14.6211 5.20818H2.08872C1.80327 5.20818 1.56654 4.97146 1.56654 4.686C1.56654 4.40054 1.80327 4.16382 2.08872 4.16382H14.6211C14.9065 4.16382 15.1432 4.40054 15.1432 4.686C15.1432 4.97146 14.9065 5.20818 14.6211 5.20818Z\"/><path d=\"M4.67872 15.1433C4.54643 15.1433 4.41417 15.0946 4.30973 14.9901L1.7197 12.4001C1.62222 12.3026 1.56654 12.1704 1.56654 12.0311C1.56654 11.8919 1.62222 11.7596 1.7197 11.6621L4.30973 9.07209C4.51164 8.87018 4.84584 8.87018 5.04775 9.07209C5.24966 9.274 5.24966 9.60819 5.04775 9.8101L2.82674 12.0311L5.04775 14.252C5.24966 14.454 5.24966 14.7882 5.04775 14.9901C4.95027 15.0946 4.81797 15.1433 4.67872 15.1433Z\"/><path d=\"M14.6211 12.5458H2.08872C1.80327 12.5458 1.56654 12.3091 1.56654 12.0236C1.56654 11.7382 1.80327 11.5015 2.08872 11.5015H14.6211C14.9065 11.5015 15.1432 11.7382 15.1432 12.0236C15.1432 12.3091 14.9065 12.5458 14.6211 12.5458Z\"/></svg></span><span class=\"flx-nm\"><b>Jane Smith</b><em>EFT</em></span><span class=\"flx-a\">$1,500.00</span><span class=\"flx-pill flx-warning flx-sm\">In Progress</span></div> <div class=\"flx-row\" style=\"--flx-i:2\"><span class=\"flx-ic flx-accent\"><svg class=\"flx-isx\" viewBox=\"0 0 17 17\" width=\"17\" height=\"17\" fill=\"currentColor\" style=\"width:17px;height:17px;display:block\"><path d=\"M12.0309 7.79809C11.8986 7.79809 11.7663 7.74935 11.6618 7.64492C11.4599 7.44301 11.4599 7.10881 11.6618 6.9069L13.8828 4.68589L11.6618 2.46488C11.4599 2.26297 11.4599 1.92878 11.6618 1.72687C11.8637 1.52496 12.1979 1.52496 12.3998 1.72687L14.9899 4.31691C15.0874 4.41438 15.143 4.54665 15.143 4.68589C15.143 4.82514 15.0874 4.95744 14.9899 5.05492L12.3998 7.64492C12.2954 7.74239 12.1632 7.79809 12.0309 7.79809Z\"/><path d=\"M14.6211 5.20818H2.08872C1.80327 5.20818 1.56654 4.97146 1.56654 4.686C1.56654 4.40054 1.80327 4.16382 2.08872 4.16382H14.6211C14.9065 4.16382 15.1432 4.40054 15.1432 4.686C15.1432 4.97146 14.9065 5.20818 14.6211 5.20818Z\"/><path d=\"M4.67872 15.1433C4.54643 15.1433 4.41417 15.0946 4.30973 14.9901L1.7197 12.4001C1.62222 12.3026 1.56654 12.1704 1.56654 12.0311C1.56654 11.8919 1.62222 11.7596 1.7197 11.6621L4.30973 9.07209C4.51164 8.87018 4.84584 8.87018 5.04775 9.07209C5.24966 9.274 5.24966 9.60819 5.04775 9.8101L2.82674 12.0311L5.04775 14.252C5.24966 14.454 5.24966 14.7882 5.04775 14.9901C4.95027 15.0946 4.81797 15.1433 4.67872 15.1433Z\"/><path d=\"M14.6211 12.5458H2.08872C1.80327 12.5458 1.56654 12.3091 1.56654 12.0236C1.56654 11.7382 1.80327 11.5015 2.08872 11.5015H14.6211C14.9065 11.5015 15.1432 11.7382 15.1432 12.0236C15.1432 12.3091 14.9065 12.5458 14.6211 12.5458Z\"/></svg></span><span class=\"flx-nm\"><b>Sam Lee</b><em>Interac RFM</em></span><span class=\"flx-a\">$150.00</span><span class=\"flx-pill flx-neutral flx-sm\">Initiated</span></div> </div></div></div> <svg class=\"flx-cursor\" data-flx=\"cursor\" viewBox=\"0 0 24 24\"><path d=\"M5 3l14 8-6.2 1.6L9.6 19z\" fill=\"#1B1B3C\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/></svg> </div></div> </div> </div>";
  var CSS=":host{all:initial;display:block;contain:layout paint style;} .flx-account-funding { all: initial; --flx-s: 1; --flx-tx: 0px; --flx-ty: 0px; display: block; position: relative; box-sizing: border-box; width: var(--flx-width, 100%); max-width: var(--flx-max-width, 720px); height: var(--flx-height, auto); aspect-ratio: 720 / 500; overflow: hidden; contain: layout paint style; color: var(--flx-text, #1B1B3C); font-family: var(--flx-font-family, 'Flinks Inter', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif); line-height: normal; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } .flx-account-funding:not([data-flx-ready]) { visibility: hidden; } .flx-account-funding *, .flx-account-funding *::before, .flx-account-funding *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid transparent; outline: 0; background: none; box-shadow: none; font: inherit; color: inherit; letter-spacing: inherit; word-spacing: normal; text-transform: none; text-shadow: none; text-decoration: none; transition: none; animation: none; } .flx-account-funding div, .flx-account-funding p { display: block; } .flx-account-funding span, .flx-account-funding strong, .flx-account-funding em, .flx-account-funding b { display: inline; } .flx-account-funding b, .flx-account-funding strong { font-weight: 700; } .flx-account-funding em { font-style: italic; } .flx-account-funding svg { display: block; max-width: none; max-height: none; } .flx-account-funding .flx-scaler { position: absolute; left: 0; top: 0; width: 720px; height: 500px; transform-origin: 0 0; transform: translate(var(--flx-tx), var(--flx-ty)) scale(var(--flx-s)); } .flx-account-funding .flx-stage { position: relative; width: 720px; height: 500px; border-radius: 24px; overflow: hidden; color: var(--flx-text, #1B1B3C); background: var(--flx-bg, #EAFAFF); } .flx-account-funding.is-static *, .flx-account-funding.is-static *::before { transition: none !important; animation: none !important; } .flx-account-funding .flx-canvas { position:absolute; left:0; top:0; width:720px; height:500px; transform:scale(1.00000); transform-origin:0 0; } .flx-account-funding svg.flx-i { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; } .flx-account-funding .flx-abs { position:absolute; } .flx-account-funding .flx-gb { padding:var(--flx-gb-w,4px); border-radius:var(--flx-gb-outer,24px); background:var(--flx-gb-gradient,linear-gradient(160deg, #8FD6F2 0%, #DDF3FB 45%, #A9DFF5 100%)); box-shadow:var(--flx-gb-shadow,0 26px 54px -18px rgba(0,172,228,.38), 0 4px 14px rgba(27,27,60,.06)); } .flx-account-funding .flx-in { position:relative; overflow:hidden; border-radius:var(--flx-gb-inner,20px); } .flx-account-funding .flx-in.flx-light { background:var(--flx-white,#FFFFFF); } .flx-account-funding .flx-in.flx-dark { background:var(--flx-text,#1B1B3C); color:#fff; } .flx-account-funding .flx-in.flx-code { background:var(--flx-code-bg,#11132A); color:var(--flx-code-text,#E6E9F5); } .flx-account-funding .flx-badge { width:38px; height:38px; border-radius:50%; background:var(--flx-accent-soft,#E6F6FC); color:var(--flx-accent,#00ACE4); display:grid; place-items:center; flex:none; } .flx-account-funding .flx-badge svg { width:20px; height:20px; } .flx-account-funding .flx-pill { display:inline-flex; align-items:center; font-weight:600; font-size:13px; padding:6px 14px; border-radius:999px; color:#fff; white-space:nowrap; flex:none; } .flx-account-funding .flx-pill.flx-danger { background:var(--flx-danger,#E5484D); } .flx-account-funding .flx-pill.flx-warning { background:var(--flx-warning,#F2994A); } .flx-account-funding .flx-pill.flx-success { background:var(--flx-success,#27AE60); } .flx-account-funding .flx-pill.flx-neutral { background:#E8ECF2; color:#4A4F6A; } .flx-account-funding .flx-pill.flx-sm { font-size:11px; padding:3px 10px; } .flx-account-funding .flx-row { display:flex; align-items:center; gap:14px; height:56px; padding:0 16px; background:var(--flx-surface,#F6F8FB); border-radius:14px; font-size:var(--flx-t-item,15px); font-weight:500; } .flx-account-funding .flx-row.flx-sel { background:#E8F6FC; box-shadow:inset 3px 0 0 var(--flx-accent,#00ACE4); } .flx-account-funding .flx-ic { width:36px; height:36px; border-radius:50%; background:var(--flx-danger-soft,#FDECEC); color:var(--flx-danger,#E5484D); display:grid; place-items:center; flex:none; } .flx-account-funding .flx-ic svg { width:18px; height:18px; } .flx-account-funding .flx-ic.flx-accent { background:var(--flx-accent-soft,#E6F6FC); color:var(--flx-accent,#00ACE4); } .flx-account-funding .flx-btn { display:flex; align-items:center; justify-content:center; height:48px; border-radius:999px; background:var(--flx-accent,#00ACE4); color:#fff; font-size:15.5px; font-weight:600; } .flx-account-funding .flx-btn.flx-off { background:#9ADBF3; } .flx-account-funding .flx-btn-o { display:inline-block; background:#fff; border:1px solid #D5DBE5; border-radius:10px; padding:7px 13px; font-size:12.5px; font-weight:500; color:var(--flx-text,#1B1B3C); white-space:nowrap; } .flx-account-funding .flx-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px; border-radius:999px; background:#fff; border:1px solid var(--flx-hairline,#E3E7EF); font-size:12px; font-weight:500; white-space:nowrap; } .flx-account-funding .flx-chip i { width:8px; height:8px; border-radius:50%; display:block; } .flx-account-funding .flx-chip.flx-sel { border-color:var(--flx-accent,#00ACE4); background:#EAF7FD; } .flx-account-funding .flx-dots { display:flex; gap:6px; align-items:center; } .flx-account-funding .flx-dots i { width:9px; height:9px; border-radius:50%; background:#D9DEE7; display:block; } .flx-account-funding .flx-tip { background:var(--flx-text,#1B1B3C); color:#fff; font-size:12.5px; line-height:17px; padding:9px 14px; border-radius:10px; } .flx-account-funding .flx-num { position:absolute; right:-9px; top:-10px; width:20px; height:20px; border-radius:50%; background:var(--flx-danger,#E5484D); color:#fff; font-size:11px; font-weight:700; display:grid; place-items:center; z-index:2; box-shadow:0 0 0 2px #fff; } .flx-account-funding .flx-flag { position:relative; } .flx-account-funding .flx-flag::after { content:\"\"; position:absolute; inset:-3px -6px; border-radius:9px; background:rgba(229,72,77,.035); box-shadow:inset 0 0 0 2px var(--flx-danger,#E5484D); pointer-events:none; } .flx-account-funding .flx-spn { width:14px; height:14px; color:#9AA3B5; animation:flx-af-cb-rot 1.4s linear infinite; } @keyframes flx-af-cb-rot { to{ transform:rotate(360deg); } } .flx-account-funding .flx-shadow-soft { box-shadow:0 1px 4px rgba(27,27,60,.07); } .flx-account-funding .flx-floating { box-shadow:0 10px 24px -10px rgba(27,27,60,.28), 0 1px 3px rgba(27,27,60,.08); } .flx-account-funding .flx-dz { border:1.5px dashed #B3DDEF; border-radius:18px; background:#F2FAFD; padding:16px 12px; text-align:center; } .flx-account-funding .flx-frow { position:relative; display:flex; align-items:center; gap:12px; height:52px; padding:0 16px; background:#fff; border-radius:16px; box-shadow:0 1px 4px rgba(27,27,60,.07); font-size:15px; font-weight:500; } .flx-account-funding .flx-tb { display:flex; align-items:center; gap:12px; height:38px; padding:0 16px; } .flx-account-funding .flx-tb .flx-dots i { background:#3A3E57; } .flx-account-funding .flx-code { font-family:var(--flx-mono,'Flinks Roboto Mono','Roboto Mono',ui-monospace,Menlo,Consolas,monospace); font-size:12px; line-height:21px; padding:6px 12px 0 8px; color:var(--flx-code-text,#E6E9F5); } .flx-account-funding .flx-code .flx-ln { display:flex; } .flx-account-funding .flx-code .flx-no { width:28px; padding-right:12px; text-align:right; color:var(--flx-code-line,#5B6078); flex:none; user-select:none; } .flx-account-funding .flx-code .flx-tx { white-space:pre; } .flx-account-funding .flx-code .flx-k { color:var(--flx-code-key,#FFFFFF); } .flx-account-funding .flx-code .flx-s { color:var(--flx-code-string,#2DC08E); } .flx-account-funding .flx-code .flx-n { color:var(--flx-code-number,#6DD5F5); } .flx-account-funding .flx-code .flx-m { color:var(--flx-accent,#00ACE4); font-weight:500; } .flx-account-funding .flx-status { display:inline-flex; align-items:center; font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; color:#fff; } .flx-account-funding .flx-status.flx-s200 { background:var(--flx-success,#27AE60); } .flx-account-funding .flx-status.flx-s202 { background:var(--flx-warning,#F2994A); } .flx-account-funding .flx-nt *, .flx-account-funding .flx-rst, .flx-account-funding .flx-rst * { transition:none !important; } .flx-account-funding .flx-out { opacity:1 !important; transition-delay:0s !important; } .flx-account-funding .flx-pay { left:51px; top:64px; width:300px; z-index:1; } .flx-account-funding .flx-pay .flx-in { padding:18px 22px 22px; } .flx-account-funding .flx-pay .flx-logo { display:block; height:25px; line-height:0; } .flx-account-funding .flx-pay .flx-logo svg { display:block; } .flx-account-funding .flx-pay h4 { font-size:17px; line-height:22px; font-weight:600; letter-spacing:-.015em; margin-top:12px; } .flx-account-funding .flx-pay .flx-sub { font-size:12px; color:var(--flx-muted,#6B7088); margin-top:2px; } .flx-account-funding .flx-pay .flx-amt { font-size:34px; line-height:40px; font-weight:600; letter-spacing:-.02em; margin-top:14px; } .flx-account-funding .flx-pay .flx-ver { display:flex; align-items:center; gap:8px; height:38px; padding:0 12px; margin-top:12px; background:#EAF7FD; border-radius:12px; font-size:12.5px; font-weight:500; } .flx-account-funding .flx-pay .flx-ver svg { width:16px; height:16px; color:var(--flx-accent,#00ACE4); flex:none; stroke-width:2.4; } .flx-account-funding .flx-pay .flx-kv { display:flex; justify-content:space-between; font-size:13px; padding:11px 0; border-bottom:1px solid var(--flx-hairline,#E3E7EF); } .flx-account-funding .flx-pay .flx-kv span { color:var(--flx-muted,#6B7088); } .flx-account-funding .flx-pay .flx-kv b { font-weight:600; } .flx-account-funding .flx-pay .flx-kvs { margin-top:8px; } .flx-account-funding .flx-pay .flx-kv:last-child { border-bottom:0; } .flx-account-funding .flx-pay .flx-btn { margin-top:12px; height:46px; } .flx-account-funding .flx-pl { left:332px; top:132px; width:340px; z-index:2; } .flx-account-funding .flx-pl .flx-in { padding:16px 16px 14px; } .flx-account-funding .flx-pl .flx-ph { display:flex; justify-content:space-between; align-items:center; font-size:15px; font-weight:600; margin-bottom:10px; } .flx-account-funding .flx-pl .flx-ph em { font-style:normal; font-weight:500; font-size:11.5px; color:var(--flx-muted,#6B7088); } .flx-account-funding .flx-pl .flx-row { height:52px; padding:0 12px; margin-top:8px; font-size:13.5px; gap:8px; } .flx-account-funding .flx-pl .flx-row .flx-nm { flex:1; min-width:0; white-space:nowrap; } .flx-account-funding .flx-pl .flx-row .flx-ic { width:30px; height:30px; background:#fff; } .flx-account-funding .flx-pl .flx-row b { display:block; font-weight:600; font-size:13.5px; line-height:17px; } .flx-account-funding .flx-pl .flx-row em { display:block; font-style:normal; font-size:11px; color:var(--flx-muted,#6B7088); line-height:14px; font-weight:400; } .flx-account-funding .flx-pl .flx-row .flx-a { font-weight:600; font-size:13.5px; } .flx-account-funding .flx-pay { transition:transform .95s cubic-bezier(.4,0,.2,1); } .flx-account-funding .flx-s1 .flx-pay, .flx-account-funding .flx-s2 .flx-pay { transform:translateX(159px); } .flx-account-funding .flx-pl { transition:transform .95s cubic-bezier(.4,0,.2,1); } .flx-account-funding .flx-s1 .flx-pl, .flx-account-funding .flx-s2 .flx-pl { transform:translateX(400px); } .flx-account-funding .flx-pl.flx-out { transform:translateX(400px) !important; opacity:1 !important; } .flx-account-funding .flx-pl .flx-row, .flx-account-funding .flx-pl .flx-ph { transition:opacity .4s ease, transform .4s ease; transition-delay:0s; } .flx-account-funding .flx-s1 .flx-pl .flx-row, .flx-account-funding .flx-s2 .flx-pl .flx-row { opacity:0; transform:translateX(10px); } .flx-account-funding .flx-s3 .flx-pl .flx-row { transition-delay:calc(var(--flx-i) * .16s + .7s); } .flx-account-funding .flx-pl.flx-out .flx-row { opacity:1 !important; transform:none !important; transition:none !important; } .flx-account-funding .flx-pill { transition:background .35s ease, color .35s ease; } .flx-account-funding .flx-btn { transition:transform .15s ease; } .flx-account-funding .flx-cursor { position:absolute; left:0; top:0; width:22px; height:22px; z-index:30; opacity:0; pointer-events:none; transform:translate(660px,470px); transition:transform .85s cubic-bezier(.45,0,.2,1), opacity .3s; filter:drop-shadow(0 2px 3px rgba(27,27,60,.3)); } .flx-account-funding .flx-pr { transform:scale(.96) !important; }";
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
      this._flx=window.FlinksAnimations['account-funding'].mount(r);
    }
    disconnectedCallback(){ if(this._flx){ this._flx.destroy(); this._flx=null; } }
    play(){ this._flx&&this._flx.play(); }
    pause(){ this._flx&&this._flx.pause(); }
  }
  customElements.define(TAG,FlinksEl);
})();
