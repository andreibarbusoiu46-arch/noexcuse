# NoExcuse — status (Nov 6, 2026)

## Live
- Web app + landing: https://noexcuse.vercel.app (deploys from `main`).
- Supabase project `ibsrtuyrflvprmjuuoqb`: all migrations in `supabase/migrations` applied; Edge Functions
  `start-proof`, `verify-proof`, `appeal-proof`, `coach`, `cron-tick` (every minute), `delete-account`,
  `refresh-entitlement`, `revenuecat-webhook`, `challenge-generate`, `privacy`, `ai-health` (diagnostic; returns only status codes),
  `ai-selftest` (internal; runs the real verification engine on public test images, Vault cron secret required),
  `app-selftest` (internal; 40 end-to-end checks of tasks, photos and Arena as two throw-away confirmed users,
  which it deletes at the end; call with the Vault cron secret).
- Functions are deployed either as `deno bundle --minify` builds or as a one-line entry that imports the sources at a
  pinned commit of this repo (`supabase/functions/<name>/index.ts` at `<sha>`), so what runs is exactly what is committed.

## What the product does
- Phase 0: verification retries every minute; after 5 failures or 24 h the target is excused (no penalty).
- Phase 1: War Room, Discipline Score (45/25/20/10), append-only points ledger, commitment details/archive, Challenges.
- Phase 2: verification levels (Standard 1 live photo; Strict 2 live + optional screenshot; Elite 2 live + required
  screenshot), duplicate detection (SHA-256 + dHash), "needs more evidence" with the exact next capture,
  one AI re-review appeal per rejection (+150 compensating ledger row if overturned).
- Phase 3: AI coach (grounded in a server snapshot, 20 messages/day), weekly reports (Monday 06:00 local),
  smart reminders (heads-up for often-missed commitments, last call), notification preferences.
- Phase 4: accountability partners (invite codes, nudges, partner-missed alerts), share card image.
- Phase 5: free plan enforced in the database (2 active commitments, Standard only, no challenges),
  achievements (13), paywall as a modal instead of a gate.

- Phase 6: challenge plans (1–5 objectives, categories Daily/Weekly/7-Day/30-Day/Custom/Elite, difficulty with
  bonus ×1.5 Advanced / ×2 Elite, 12 templates incl. a 75-day program not affiliated with any brand), template preview,
  custom builder, AI challenge generator (plan only; the user approves before anything starts), progress view
  (calendar, streak, objectives, evidence with appeal/needs-more-evidence links), history stats.
  English/Romanian everywhere (app, push notifications, AI critiques, coach, generator), Dark/Light/System themes
  without flash, Settings (account, password, language, appearance, notifications, evidence retention, delete
  evidence, export data, sign out everywhere, subscription). Preferences live on the profile (language, theme,
  evidence_retention) and in local storage when signed out.

- AI (Gemini, from scratch): one provider layer (`_shared/llm.ts`: REST `generateContent`, structured JSON output with
  strict schema validation, 40–45 s timeouts, retries with backoff and `RetryInfo`, quota vs rate-limit detection, OpenAI
  as optional fallback) and one verification engine (`_shared/engine.ts`) with activity-specific requirements
  (`src/shared/activity.ts`: gym, running, reading, studying, eating, wake-up, other) per level. The server, not the model,
  decides the final status: VERIFIED needs every required item, each on its own photo of the right kind, and
  confidence ≥ 0.75 (0.8 Elite); REJECTED needs confidence ≥ 0.8; everything else becomes NEEDS_MORE_EVIDENCE with
  no penalty. API errors never penalize. Every call is logged in `ai_usage` (tokens, latency, status — never prompts,
  images or answers). Limits: 40 analyses per user per 24 h, 6 submissions per target, proofs bucket 6 MB JPEG only.
  Internal overview: Settings → AI usage (admins only, `public.admins`).
  Env: `GEMINI_API_KEY` (required), `GEMINI_MODEL` (default `gemini-3.1-flash-lite`), optional
  `GEMINI_MODEL_VERIFY` / `_APPEAL` / `_COACH` / `_GENERATE`, `AI_PROVIDER` (`gemini`|`openai`).

