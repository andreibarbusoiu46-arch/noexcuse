// Route sweep over every screen on phone, tablet and desktop: console errors, horizontal overflow, tap targets
// under 44 px, and axe-core WCAG 2 A/AA violations. Usage: node e2e/sweep.cjs <baseUrl> <outDir> [label]
const { chromium } = require('playwright');
const fs = require('fs');
const [base, out, label = 'run'] = process.argv.slice(2);
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const routes = ['/', '/habits', '/challenges', '/arena', '/ai', '/achievements', '/billing', '/challenge/c-run', '/challenge/custom', '/challenge/generate',
  '/coach', '/comeback/h-read', '/discipline', '/habit/h-run', '/habit/new', '/missed/t-read-y', '/appeal/t-read-y', '/onboarding', '/partners',
  '/paywall', '/profile', '/proof/t-run', '/reports', '/settings', '/share', '/sign-in', '/no-such-page'];
const viewports = [{ name: '360', width: 360, height: 780, mobile: true }, { name: '390', width: 390, height: 844, mobile: true }, { name: '1280', width: 1280, height: 800, mobile: false }];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const results = [];
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1, permissions: ['camera'] });
    for (const r of routes) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
      let status = 'ok';
      try { await page.goto(base + r, { waitUntil: 'networkidle', timeout: 30000 }); } catch (_e) { status = 'timeout'; }
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const els = [...document.querySelectorAll('a,button,[role=button],[role=link],[role=switch],[role=tab],input,[tabindex="0"]')];
        const small = els.filter((e) => { const b = e.getBoundingClientRect(); const st = getComputedStyle(e);
          return b.width > 0 && b.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && b.top < innerHeight * 3 && (b.width < 24 || b.height < 24); })
          .map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30));
        return { overflow: sw - vw, small, title: document.title, text: document.body.innerText.slice(0, 120).replace(/\s+/g, ' ') };
      });
      let axe = null;
      if (vp.name === '390') {
        await page.addScriptTag({ content: AXE });
        axe = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => `${v.id}(${v.nodes.length})`));
      }
      if (vp.name === '390') await page.screenshot({ path: `${out}/${label}_${r.replace(/[^a-z0-9]+/gi, '_') || 'home'}.jpg`, type: 'jpeg', quality: 60 });
      results.push({ vp: vp.name, route: r, status, errors: [...new Set(errors)], overflow: m.overflow, small: m.small, axe, text: m.text });
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(`${out}/${label}.json`, JSON.stringify(results, null, 1));
  const bad = results.filter((x) => x.errors.length || x.overflow > 1 || x.small.length || (x.axe && x.axe.length) || x.status !== 'ok');
  console.log(`${results.length} page loads; with issues: ${bad.length}`);
  for (const x of bad) console.log(`${x.vp} ${x.route} ${x.status !== 'ok' ? x.status : ''} ${x.errors.length ? 'ERR[' + x.errors.join(' | ') + ']' : ''} ${x.overflow > 1 ? 'OVERFLOW+' + x.overflow : ''} ${x.small.length ? 'SMALL' + JSON.stringify(x.small) : ''} ${x.axe && x.axe.length ? 'AXE' + JSON.stringify(x.axe) : ''}`);
  process.exit(bad.length ? 1 : 0);
})();
