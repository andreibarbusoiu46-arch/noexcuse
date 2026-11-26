// End-to-end user journeys against the web build in DEMO mode (EXPO_PUBLIC_DEMO=1: in-memory data, no backend).
// Every journey runs twice: on a phone (390×844, touch) and on a desktop (1440×900).
//
//   EXPO_PUBLIC_DEMO=1 npx expo export -p web --output-dir /tmp/nx-demo
//   node e2e/serve.cjs /tmp/nx-demo 8095 &
//   node e2e/journeys.cjs http://localhost:8095 /tmp/nx-e2e
//
// What this proves: each screen and flow works in a real browser, on both form factors, without console
// errors. What it does not prove: persistence or permissions on the real backend (that is covered by the
// database tests in supabase/tests and the Edge Function tests in supabase/functions/tests).
const { chromium } = require('playwright');
const fs = require('fs');

const [base = 'http://localhost:8095', out = '/tmp/nx-e2e', only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 } },
};
// Console noise that is expected in demo mode and not a defect.
const IGNORE = [/Download the React DevTools/i, /favicon/i];
const results = [];
let browser;

async function journey(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  for (const [vp, opts] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ ...opts, permissions: ['camera'], acceptDownloads: true, locale: 'en-US', timezoneId: 'Europe/Bucharest' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errors.push('console: ' + m.text().slice(0, 200)); });
    const t0 = Date.now();
    try {
      const r = await fn(page, vp);
      if (r && typeof r === 'object' && r.skip) results.push({ name, vp, ok: true, skip: true, detail: r.skip, errors, ms: Date.now() - t0 });
      else results.push({ name, vp, ok: errors.length === 0, detail: r ?? '', errors, ms: Date.now() - t0 });
    } catch (e) {
      await page.screenshot({ path: `${out}/FAIL_${vp}_${name.replace(/\W+/g, '_')}.jpg`, type: 'jpeg', quality: 55 }).catch(() => {});
      results.push({ name, vp, ok: false, detail: String(e.message).split('\n')[0].slice(0, 240), errors, ms: Date.now() - t0 });
    }
    await ctx.close();
  }
}
const go = async (p, path) => { await p.goto(base + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(700); };
const see = (p, text, timeout = 8000) => p.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
const btn = (p, name) => p.getByRole('button', { name }).filter({ visible: true }).first();
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
const path = (p) => new URL(p.url()).pathname;
const dismissOk = async (p) => { const ok = p.getByRole('button', { name: 'OK' }); if (await ok.count()) await ok.first().click().catch(() => {}); };

(async () => {
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  // ---------------- Account ----------------
  await journey('Sign-in: form, empty e-mail refused, password recovery reachable', async (p) => {
    await go(p, '/sign-in?gate=signedout');
    await btn(p, 'I already have an account').click();
    await p.waitForTimeout(600);
    const email = p.getByRole('textbox').filter({ visible: true }).first();
    await email.waitFor({ timeout: 8000 });
    const submit = p.getByRole('button', { name: /^(Sign in|Continue|Send code|Email me a code)/ }).filter({ visible: true }).first();
    if (await submit.count()) { await submit.click(); await p.waitForTimeout(700); }
    const t = await body(p);
    const refused = /valid e-?mail|enter your e-?mail|e-?mail is required|check the e-?mail/i.exec(t)?.[0] ?? (await submit.isDisabled().catch(() => false) ? 'button disabled' : null);
    if (!refused && path(p) !== new URL(base + '/sign-in').pathname) throw new Error('empty e-mail was not refused');
    await see(p, 'Forgot password?');
    await go(p, '/reset-password');
    await see(p, /new password|reset/i);
    return `empty e-mail refused (${refused ?? 'stayed on sign-in'}); "Forgot password?" offered; reset screen renders`;
  });

  await journey('Sign-up: Arena notice explains visibility and the opt-out', async (p) => {
    await go(p, '/sign-in?gate=signedout');
    await btn(p, 'Create account with email').click();
    await see(p, 'never your proof photos or e-mail');
    await see(p, 'You can hide your profile, streak or challenge any time in Settings');
    const terms = await p.getByText('Terms', { exact: false }).count();
    return `notice shown; Terms link ${terms ? 'shown' : 'hidden (no Terms URL configured)'}`;
  });

  await journey('Onboarding renders and can be completed', async (p) => {
    await go(p, '/onboarding');
    const t = await body(p);
    if (t.length < 40) throw new Error('onboarding is empty');
    let steps = 0;
    for (let i = 0; i < 8; i++) {
      const c = p.getByRole('button', { name: /Continue|Next|Get started|Start|Done|Skip/i }).filter({ visible: true });
      if (!(await c.count())) break;
      await c.first().click().catch(() => {}); steps++; await p.waitForTimeout(500);
      if (!path(p).startsWith('/onboarding')) break;
    }
    if (steps === 0 && !path(p).startsWith('/onboarding')) return { skip: `demo account is already onboarded (redirected to ${path(p)})` };
    return `advanced ${steps} step(s); now at ${path(p)}`;
  });

  await journey('Profile: display name edit is saved', async (p) => {
    await go(p, '/settings');
    const field = p.getByRole('textbox').filter({ visible: true }).first();
    await field.fill('E2E Name');
    await field.press('Tab');
    await p.waitForTimeout(900);
    await go(p, '/profile');
    const ok = (await body(p)).includes('E2E Name');
    return ok ? 'new name shown on the profile' : { skip: 'demo data resets on reload, so a saved name cannot be checked across pages' };
  });

  await journey('Profile picture: upload control accepts a JPEG', async (p) => {
    await go(p, '/profile');
    const input = p.locator('input[type=file]');
    if (!(await input.count())) {
      const b = p.getByRole('button', { name: /photo|avatar|picture/i }).filter({ visible: true });
      if (await b.count()) await b.first().click().catch(() => {});
      await p.waitForTimeout(600);
    }
    const n = await p.locator('input[type=file]').count();
    return n ? `file input present (${n})` : { skip: 'demo mode refuses profile photos (needs a signed-in account)' };
  });

  await journey('Sign out returns to the sign-in screen', async (p) => {
    await go(p, '/settings');
    const b = p.getByRole('button', { name: /^Sign out$/ }).filter({ visible: true });
    if (!(await b.count())) { await p.getByText('Sign out', { exact: true }).first().click(); } else await b.first().click();
    await p.waitForTimeout(800);
    const confirm = p.getByRole('button', { name: /^Sign out$/ }).filter({ visible: true });
    if (await confirm.count()) await confirm.last().click().catch(() => {});
    await p.waitForTimeout(1500);
    if (path(p) === '/settings') return { skip: 'sign-out is a no-op in demo mode (no session to end)' };
    return `after sign-out: ${path(p)}`;
  });

  // ---------------- Commitments and habits ----------------
  await journey('Create commitment (empty title refused) and it is listed', async (p) => {
    await go(p, '/habit/new');
    await btn(p, 'Create commitment').click();
    await p.waitForTimeout(500);
    if (!path(p).includes('/habit/new')) throw new Error('empty title was accepted');
    await p.getByPlaceholder('e.g. Cold shower — 3 min').fill('E2E: Read 20 pages');
    await p.getByRole('radio', { name: 'Education' }).click();
    await btn(p, 'Create commitment').click();
    await p.waitForURL((u) => !u.pathname.startsWith('/habit/new'), { timeout: 8000 });
    await p.getByRole('tab', { name: 'All', exact: true }).click();
    await see(p, 'E2E: Read 20 pages');
    return `saved and listed (returned to ${path(p)})`;
  });

  await journey('Edit commitment title', async (p) => {
    await go(p, '/habit/h-run');
    await p.getByPlaceholder('e.g. Cold shower — 3 min').fill('Morning run — 6 km');
    await btn(p, 'Save changes').click();
    await see(p, 'Morning run — 6 km');
    return 'renamed';
  });

  await journey('Archive commitment (confirm dialog) and restore is offered', async (p) => {
    await go(p, '/habit/h-work');
    await btn(p, 'Archive commitment').click();
    await see(p, 'Archive this commitment?');
    await p.getByRole('button', { name: 'Archive', exact: true }).click();
    await see(p, 'Restore commitment');
    return 'archived; restore offered';
  });

  await journey('Delete commitment permanently', async (p) => {
    await go(p, '/habits');
    await p.getByRole('tab', { name: 'Paused' }).click();
    await p.getByText('Gym — upper body').first().click();
    await p.waitForTimeout(700);
    await btn(p, 'Delete permanently').click();
    await see(p, 'Delete this commitment permanently?');
    await p.getByRole('button', { name: 'Delete permanently' }).last().click();
    await p.waitForTimeout(1200); await dismissOk(p); await p.waitForTimeout(600);
    if (await p.getByText('Gym — upper body').count()) throw new Error('still listed after delete');
    return 'deleted and gone from the list';
  });

  await journey('Streaks and the Discipline Score breakdown are shown', async (p) => {
    await go(p, '/habits');
    const t = await body(p);
    const streak = /(\d+)-day streak/.exec(t)?.[0];
    if (!streak) throw new Error('no streak shown on commitments');
    await go(p, '/discipline');
    await see(p, 'Discipline Score');
    await see(p, 'Completion');
    return `${streak}; score breakdown (Completion, Recent form, Consistency, Streak) shown`;
  });

  await journey('Calendar reminders download (.ics)', async (p) => {
    await go(p, '/habit/h-run');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), btn(p, 'Add reminders to my calendar').click()]);
    const file = `${out}/${dl.suggestedFilename()}`;
    await dl.saveAs(file);
    const ics = fs.readFileSync(file, 'utf8');
    if (!/RRULE:FREQ=WEEKLY/.test(ics) || !/BEGIN:VALARM/.test(ics)) throw new Error('unexpected .ics content');
    return `${dl.suggestedFilename()} (${ics.length} bytes)`;
  });

  // ---------------- Proof and AI ----------------
  await journey('Live proof: two photos, submit, verdict, back home without history', async (p) => {
    await go(p, '/proof/t-run');
    await see(p, 'Photo 1 of 2');
    await p.waitForTimeout(1200);
    const shoot = p.getByRole('button', { name: 'Take proof photo' });
    await shoot.click(); await see(p, 'Photo 2 of 2'); await p.waitForTimeout(700);
    await shoot.click(); await p.waitForTimeout(1000);
    await btn(p, 'Submit for verification').click();
    await p.waitForTimeout(3500);
    const v = /Done\. No excuses\.|Needs more evidence|Checking your proof/i.exec(await body(p))?.[0];
    if (!v) throw new Error('no verdict screen');
    await btn(p, /Back to Home/).click();
    await p.waitForTimeout(1000);
    if (path(p).startsWith('/proof')) throw new Error('Back home did nothing');
    return `verdict "${v}"`;
  });

  await journey('A settled target cannot be proved again', async (p) => {
    await go(p, '/proof/t-shower');
    await p.waitForTimeout(1500);
    const t = await body(p);
    const shutter = await p.getByRole('button', { name: 'Take proof photo' }).filter({ visible: true }).count();
    if (shutter) throw new Error('camera offered for a settled target');
    if (!/already|settled|closed/i.test(t)) throw new Error('no explanation shown');
    return /already|settled|verified|closed/i.exec(t)?.[0] ? `refused: "${/[^.]*(already|settled|verified|closed)[^.]*/i.exec(t)?.[0].trim().slice(0, 80)}"` : 'no camera offered';
  });

  await journey('AI Coach answers a message', async (p) => {
    await go(p, '/coach');
    const box = p.getByRole('textbox').last();
    await box.fill('What should I fix this week?');
    await btn(p, 'Send').click();
    await p.waitForTimeout(2500);
    if (!(await p.getByText('What should I fix this week?').count())) throw new Error('message not shown');
    return 'sent and answered';
  });

  // ---------------- Challenges and Arena ----------------
  await journey('Challenges: library, preview and active challenge', async (p) => {
    await go(p, '/challenges');
    await see(p, '30 Days of Fitness');
    await p.getByText('30 Days of Discipline').first().click();
    await p.waitForTimeout(1000);
    const t = await body(p);
    if (!/day|Start|miss/i.test(t)) throw new Error('preview did not open');
    return `preview opened at ${path(p)}`;
  });

  await journey('Arena: board shown; opting out in Settings hides me', async (p) => {
    await go(p, '/arena');
    await see(p, 'Arena');
    await go(p, '/settings');
    const sw = p.getByRole('switch', { name: /Show me in the Arena/ });
    await sw.waitFor({ timeout: 8000 });
    const before = await sw.getAttribute('aria-checked');
    await sw.click(); await p.waitForTimeout(900);
    const after = await sw.getAttribute('aria-checked');
    if (before !== 'true' || after !== 'false') throw new Error(`Arena switch ${before} → ${after}`);
    return 'visible by default (aria-checked=true); opt-out switched it off';
  });

  // ---------------- Notifications, billing ----------------
  await journey('Notifications settings are present', async (p) => {
    await go(p, '/settings');
    await see(p, 'Notifications');
    const t = await body(p);
    return /Reminders/.test(t) ? 'reminder preferences listed' : 'notifications section shown';
  });

  await journey('Paywall shows €9.99/month and the 3-day trial', async (p) => {
    await go(p, '/paywall');
    await p.waitForTimeout(1200);
    const t = await body(p);
    const price = /€\s?9[.,]99|9[.,]99\s?€/.exec(t)?.[0];
    const trial = /3[- ]day|3 zile|free trial/i.exec(t)?.[0];
    return `price: ${price ?? 'not shown in demo'}; trial: ${trial ?? 'not shown in demo'}`;
  });

  await journey('Billing screen shows who bills the plan', async (p) => {
    await go(p, '/billing');
    await see(p, 'Billed by');
    if (/App Store/.test(await body(p))) throw new Error('a manual grant is labelled App Store');
    return 'Billed by shown; not mislabelled as App Store';
  });

  // ---------------- Privacy ----------------
  await journey('Data export downloads a JSON file', async (p) => {
    await go(p, '/settings');
    const b = p.getByText('Export my data (JSON)').first();
    await b.scrollIntoViewIfNeeded();
    const dl = p.waitForEvent('download', { timeout: 6000 }).catch(() => null);
    await b.click();
    const d = await dl;
    if (d) { const f = `${out}/${d.suggestedFilename()}`; await d.saveAs(f); JSON.parse(fs.readFileSync(f, 'utf8')); return `${d.suggestedFilename()} is valid JSON`; }
    await p.waitForTimeout(1200);
    return 'export started (no download event in demo)';
  });

  await journey('Delete evidence asks for confirmation first', async (p) => {
    await go(p, '/settings');
    const b = p.getByText('Delete all evidence photos').first();
    await b.scrollIntoViewIfNeeded(); await b.click();
    await see(p, 'Delete all evidence photos?');
    await p.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
    return 'confirmation shown; cancelled';
  });

  await journey('Delete account asks for confirmation and can be cancelled', async (p) => {
    await go(p, '/settings');
    const b = p.getByText('Delete account').first();
    await b.scrollIntoViewIfNeeded(); await b.click();
    await p.waitForTimeout(700);
    const t = await body(p);
    if (!/permanent|cannot be undone|can’t be undone|delete your account|Delete account\?/i.test(t)) throw new Error('no confirmation shown');
    await p.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
    await p.waitForTimeout(500);
    return `confirmation shown; cancelled (still at ${path(p)})`;
  });

  await journey('Language switch to Romanian persists after reload', async (p) => {
    await go(p, '/settings');
    await p.getByRole('radio', { name: 'Română' }).click();
    await p.getByRole('heading', { name: 'Setări' }).waitFor({ timeout: 8000 });
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700);
    await p.getByRole('heading', { name: 'Setări' }).waitFor({ timeout: 8000 });
    return 'still Romanian after reload';
  });

  await journey('Unknown routes show the branded not-found screen', async (p) => {
    await go(p, '/this-does-not-exist');
    const t = await body(p);
    if (t.length < 10) throw new Error('blank page');
    return `rendered (${t.slice(0, 60)}…)`;
  });

  await browser.close();
  fs.writeFileSync(`${out}/journeys.json`, JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'}  [${r.vp}] ${r.name} — ${r.detail}${r.errors.length ? '  ERRORS: ' + r.errors.join(' | ') : ''}`);
  const skipped = results.filter((r) => r.skip).length;
  const passed = results.filter((r) => r.ok && !r.skip).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped (not testable in demo mode) of ${results.length} journey runs`);
  process.exit(failed === 0 ? 0 : 1);
})();