- Phase 7 (UI + community): exact-minute time picker (browser time input on web, system wheel on iOS) — the old web
  field only accepted a fully typed "HH:MM", so editing snapped back to the old time; archive ⇄ restore (restored
  commitments come back paused) and permanent deletion (privacy function: photos leave storage first; a commitment
  with results keeps anonymous results so points can't be reset); delete failed/abandoned challenges; in-app confirm
  dialog on web (window.confirm is blocked in iframes / in-app browsers and silently answered "no"); profile photos
  (public `avatars` bucket, 2 MB, JPEG/PNG/WebP, owner-only writes, server-checked path); username and public-profile
  controls (appear in Arena, show streak, show challenge); Arena board of real confirmed users (week / month /
  all-time, search, partners filter, sort by streak, 20 per page, no e-mail ever); glass dock with Home in the centre
  and sections expanding from their place (fade only with Reduce Motion); WAR ROOM · Daily Intel (original library,
  picked from real progress, "Another" button).

- Payments: web uses Stripe (Checkout + Customer Portal + webhook), the iPhone app uses Apple In-App Purchase via
  RevenueCat (Apple requires IAP for digital subscriptions sold in App Store apps — Stripe is never shown there).
  `billing` function (plan / checkout / portal / sync; `setup` with the cron secret creates the €9.99/month price with
  lookup key `noexcuse_premium_monthly`, the portal settings and the webhook endpoint, and stores the webhook secret in
  the Vault). `stripe-webhook` verifies signatures, processes each event once (`stripe_events`) and re-reads the
  subscription from Stripe. Premium = active App Store entitlement OR Stripe status trialing/active (`has_premium`).
  The 3-day trial is offered once per account. Only `STRIPE_SECRET_KEY` is needed (test key `sk_test_…` first).
- Landing hero: three.js r170 from jsDelivr (`web/l/hero3d.js`): silver dial, a light arc that fills with the visitor's
  elapsed day, glass summit lit from behind (transmission only refracts opaque objects). ≥761 px: the dial rises from the
  bottom like a horizon behind the copy. Phones: the copy's children join the hero's flex column (`display: contents`) so
  the stage sits between the headline and the text and shows the whole dial, centred (240–420 px tall).
  Quality tiers from measured frame time: 1× pixels → smoked glass without the transmission pass → still frame; pauses
  off-screen / hidden tab; still frame with Reduce Motion; pre-rendered stills (`hero-still-wide/tall.webp`, regenerate
  with `?still`) when WebGL is missing. `#stage[data-state][data-tier]` shows what is running.

- Accounts: email + password sign-up (name, strength rules ≥10 chars with letters and a number, confirm), e-mail
  verification (Supabase "Confirm email" on: no session until the link is opened), resend with a 60 s cool-down,
  sign-in with generic errors (no account enumeration), "keep me signed in" on the web (session in localStorage vs
  sessionStorage), forgot password → `/reset-password` (other devices signed out after the change), e-mail links and
  OAuth land on `/auth/callback` (expired-link recovery), e-mail code sign-in kept for existing accounts, Google/Apple
  buttons shown only when enabled in Supabase Auth. Settings: verification status, secure e-mail change, password
  change re-checks the current password, sign out of all devices, deletion that lists what is deleted, requires
  typing a word, cancels a Stripe subscription first and removes photos. Getting-started guide on Home.
  `auth-selftest` (cron secret) runs 39 checks against the real Supabase Auth.
  Dashboard settings required: Site URL + redirect URLs, custom SMTP, password policy, providers (see the report).

Free: 2 active commitments, Standard verification, points, Discipline Score, War Room, Arena, achievements,
share card, joining a partner's circle. Premium (€9.99/month): everything else.

## Needs the owner
1. Gemini runs on the key in Supabase secrets. To see the AI usage screen, add yourself as admin once (SQL editor):
   `insert into public.admins (user_id) values ('<your auth user id>');`. Prices for cost estimates live in `public.ai_pricing`.
2. RevenueCat + App Store Connect: create the €9.99 monthly product and the `premium` entitlement, then set
   `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH` (Supabase secrets) and `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (app build).
3. Optional: Supabase Auth → enable leaked password protection; `EXPO_ACCESS_TOKEN` secret for push.

## Adding a language
Add it to `LANGS` in `src/i18n/index.ts`, add a key to every `src/i18n/ns/*.ts` (the compiler lists anything missing),
template texts in `src/i18n/templates.ts`, and the server copy in `supabase/functions/_shared/push.ts`; allow the code
in the `profiles.language` check constraint.

## Tests
- Database: `PGHOST=... PGPORT=... PGUSER=postgres bash supabase/tests/run.sh` (phases 0–7 + AI + Stripe, 283 checks).
- Functions: `cd supabase/functions && deno test --allow-env --no-lock --node-modules-dir=none tests`.
- App: `npx tsc --noEmit && npx eslint src`.
