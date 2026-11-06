# NoExcuse — status (Nov 6, 2026)

## Live
- Web app + landing: https://noexcuse.vercel.app (deploys from `main`).
- Supabase project `ibsrtuyrflvprmjuuoqb`: all migrations in `supabase/migrations` applied; Edge Functions
  `start-proof`, `verify-proof`, `appeal-proof`, `coach`, `cron-tick` (every minute), `delete-account`,
  `refresh-entitlement`, `revenuecat-webhook`, `challenge-generate`, `privacy`, `ai-health` (diagnostic; returns only status codes).
- Functions are deployed as `deno bundle --minify` builds of the sources in `supabase/functions`.

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

Free: 2 active commitments, Standard verification, points, Discipline Score, War Room, Arena, achievements,
share card, joining a partner's circle. Premium (€9.99/month): everything else.

## Needs the owner
1. OpenAI: the key is set, but the account has no credit (`credit_balance_exhausted`). Add credit at
   platform.openai.com → Billing. Until then every proof is saved and retried, then excused without penalty.
2. RevenueCat + App Store Connect: create the €9.99 monthly product and the `premium` entitlement, then set
   `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH` (Supabase secrets) and `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (app build).
3. Optional: Supabase Auth → enable leaked password protection; `EXPO_ACCESS_TOKEN` secret for push.

## Adding a language
Add it to `LANGS` in `src/i18n/index.ts`, add a key to every `src/i18n/ns/*.ts` (the compiler lists anything missing),
template texts in `src/i18n/templates.ts`, and the server copy in `supabase/functions/_shared/push.ts`; allow the code
in the `profiles.language` check constraint.

## Tests
- Database: `PGHOST=... PGPORT=... PGUSER=postgres bash supabase/tests/run.sh` (phases 0–6, 218 checks).
- Functions: `cd supabase/functions && deno test --allow-env --no-lock --node-modules-dir=none tests`.
- App: `npx tsc --noEmit && npx eslint src`.
