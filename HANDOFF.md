# NoExcuse — status (Oct 22, 2026)

Read README.md first: structure, product rules, setup steps, checks.

## Done
- **Figma:** file “NoExcuse — iOS App” (Foundations, Components, Screens), built Oct 21.
- **Database:** migrations for schema, RLS, scoring, scheduling, Arena and stats. Tested on Postgres 16 (`npm run test:db`): 40 checks pass, plus 13 checks that must fail (permissions, invalid input, late proof).
- **Edge functions:** start-proof, verify-proof, refresh-entitlement, revenuecat-webhook, cron-tick and delete-account. All type-check, and 14 Deno unit tests pass.
- **App (Expo SDK 58):** all screens A–I with every state.
  - Native Liquid Glass with a fallback, NativeTabs, haptics on every tap.
  - Live camera (no gallery) and the RevenueCat paywall with live price and trial eligibility.
  - Push routing, account deletion, and the 3D emblem (React Three Fiber).
  - TypeScript, lint and the iOS production bundle all pass.
  - Checked visually in a demo web build at 320, 390 and 820 pt widths. The full proof flow was clicked through: camera → preview → submit → verdict → Home updates.

## Next (needs the owner's accounts)
1. Supabase project: `db push`, auth providers, secrets, deploy functions, run `supabase/sql/schedule_cron.sql`.
2. App Store Connect: subscription €9.99 with a 3-day free trial; RevenueCat entitlement `premium`, offering `default`, webhook.
3. `eas init` (projectId for push), APNs key, `eas build --profile development`, then test on an iOS 26 iPhone.
4. Tune `OPENAI_MODEL` and the prompt on 20–30 real proof photos (verified, rejected and borderline).
5. Publish the privacy policy URL and set the bundle id if it isn't `app.noexcuse.ios`.

## Notes
- If the network blocks the Expo API, install packages with `EXPO_OFFLINE=1 npx expo install …`.
- Demo mode: `EXPO_PUBLIC_DEMO=1`. On web, `?gate=signedout` or `?gate=paywall` previews those screens. It works in Expo Go and never talks to the backend.
- `expo-doctor`: 18/20 checks pass here. The other 2 need the Expo API, which this environment can't reach.
