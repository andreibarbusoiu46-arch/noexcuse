# NoExcuse

**No excuses. Just execution.** An iOS-first accountability app: set strict habit targets, prove them live with the in-app camera, get an AI verdict, build streaks, earn points, compete in the daily Arena.

- **App:** Expo SDK 58 · React Native 0.88 · Expo Router · native Liquid Glass (`expo-glass-effect`, `NativeTabs`) · React Three Fiber emblem · RevenueCat
- **Backend:** Supabase (Postgres + RLS, Edge Functions, Storage, pg_cron) · OpenAI vision (Responses API, strict JSON)
- **Design:** Figma file “NoExcuse — iOS App” (Foundations, Components, Screens). `src/theme/tokens.ts` mirrors its variables.

---

## What is where

```
src/app/                    screens (Expo Router)
  onboarding, sign-in       A · intro, Sign in with Apple, email code
  paywall                   B · RevenueCat offering, live price + trial eligibility, restore, legal
  (tabs)/index              C · Home: next action, ±15 min countdown, progress, streak, points, activity, Arena
  (tabs)/habits, habit/*    D · list, create/edit sheet (pause, never delete)
  proof/[targetId]          E–F · camera → preview → submit → processing → 6 verdict states
  (tabs)/arena              G · podium, your position, rankings, loading/empty/error
  (tabs)/profile            H · stats, subscription, notifications, timezone, restore, sign out, delete account
  missed/*, comeback/*      I · consequence + next chance, comeback plan
src/components/             Figma components in code (Glass, Button, HabitCard, VerdictCard, …)
src/data/                   live API (Supabase) + demo fixtures (same interface)
src/lib/                    purchases, push, haptics, glass gate, time rules
supabase/migrations/        schema, RLS, scoring, Arena, stats, storage
supabase/functions/         start-proof, verify-proof, refresh-entitlement, revenuecat-webhook, cron-tick, delete-account
supabase/tests/             database tests (plain Postgres + Supabase shim)
supabase/sql/schedule_cron.sql   one-time cron setup
```

## Product rules (enforced on the server)

| Rule | Where |
|---|---|
| Proof window = target time ±15 min, server clock, user's timezone (DST-safe) | `ensure_targets_for_habit`, `apply_verdict`, `verify-proof` |
| Verified **+50**, streak +1 · Rejected / expired / missed **−100**, streak → 0 | `apply_verdict`, `settle_due_targets` |
| Exactly one score per target (no duplicate rewards or penalties, even on retries/races) | `score_events.target_id UNIQUE` + row locks |
| Insufficient evidence / low AI confidence (<0.6) → no score, retake while the window is open | `finalOutcome`, `apply_verdict` |
| Our outage is never the user's penalty: errored proofs are retried, then excused | `cron-tick`, `excuse_target` |
| Live capture only: no gallery code at all; a 3-min capture session per proof, single use, JPEG only | `start-proof`, `verify-proof` |
| Premium checked on the server for every proof (RevenueCat webhook row, else RevenueCat API) | `hasPremium` |
| Clients can't write points, streaks, targets, proofs, entitlements | column grants + RLS |
| API keys never in the app | function secrets only |

## Run it

```bash
npm install
cp .env.example .env            # fill in, or set EXPO_PUBLIC_DEMO=1 to try with fixture data
npx expo start                  # demo mode works in Expo Go
```

Native modules (camera, glass, RevenueCat, Apple sign-in, R3F/expo-gl) need a **development build**:

```bash
npx eas-cli@latest build --profile development --platform ios
```

Liquid Glass renders only on **iOS 26+**; older iOS, Android and Reduce Transparency get opaque surfaces (never fake glass). Every tap fires a haptic.

## Set up the backend (once)

1. **Supabase project** → `supabase link --project-ref …` → `supabase db push` (applies `supabase/migrations`).
2. **Auth:** enable Email (6-digit OTP — edit the “Magic Link” email template to show `{{ .Token }}`) and Apple (client ID = iOS bundle id `app.noexcuse.ios`).
3. **Function secrets:** copy `supabase/functions/.env.example` → `.env`, fill in, `supabase secrets set --env-file supabase/functions/.env`.
4. **Deploy functions:** `supabase functions deploy` (JWT settings come from `supabase/config.toml`).
5. **Cron:** run `supabase/sql/schedule_cron.sql` in the SQL editor (puts the URL + secret in Vault, schedules `cron-tick` every minute).
6. **RevenueCat:**
   - App Store Connect: auto-renewable subscription, €9.99 / 1 month, introductory offer *Free · 3 days*.
   - RevenueCat: product → entitlement **`premium`** → offering **`default`** (monthly package).
   - Webhook → `https://<ref>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header = `REVENUECAT_WEBHOOK_AUTH`.
7. **Push:** `npx eas-cli@latest init` (writes the EAS projectId into `app.json` › `extra.eas.projectId`), then `eas credentials` for the APNs key.
8. **Legal:** publish a privacy policy and set `EXPO_PUBLIC_PRIVACY_URL`; replace `EXPO_PUBLIC_TERMS_URL` if you use your own terms.

## Checks

```bash
npm run typecheck                         # TypeScript
npx eslint src                            # Expo lint config
npm run test:functions                    # Deno unit tests (needs deno)
PGHOST=… PGPORT=… PGUSER=postgres npm run test:db   # database tests on any Postgres 15+
npx expo export --platform ios            # production JS bundle
```

## Status

| Area | State |
|---|---|
| Database schema, RLS, scoring, scheduling, Arena, stats | **Tested** — 40 checks + 13 must-fail checks (permissions, invalid input, late proof) on PostgreSQL 16 |
| Edge function logic (window, capture sessions, AI parsing, RevenueCat parsing, webhook auth) | **Tested** — 14 Deno unit tests; all 6 functions type-check |
| App UI (all Figma screens + states), navigation, demo data | **Built and visually checked** in a web build at 320, 390 and 820 pt; full proof flow clicked through end to end |
| App TypeScript / lint / iOS production bundle | **Pass** |
| Against real Supabase, OpenAI, RevenueCat, APNs, iPhone hardware | **Not yet run** — needs your accounts/keys (steps above) |
| Liquid Glass look on iOS 26 | **Not seen yet** — only renders on device/simulator |
| AI model choice and prompt quality on real photos | **Needs tuning** with real proofs before launch |
