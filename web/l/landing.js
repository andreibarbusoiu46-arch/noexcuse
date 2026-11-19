/* NoExcuse landing — interactions. No dependencies. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fmt = function (n) { return n.toLocaleString('en-US'); };
  var minus = '−';

  /* Count a number up or down with an ease-out curve. */
  function count(el, from, to, ms, render) {
    if (reduce || ms === 0) { el.textContent = render(to); return; }
    var t0 = performance.now();
    (function step(t) {
      var k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = render(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ── Reveal on scroll: section heads, comparison rows, the final statement ── */
  var revealables = $$('.reveal, .cmp-row:not(.cmp-head), .final');
  if ('IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        // Comparison rows arrive one after another.
        var delay = el.classList.contains('cmp-row') ? Math.max(0, $$('.cmp-row:not(.cmp-head)').indexOf(el)) * 90 : 0;
        setTimeout(function () { el.classList.add('in'); }, reduce ? 0 : delay);
        ro.unobserve(el);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    revealables.forEach(function (el) { ro.observe(el); });
  } else { revealables.forEach(function (el) { el.classList.add('in'); }); }

  /* ── Hero: never stay hidden. The 3D scene normally reveals the copy; if it can't load
     (blocked CDN, no WebGL, old device), show the copy and the still image anyway. ── */
  setTimeout(function () { document.documentElement.classList.add('ready'); }, 2500);

  /* ── Hero: the live clock that the 3D arc also follows ── */
  var nowEl = $('#now'), leftEl = $('#left');
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function tickClock() {
    var d = new Date(), mins = d.getHours() * 60 + d.getMinutes(), rest = 1440 - mins;
    nowEl.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    leftEl.textContent = Math.floor(rest / 60) + 'h ' + pad(rest % 60) + 'm left to close it';
  }
  tickClock();
  setInterval(tickClock, 15000);

  /* ── Scroll-linked details ── */
  var nav = $('#nav'), progress = $('#progress'), sheets = $$('.sheet'), promises = $$('.promise'), fades = $('#fades');
  var ticking = false;
  function onScroll() {
    ticking = false;
    var vh = innerHeight, doc = document.documentElement;
    // Backup for the observer above (e.g. after a jump link): reveal anything already on screen.
    revealables.forEach(function (el) { if (!el.classList.contains('in') && el.getBoundingClientRect().top < vh * 0.88) el.classList.add('in'); });
    var navMid = 44, onLight = false;
    sheets.forEach(function (s) { var r = s.getBoundingClientRect(); if (r.top < navMid && r.bottom > navMid) onLight = true; });
    nav.classList.toggle('on-light', onLight);
    var max = doc.scrollHeight - vh;
    progress.style.setProperty('--read', max > 0 ? (scrollY / max).toFixed(4) : 0);
    promises.forEach(function (p) {
      var r = p.getBoundingClientRect();
      var k = Math.min(1, Math.max(0, (vh * 0.78 - r.top) / (vh * 0.22)));
      p.style.setProperty('--strike', reduce ? (k > 0 ? 1 : 0) : k.toFixed(3));
      p.classList.toggle('struck', k > 0.98);
    });
    if (fades) {
      var fr = fades.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, (vh * 0.7 - fr.top) / (vh * 0.45)));
      fades.style.setProperty('--p', (100 - f * 118).toFixed(1) + '%');
    }
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  /* ── Subtle 3D tilt that follows the pointer (mouse only) ── */
  function tilt(el, max) {
    if (!finePointer || reduce || !el) return;
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--ry', (x * max).toFixed(2) + 'deg');
      el.style.setProperty('--rx', (-y * max).toFixed(2) + 'deg');
    });
    el.addEventListener('pointerleave', function () { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
  }
  tilt($('#demo-phone'), 8);

  /* ── How it works: a simulated commitment, start to finish ── */
  var CAPTIONS = [
    'Choose what you promise to complete, and write what counts as proof.',
    'Set the time and the days. The proof window opens 15 minutes before and closes 15 minutes after.',
    'Real app screens. Inside the window, take each photo in the app: no gallery button, and a capture must be sent within three minutes.',
    'Real app screens. AI checks the photos against the commitment and the server clock, then rules with a one‑line reason.'
  ];
  var demo = { step: 0, habit: 'Morning run — 5 km', cat: 'Fitness', deadline: '08:00', freq: 'Every day', committed: false, shot: 0, timers: [] };
  // Steps 3 and 4 show real app screens from the demo account; the buttons sit over the real controls.
  var views = $$('[data-view]'), stepBtns = $$('.step-btn'), tabBtns = $$('.step-tabs button'), rail = $('#rail');
  function later(ms, fn) { demo.timers.push(setTimeout(fn, reduce ? Math.min(ms, 60) : ms)); }
  function clearTimers() { demo.timers.forEach(clearTimeout); demo.timers = []; }
  function hhmm(min) { min = (min + 1440) % 1440; var h = Math.floor(min / 60), m = min % 60; return pad(h) + ':' + pad(m); }
  function toMin(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function windowText(sep) { var d = toMin(demo.deadline); return hhmm(d - 15) + (sep || ' – ') + hhmm(d + 15); }
  function placeRail(i) {
    if (!rail || !stepBtns.length) return;
    var first = stepBtns[0].getBoundingClientRect(), cur = stepBtns[i].getBoundingClientRect();
    rail.style.height = (cur.top - first.top) + 'px';
  }

  function goTo(i) {
    clearTimers();
    demo.step = i;
    views.forEach(function (v, k) { v.classList.toggle('on', k === i); v.classList.toggle('prev', k < i); v.inert = k !== i; });
    stepBtns.forEach(function (b, k) { if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); b.classList.toggle('done', k < i); });
    tabBtns.forEach(function (b, k) { if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    placeRail(i);
    $('#step-caption').textContent = CAPTIONS[i];
    if (i === 2) resetCamera();
    if (i === 3) runVerification();
  }
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { goTo(+b.getAttribute('data-go')); }); });

  var statusCard = $('#status-card'), commitBtn = $('#commit-btn');
  function sync() {
    $('#win-text').textContent = windowText();
    $('#win-l').textContent = hhmm(toMin(demo.deadline) - 15);
    $('#win-r').textContent = hhmm(toMin(demo.deadline) + 15);
    $('#status-text').textContent = (demo.habit || 'Your commitment') + ', ' + demo.deadline + ', ' + demo.freq.toLowerCase();
  }
  $('#habit-name').addEventListener('input', function (e) { demo.habit = e.target.value.trim(); sync(); });
  $$('[data-chips]').forEach(function (group) {
    var key = group.getAttribute('data-chips');
    $$('.chip', group).forEach(function (c) {
      c.addEventListener('click', function () {
        $$('.chip', group).forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
        demo[key] = c.getAttribute('data-v');
        sync();
      });
    });
  });
  $('#commit-form').addEventListener('submit', function (e) { e.preventDefault(); goTo(1); });
  $('#schedule-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!demo.committed) { demo.committed = true; statusCard.classList.add('show'); commitBtn.textContent = 'Open the camera'; }
    else goTo(2);
  });

  // Step 3 · the real proof flow: photo 1 of 2 → photo 2 of 2 → Review proof → Submit for verification.
  var CAM = [
    { src: 'l/demo/camera-1.webp', alt: 'NoExcuse proof camera for Morning run, 5 km: photo 1 of 2, with a framing guide, the proof hint, the shutter and no gallery button' },
    { src: 'l/demo/camera-2.webp', alt: 'NoExcuse proof camera: photo 2 of 2, the watch or treadmill display with distance and time' },
    { src: 'l/demo/review.webp', alt: 'Review proof: two live photos, strict verification, the evidence checklist and Submit for verification' }
  ];
  var camImg = $('#cam-img'), shutter = $('#shutter'), submitBtn = $('#submit-btn'), flash = $('#flash');
  CAM.forEach(function (c) { var im = new Image(); im.src = c.src; }); // warm the cache so swaps are instant
  function showShot(k) {
    demo.shot = k; camImg.src = CAM[k].src; camImg.alt = CAM[k].alt;
    shutter.hidden = k === 2; submitBtn.hidden = k !== 2;
  }
  function resetCamera() { showShot(0); }
  shutter.addEventListener('click', function () {
    if (flash.animate && !reduce) flash.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 420, easing: 'cubic-bezier(.23,1,.32,1)' });
    showShot(demo.shot + 1);
    (demo.shot === 2 ? submitBtn : shutter).focus({ preventScroll: true });
  });
  submitBtn.addEventListener('click', function () { goTo(3); });

  // Step 4 · the real verification screens: "Checking your proof…", then the ruling.
  var verDone = $('#ver-done'), againBtn = $('#again-btn');
  function runVerification() {
    verDone.classList.remove('show'); againBtn.hidden = true;
    later(2600, function () { verDone.classList.add('show'); againBtn.hidden = false; });
  }
  againBtn.addEventListener('click', function () {
    demo.committed = false; statusCard.classList.remove('show'); commitBtn.textContent = 'Commit'; goTo(0);
  });

  sync();
  goTo(0);
  addEventListener('resize', function () { placeRail(demo.step); });

  /* ── The Discipline System ── */
  var total = 1250, streak = 12, totalEl = $('#ledger-total'), streakEl = $('#streak'), spark = $('#spark');
  var history = [40, 55, 48, 62, 70, 76, 86];
  function drawSpark(lastNeg) {
    spark.innerHTML = history.map(function (h, i) {
      var last = i === history.length - 1;
      return '<i class="' + (last ? 'last' : '') + (last && lastNeg ? ' neg' : '') + '" style="--h:' + h + '%"></i>';
    }).join('');
  }
  drawSpark(false);
  var DELTA = { v: 50, m: -100 };
  $$('[data-apply]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-apply'), from = total;
      total += DELTA[k];
      $$('#ledger .lr').forEach(function (r) { r.classList.toggle('on', r.getAttribute('data-k') === k); });
      count(totalEl, from, total, 600, fmt);
      streak = k === 'v' ? streak + 1 : 0;
      streakEl.textContent = streak + (streak === 1 ? ' day' : ' days');
      var prev = history[history.length - 1];
      history.shift(); history.push(k === 'v' ? Math.min(100, prev + 8) : 30);
      drawSpark(k === 'm');
    });
  });

  // Discipline Score: a sample built with the real formula (45 / 25 / 20 / 10).
  var weightsEls = $$('#weights li'), W = [0.45, 0.25, 0.20, 0.10];
  var parts = weightsEls.map(function (li) { return parseFloat(getComputedStyle(li).getPropertyValue('--v')) || 0; });
  var score = Math.round(100 * parts.reduce(function (s, v, i) { return s + v * W[i]; }, 0));
  var scored = false;
  function showScore() {
    if (scored) return; scored = true;
    var arc = $('#score-arc'), C = 326.7;
    if (!reduce) arc.style.transition = 'stroke-dashoffset 1600ms cubic-bezier(.23,1,.32,1)';
    arc.setAttribute('stroke-dashoffset', (C * (1 - score / 100)).toFixed(1));
    count($('#score-num'), 0, score, 1600, String);
    weightsEls.forEach(function (li, i) { setTimeout(function () { li.style.setProperty('--fill', parts[i]); }, reduce ? 0 : 200 + i * 140); });
  }
  if ('IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { showScore(); so.disconnect(); } }); }, { threshold: 0.35 });
    so.observe($('.score-ring'));
  } else showScore();

  /* ── Product showcase ── */
  var desktop = matchMedia('(min-width: 761px)');
  var SCREENS = [
    { id: 'home', tab: 'Today', alt: 'Today screen with the next target, a live countdown to its window and today’s progress', cap: '<b>Today.</b> Your next commitment with a live countdown to its window, and how much of the day is done.' },
    { id: 'habits', tab: 'Commitments', alt: 'Commitments list with times, days, streaks and results', cap: '<b>Commitments.</b> Every promise with its time, its days, its streak and its last result.' },
    { id: 'proof', island: false, tab: 'Proof camera', alt: 'Proof camera for Morning run, photo 1 of 2, with a framing guide and no gallery', cap: '<b>Proof camera.</b> Opens only inside the window. It shows what counts as proof and has no gallery button.' },
    { id: 'discipline', tab: 'Discipline Score', alt: 'Discipline Score screen with the score and its four weighted parts', cap: '<b>Discipline Score.</b> One number from 0 to 100, with every part of the formula shown.' },
    { id: 'challenges', tab: 'Challenges', alt: 'Challenges screen with an active 30-day challenge and the library', cap: '<b>Challenges.</b> Fixed length, a limited number of misses, and a bonus only if you finish. Premium.' },
    { id: 'report', tab: 'Weekly report', alt: 'Weekly report with the share of verified targets, points, misses and streak', cap: '<b>Weekly report.</b> Every Monday: what you verified, what you missed, your strongest commitment and the one that needs work. Premium.' },
    { id: 'arena', tab: 'Arena', alt: 'Arena with weekly, monthly and all-time standings', cap: '<b>Arena.</b> Optional competition by verified points, this week, this month or all time.' },
    { id: 'coach', tab: 'AI Coach', alt: 'AI Coach with suggested questions based on your own data', cap: '<b>AI Coach.</b> Answers from your own commitments, results and Discipline Score. Never your photos. Premium.' },
    { id: 'missed', tab: 'Missed', alt: 'Missed target screen with the points and streak lost and the next chance', cap: '<b>Missed.</b> When a window closes without proof: exactly what it cost, and when your next chance is.' }
  ];
  var carousel = $('#carousel'), tabs = $('#show-tabs'), capEl = $('#show-cap'), slots = [], tabEls = [];
  SCREENS.forEach(function (s, i) {
    var slot = document.createElement('div');
    slot.className = 'slot';
    slot.innerHTML = '<div class="phone' + (s.island === false ? ' no-island' : '') + '"><div class="screen"><span class="island" aria-hidden="true"></span><img src="l/screens/' + s.id + '.webp" alt="' + s.alt + '" loading="lazy" decoding="async" width="390" height="844"></div></div><span class="slot-cap">' + s.cap.replace(/<\/?b>/g, '') + '</span>';
    slot.addEventListener('click', function () { if (desktop.matches) select(i); });
    carousel.appendChild(slot); slots.push(slot);
    tilt(slot.querySelector('.phone'), 10);
    var t = document.createElement('button');
    t.type = 'button'; t.setAttribute('role', 'tab'); t.textContent = s.tab;
    t.addEventListener('click', function () { select(i); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = (i + (e.key === 'ArrowRight' ? 1 : -1) + SCREENS.length) % SCREENS.length; select(n); tabEls[n].focus(); }
    });
    tabs.appendChild(t); tabEls.push(t);
  });
  function select(i) {
    var n = slots.length;
    slots.forEach(function (s, k) {
      var d = ((k - i) % n + n) % n; if (d > n / 2) d -= n; // circular: neighbours on both sides
      var ad = Math.abs(d);
      s.classList.toggle('center', d === 0);
      s.style.transform = 'translateX(' + (d * 74) + '%) translateZ(' + (-ad * 200) + 'px) rotateY(' + (-d * 24) + 'deg)';
      s.style.opacity = ad > 2 ? '0' : ad === 0 ? '1' : ad === 1 ? '.55' : '.2';
      s.style.filter = ad === 0 ? 'none' : 'saturate(0) brightness(.75)';
      s.style.zIndex = String(10 - ad);
      s.style.pointerEvents = ad > 2 ? 'none' : '';
      s.setAttribute('aria-hidden', d === 0 || !desktop.matches ? 'false' : 'true');
    });
    tabEls.forEach(function (t, k) { t.setAttribute('aria-selected', k === i ? 'true' : 'false'); t.tabIndex = k === i ? 0 : -1; });
    capEl.innerHTML = SCREENS[i].cap;
  }
  select(0);
})();
