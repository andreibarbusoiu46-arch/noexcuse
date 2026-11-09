/* NoExcuse landing — interactions. No dependencies. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  /* ── Reveal section heads once ───────────────────────── */
  if ('IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px' });
    $$('.reveal').forEach(function (el) { ro.observe(el); });
  } else { $$('.reveal').forEach(function (el) { el.classList.add('in'); }); }

  /* ── Scroll-linked details: nav over light sheets, struck promises, fading motivation ── */
  var nav = $('#nav'), sheets = $$('.sheet'), promises = $$('.promise'), fades = $('#fades');
  var ticking = false;
  function onScroll() {
    ticking = false;
    var vh = innerHeight;
    var navMid = 44, onLight = false;
    sheets.forEach(function (s) { var r = s.getBoundingClientRect(); if (r.top < navMid && r.bottom > navMid) onLight = true; });
    nav.classList.toggle('on-light', onLight);
    promises.forEach(function (p) {
      var r = p.getBoundingClientRect();
      var k = Math.min(1, Math.max(0, (vh * 0.78 - r.top) / (vh * 0.22)));
      p.style.setProperty('--strike', reduce ? (k > 0 ? 1 : 0) : k.toFixed(3));
      p.classList.toggle('struck', k > 0.98);
    });
    if (fades) {
      var fr = fades.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, (vh * 0.85 - fr.top) / (vh * 0.5)));
      fades.style.setProperty('--p', (100 - f * 118).toFixed(1) + '%');
    }
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  /* ── Interactive demo ───────────────────────────────── */
  var CAPTIONS = [
    'Name the habit, pick the deadline and how often. The evidence window is 15 minutes either side.',
    'The in‑app camera opens inside the window. The gallery is locked, so the photo is from right now.',
    'The judge checks the photo against your habit and the clock, then rules with a one‑line reason.',
    'Deliver and earn 50 points. Miss and lose 100. Compare both outcomes.'
  ];
  var demo = {
    step: 0, habit: 'Morning workout', deadline: '08:00', freq: 'Daily', committed: false, captured: false, outcome: 'win', timers: []
  };
  var views = $$('[data-view]'), stepBtns = $$('.step-btn'), tabBtns = $$('.step-tabs button'), rail = $('#rail');
  function later(ms, fn) { demo.timers.push(setTimeout(fn, reduce ? Math.min(ms, 60) : ms)); }
  function clearTimers() { demo.timers.forEach(clearTimeout); demo.timers = []; }
  function hhmm(min) { var h = Math.floor(min / 60) % 24, m = min % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  function toMin(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
  function windowText() { var d = toMin(demo.deadline); return hhmm(d - 15) + ' – ' + hhmm(d + 15); }
  function captureTime() { return hhmm(toMin(demo.deadline) - 8); }

  function goTo(i) {
    clearTimers();
    demo.step = i;
    views.forEach(function (v, k) { v.classList.toggle('on', k === i); v.classList.toggle('prev', k < i); v.inert = k !== i; });
    stepBtns.forEach(function (b, k) { if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); b.classList.toggle('done', k < i); });
    tabBtns.forEach(function (b, k) { if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    if (rail && stepBtns.length) {
      var first = stepBtns[0].getBoundingClientRect(), cur = stepBtns[i].getBoundingClientRect();
      rail.style.height = (cur.top - first.top) + 'px';
    }
    var cap = $('#step-caption'); if (cap) cap.textContent = CAPTIONS[i];
    if (i === 1) resetCamera();
    if (i === 2) runVerification();
    if (i === 3) setOutcome(demo.outcome, true);
  }
  // "Start your challenge" → after sign-up the app opens the trial offer once (see Home).
  $$('a[href="/onboarding"]').forEach(function (a) {
    a.addEventListener('click', function () { try { sessionStorage.setItem('noexcuse:start-trial', '1'); } catch (e) { /* private mode */ } });
  });
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { goTo(+b.getAttribute('data-go')); }); });

  // Step 1 · Commit
  var habitInput = $('#habit-name'), statusCard = $('#status-card'), commitBtn = $('#commit-btn');
  function syncCommit() {
    $('#win-text').textContent = windowText();
    $('#status-text').textContent = (demo.habit || 'Your habit') + ', due ' + demo.deadline + ', ' + demo.freq.toLowerCase();
    $('#chk-win').textContent = windowText().replace(' – ', '–');
    $('#chk-habit').textContent = (demo.habit || 'the habit').toLowerCase().slice(0, 18);
    $('#cam-clock').textContent = captureTime() + ' · window open';
    $('#cap-meta').textContent = 'Captured ' + captureTime() + ':14 · in‑app camera';
    $$('#checks small')[0].textContent = captureTime() + ':14';
  }
  habitInput.addEventListener('input', function () { demo.habit = habitInput.value.trim(); syncCommit(); });
  $$('[data-chips]').forEach(function (group) {
    var key = group.getAttribute('data-chips');
    $$('.chip', group).forEach(function (c) {
      c.addEventListener('click', function () {
        $$('.chip', group).forEach(function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
        demo[key] = c.getAttribute('data-v');
        syncCommit();
      });
    });
  });
  $('#commit-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!demo.committed) {
      demo.committed = true;
      statusCard.classList.add('show');
      commitBtn.textContent = 'Continue to proof';
    } else { goTo(1); }
  });

  // Step 2 · Prove
  var captured = $('#captured'), flash = $('#flash');
  function resetCamera() { demo.captured = false; captured.classList.remove('show'); captured.parentNode.classList.remove('taken'); }
  $('#shutter').addEventListener('click', function () {
    if (flash.animate && !reduce) flash.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 420, easing: 'cubic-bezier(.23,1,.32,1)' });
    demo.captured = true;
    captured.classList.add('show');
    captured.parentNode.classList.add('taken');
    $('#submit-btn').focus({ preventScroll: true });
  });
  $('#retake-btn').addEventListener('click', resetCamera);
  $('#submit-btn').addEventListener('click', function () { goTo(2); });

  // Step 3 · Verify (simulated: a fixed sequence, no network)
  function runVerification() {
    var v = $('#verify'), checks = $$('#checks li'), ruling = $('#ruling'), title = $('#verify-title');
    v.classList.remove('scanning'); checks.forEach(function (c) { c.classList.remove('ok'); });
    ruling.classList.remove('show'); title.textContent = 'Reviewing evidence…';
    $('#v-critique').textContent = 'Dumbbells, gym floor, morning light. It matches “' + (demo.habit || 'your habit') + '”. Counts.';
    later(250, function () { v.classList.add('scanning'); });
    checks.forEach(function (c, k) { later(500 + k * 520, function () { c.classList.add('ok'); }); });
    later(500 + checks.length * 520 + 200, function () {
      v.classList.remove('scanning');
      title.textContent = 'Verified.';
      ruling.classList.add('show');
      count($('#v-pts'), 0, 50, 700, function (n) { return '+' + n; });
      count($('#v-total'), 1240, 1290, 900, fmt);
    });
  }

  // Step 4 · Consequences
  var seg = $('#seg'), bigDelta = $('#big-delta'), bars = $$('#bars i'), lastBar = bars[bars.length - 1];
  function setOutcome(o, instant) {
    demo.outcome = o;
    var win = o === 'win';
    seg.classList.toggle('right', !win);
    $$('button', seg).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-o') === o ? 'true' : 'false'); });
    bigDelta.classList.toggle('loss', !win);
    var from = win ? -100 : 50, to = win ? 50 : -100;
    count(bigDelta, instant ? to : from, to, 600, function (n) { return n > 0 ? '+' + n : n < 0 ? minus + Math.abs(n) : '0'; });
    $('#c-streak').textContent = win ? '12 → 13 days' : '12 → 0 days';
    $('#c-points').textContent = win ? '1,240 → 1,290' : '1,240 → 1,140';
    lastBar.style.setProperty('--h', win ? '86%' : '30%');
    lastBar.classList.toggle('neg', !win);
    $('#bars-cap').textContent = win ? 'today: +50' : 'today: ' + minus + '100';
  }
  $$('button', seg).forEach(function (b) { b.addEventListener('click', function () { setOutcome(b.getAttribute('data-o')); }); });

  syncCommit();
  goTo(0);
  addEventListener('resize', function () { if (rail && stepBtns.length) { var f = stepBtns[0].getBoundingClientRect(), c = stepBtns[demo.step].getBoundingClientRect(); rail.style.height = (c.top - f.top) + 'px'; } });

  /* ── Discipline, engineered ─────────────────────────── */
  var stages = $$('.eng-stage'), panels = $$('[data-panel]'), engActive = -1;
  function setStage(i) {
    if (i === engActive) return;
    engActive = i;
    stages.forEach(function (s, k) { s.classList.toggle('active', k === i); });
    panels.forEach(function (p, k) { p.classList.toggle('on', k === i); });
    $$('#eng-dots i').forEach(function (d, k) { d.classList.toggle('on', k === i); });
    if (i === 1) startCapture(); else stopCapture();
  }
  var desktop = matchMedia('(min-width: 761px)');
  if ('IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (es) {
      if (!desktop.matches) return;
      es.forEach(function (e) { if (e.isIntersecting) setStage(+e.target.getAttribute('data-stage')); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    stages.forEach(function (s) { so.observe(s); });
  }
  var track = $('#eng-track');
  track.addEventListener('scroll', function () {
    if (desktop.matches) return;
    var w = track.scrollWidth - track.clientWidth;
    var i = w > 0 ? Math.round((track.scrollLeft / w) * (stages.length - 1)) : 0;
    $$('#eng-dots i').forEach(function (d, k) { d.classList.toggle('on', k === i); });
  }, { passive: true });

  // 01 · dial: the deadline becomes a 30-minute window on the clock face
  var dialTicks = $('#dial-ticks'), dialWin = $('#dial-win'), dialHand = $('#dial-hand'), range = $('#dial-range');
  (function buildTicks() {
    var ns = 'http://www.w3.org/2000/svg', s = '';
    for (var i = 0; i < 60; i++) {
      var big = i % 5 === 0, a = i * 6 * Math.PI / 180, r1 = big ? 78 : 83, r2 = 88;
      s += '<line x1="' + (120 + r1 * Math.sin(a)).toFixed(2) + '" y1="' + (120 - r1 * Math.cos(a)).toFixed(2) + '" x2="' + (120 + r2 * Math.sin(a)).toFixed(2) + '" y2="' + (120 - r2 * Math.cos(a)).toFixed(2) + '" stroke="' + (big ? '#fff' : 'rgba(255,255,255,.35)') + '" stroke-width="' + (big ? 2 : 1) + '"/>';
    }
    dialTicks.innerHTML = s; void ns;
  })();
  function polar(deg, r) { var a = (deg - 90) * Math.PI / 180; return [120 + r * Math.cos(a), 120 + r * Math.sin(a)]; }
  function setDial() {
    var minutes = +range.value * 15, d = minutes % 720;
    var a0 = (d - 15) / 720 * 360, a1 = (d + 15) / 720 * 360, p0 = polar(a0, 100), p1 = polar(a1, 100);
    dialWin.setAttribute('d', 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A100 100 0 0 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2));
    var h = polar(d / 720 * 360, 76);
    dialHand.setAttribute('x2', h[0].toFixed(2)); dialHand.setAttribute('y2', h[1].toFixed(2));
    $('#dial-time').textContent = hhmm(minutes);
    $('#dial-win-text').textContent = 'Window ' + hhmm(minutes - 15) + ' – ' + hhmm(minutes + 15);
    range.setAttribute('aria-valuetext', 'Deadline ' + hhmm(minutes));
  }
  range.addEventListener('input', setDial);
  setDial();

  // 02 · capture clock: ticks down in real time while visible
  var capTimer = null, capRing = $('#cap-ring'), capTime = $('#cap-time'), C = 326.7;
  function renderCap(s) { capTime.textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); capRing.setAttribute('stroke-dashoffset', (C * (1 - s / 180)).toFixed(1)); }
  function startCapture() { stopCapture(); var s = 180; renderCap(s); capTimer = setInterval(function () { s = s > 0 ? s - 1 : 180; renderCap(s); }, 1000); }
  function stopCapture() { if (capTimer) clearInterval(capTimer); capTimer = null; }
  capRing.style.transition = reduce ? 'none' : 'stroke-dashoffset 900ms linear';

  // 03 · ledger: apply outcomes to a running total
  var total = 1240, totalEl = $('#ledger-total'), DELTA = { v: 50, m: -100, r: -100 };
  $$('[data-apply]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-apply'), from = total;
      total += DELTA[k];
      $$('#ledger .lr').forEach(function (r) { r.classList.toggle('on', r.getAttribute('data-k') === k); });
      count(totalEl, from, total, 600, fmt);
    });
  });
  setStage(0);

  /* ── Product showcase ───────────────────────────────── */
  var SCREENS = [
    { id: 'home', tab: 'Today', alt: 'Today screen with the next target, countdown, progress and points', cap: '<b>Today.</b> Your next target with a live countdown to its window, today’s progress, your streak and points.' },
    { id: 'habits', tab: 'Habits', alt: 'Habits list with times, days and streaks', cap: '<b>Habits.</b> Every commitment with its time, days and streak. Pause one without losing its history.' },
    { id: 'proof', tab: 'Camera', alt: 'Proof screen asking for camera access only', cap: '<b>Camera.</b> The proof screen asks for the camera and nothing else. There is no upload button.' },
    { id: 'missed', tab: 'Missed', alt: 'Missed target screen showing the points and streak lost', cap: '<b>Missed.</b> When a window closes without proof: exactly what it cost, and when your next chance is.' },
    { id: 'comeback', tab: 'Comeback', alt: 'Comeback plan with streak rebuild, earlier reminder and sharper proof', cap: '<b>Comeback.</b> Rebuild the streak, move the reminder earlier, sharpen what counts as proof.' },
    { id: 'arena', tab: 'Arena', alt: 'Daily Arena leaderboard with podium and your position', cap: '<b>Arena.</b> A daily ranking. Everyone starts at zero each morning, and ties go to the longer streak.' },
    { id: 'profile', tab: 'Profile', alt: 'Profile with lifetime points, streaks, success rate and recent activity', cap: '<b>Profile.</b> Lifetime points, streaks, success rate and every score change in your history.' }
  ];
  var carousel = $('#carousel'), tabs = $('#show-tabs'), capEl = $('#show-cap'), active = 0, slots = [], tabEls = [];
  SCREENS.forEach(function (s, i) {
    var slot = document.createElement('div');
    slot.className = 'slot';
    slot.innerHTML = '<div class="phone"><div class="screen"><span class="island" aria-hidden="true"></span><img src="/l/screens/' + s.id + '.webp" alt="' + s.alt + '" loading="lazy" decoding="async" width="390" height="844"></div></div><span class="slot-cap">' + s.cap.replace(/<\/?b>/g, '') + '</span>';
    slot.addEventListener('click', function () { if (desktop.matches) select(i); });
    carousel.appendChild(slot); slots.push(slot);
    var t = document.createElement('button');
    t.type = 'button'; t.setAttribute('role', 'tab'); t.textContent = s.tab;
    t.addEventListener('click', function () { select(i); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = (i + (e.key === 'ArrowRight' ? 1 : -1) + SCREENS.length) % SCREENS.length; select(n); tabEls[n].focus(); }
    });
    tabs.appendChild(t); tabEls.push(t);
  });
  function select(i) {
    active = i;
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
    });
    tabEls.forEach(function (t, k) { t.setAttribute('aria-selected', k === i ? 'true' : 'false'); t.tabIndex = k === i ? 0 : -1; });
    capEl.innerHTML = SCREENS[i].cap;
  }
  select(0);
})();
