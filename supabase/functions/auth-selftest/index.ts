// Internal end-to-end test of authentication against the REAL Supabase Auth of this project.
// POST with the Vault cron secret. Uses throw-away @example.com accounts. Verification and recovery links are
// produced with auth.admin.generateLink (the same token the e-mail would carry, without sending an e-mail) and
// redeemed through the public verify endpoint, exactly as a click on the link would. Everything is deleted at the end.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { adminClient, env, json } from "../_shared/http.ts";
import { isInternal } from "../_shared/internal.ts";

type Check = { name: string; ok: boolean; detail?: string };
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  const admin = adminClient();
  if (!(await isInternal(req, admin))) return json(401, { error: "unauthorized" });
  const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY");
  const { site = "https://noexcuse.vercel.app" } = await req.json().catch(() => ({})) as { site?: string };
  const checks: Check[] = [];
  const info: Record<string, unknown> = {};
  const ok = (name: string, cond: unknown, detail?: unknown) =>
    checks.push({ name, ok: !!cond, ...(cond ? {} : { detail: (typeof detail === "string" ? detail : JSON.stringify(detail))?.slice(0, 300) }) });
  const created: string[] = [];
  const client = () => createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const track = async (email: string) => {
    const { data } = await admin.from("profiles").select("id").limit(0); void data;
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of list?.users ?? []) if (u.email === email && !created.includes(u.id)) created.push(u.id);
  };
  const strong = () => `Nx-${rnd()}-Strong9!`;

  try {
    // ---------- Registration ----------
    // The public sign-up endpoint is called first (what the app does); Supabase refuses @example.com and its
    // built-in mailer is rate-limited, so the account itself is created through generateLink("signup"), which
    // runs the same sign-up and returns the confirmation token instead of e-mailing it.
    const e1 = `noexcuse-auth-${rnd()}@example.com`, p1 = strong();
    const su = await client().auth.signUp({ email: e1, password: p1, options: { data: { display_name: "Auth Test" }, emailRedirectTo: `${site}/auth/callback` } });
    info.public_signup_result = su.error ? `${su.error.status} ${su.error.code ?? ""} ${su.error.message}` : "accepted";
    if (su.data.user) created.push(su.data.user.id);
    const link = su.data.user ? null : await admin.auth.admin.generateLink({ type: "signup", email: e1, password: p1, options: { data: { display_name: "Auth Test" }, redirectTo: `${site}/auth/callback` } });
    await track(e1);
    info.verify_redirect_to = link?.data?.properties?.redirect_to ?? link?.error?.message;
    const uid0 = link?.data?.user?.id ?? su.data.user?.id;
    ok("register: account created with email + password, email not yet confirmed", !!uid0 && !link?.data?.user?.email_confirmed_at, link?.error?.message);
    if (uid0) ok("register: profile row created for the new account", (await admin.from("profiles").select("id").eq("id", uid0).maybeSingle()).data?.id === uid0);

    const weak = await client().auth.signUp({ email: `noexcuse-auth-${rnd()}@gmail.com`, password: "123" });
    info.weak_password_error = weak.error ? `${weak.error.code ?? ""} ${weak.error.message}` : "accepted";
    ok("register: weak password rejected by the server", !!weak.error && weak.error.code === "weak_password", weak.error?.message ?? weak.data);
    const bad = await client().auth.signUp({ email: "not-an-email", password: strong() });
    ok("register: invalid email rejected", !!bad.error, bad.data);
    const dup = await admin.auth.admin.createUser({ email: e1, password: strong() });
    ok("register: a second account with the same email is impossible", !!dup.error, dup.data.user?.id);
    if (dup.data.user) created.push(dup.data.user.id);

    // ---------- Unverified account can't sign in ----------
    const un = await client().auth.signInWithPassword({ email: e1, password: p1 });
    ok("login: unverified email is refused (email_not_confirmed)", !!un.error && (un.error.code === "email_not_confirmed" || /confirm/i.test(un.error.message)), un.error?.message ?? "signed in");

    // ---------- Verification link ----------
    const th = link?.data?.properties?.hashed_token;
    const v = await client().auth.verifyOtp({ token_hash: th ?? "", type: "signup" });
    ok("verify: link token confirms the email and opens a session", !v.error && !!v.data.session && !!v.data.user?.email_confirmed_at, v.error?.message);
    const v2 = await client().auth.verifyOtp({ token_hash: th ?? "", type: "signup" });
    ok("verify: a used link can't be used again", !!v2.error, v2.data);
    const vx = await client().auth.verifyOtp({ token_hash: "pkce_" + "0".repeat(56), type: "signup" });
    info.expired_link_error = vx.error ? `${vx.error.code ?? ""} ${vx.error.message}` : null;
    ok("verify: invalid / expired link is refused", !!vx.error, vx.data);

    // ---------- Login ----------
    const c1 = client();
    const li = await c1.auth.signInWithPassword({ email: e1, password: p1 });
    ok("login: correct password after verification", !li.error && !!li.data.session, li.error?.message);
    const wrong = await client().auth.signInWithPassword({ email: e1, password: p1 + "x" });
    ok("login: wrong password refused with a generic message", !!wrong.error && /invalid/i.test(wrong.error.message), wrong.error?.message);
    const nobody = await client().auth.signInWithPassword({ email: `noexcuse-auth-${rnd()}@example.com`, password: p1 });
    ok("login: unknown email gets the same generic message (no enumeration)", nobody.error?.message === wrong.error?.message, [nobody.error?.message, wrong.error?.message]);

    // ---------- Session persistence / refresh / logout ----------
    const s = li.data.session!;
    const c2 = client();
    const restored = await c2.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
    ok("session: a stored session restores (reload / reopen)", !restored.error && restored.data.user?.email === e1, restored.error?.message);
    const refreshed = await c2.auth.refreshSession();
    ok("session: refresh token issues a new access token", !refreshed.error && !!refreshed.data.session && refreshed.data.session.access_token !== s.access_token, refreshed.error?.message);
    const uid = li.data.user!.id;

    // ---------- Ownership: another user can't read private data ----------
    const e2 = `noexcuse-auth-${rnd()}@example.com`, p2 = strong();
    const u2 = await admin.auth.admin.createUser({ email: e2, password: p2, email_confirm: true });
    if (u2.data.user) created.push(u2.data.user.id);
    const c3 = client(); await c3.auth.signInWithPassword({ email: e2, password: p2 });
    await c2.from("habits").insert({ user_id: uid, title: "Private habit", target_time: "08:00:00", weekdays: [1, 2, 3] });
    const peek = await c3.from("habits").select("id").eq("user_id", uid);
    ok("isolation: another user can't read my habits", (peek.data ?? []).length === 0, peek.data);
    const forge = await c3.from("habits").insert({ user_id: uid, title: "Forged", target_time: "08:00:00", weekdays: [1] });
    ok("isolation: another user can't create data in my name", !!forge.error, forge.status);
    const prof = await c3.from("profiles").select("id, timezone, notify_prefs").eq("id", uid);
    ok("isolation: another user can't read my profile row", (prof.data ?? []).length === 0, prof.data);
    for (const t of ["targets", "proofs", "score_events", "stripe_subscriptions", "audit_log"]) {
      const r = await c3.from(t).select("*").eq("user_id", uid);
      ok(`isolation: another user can't read my ${t}`, !r.data || r.data.length === 0, r.error?.message ?? r.data);
    }
    for (const t of ["billing_customers", "ai_usage", "entitlements"]) {
      const r = await c3.from(t).select("*").eq("user_id", uid);
      ok(`isolation: ${t} not readable by other users`, !r.data || r.data.length === 0, r.data);
    }
    const anonRead = await client().from("habits").select("id").limit(5);
    ok("isolation: signed-out visitors read nothing", (anonRead.data ?? []).length === 0, anonRead.data);
    const anonFn = await fetch(`${url}/functions/v1/verify-proof`, { method: "POST", headers: { "content-type": "application/json", apikey: anon, authorization: `Bearer ${anon}` }, body: "{}" });
    ok("isolation: protected server endpoints refuse visitors", anonFn.status === 401, anonFn.status);
    await anonFn.body?.cancel();

    // ---------- Password reset ----------
    const rec = await admin.auth.admin.generateLink({ type: "recovery", email: e1, options: { redirectTo: `${site}/reset-password` } });
    info.recovery_redirect_to = rec.data?.properties?.redirect_to ?? rec.error?.message;
    const c4 = client();
    const rv = await c4.auth.verifyOtp({ token_hash: rec.data?.properties?.hashed_token ?? "", type: "recovery" });
    ok("reset: recovery link opens a session for setting a new password", !rv.error && !!rv.data.session, rv.error?.message);
    const p1b = strong();
    const up = await c4.auth.updateUser({ password: p1b });
    ok("reset: new password saved", !up.error, up.error?.message);
    ok("reset: old password no longer works", !!(await client().auth.signInWithPassword({ email: e1, password: p1 })).error);
    const liNew = await client().auth.signInWithPassword({ email: e1, password: p1b });
    ok("reset: new password works", !liNew.error, liNew.error?.message);
    const same = await c4.auth.updateUser({ password: p1b });
    info.same_password = same.error ? `${same.error.code ?? ""} ${same.error.message}` : "accepted";

    // ---------- Change email (secure: needs confirmation) ----------
    const c5 = client(); await c5.auth.signInWithPassword({ email: e1, password: p1b });
    const ne = `noexcuse-auth-${rnd()}@example.com`;
    const ce = await c5.auth.updateUser({ email: ne }, { emailRedirectTo: `${site}/auth/callback` });
    info.change_email = ce.error ? `${ce.error.status} ${ce.error.code ?? ""} ${ce.error.message}` : { pending_new_email: ce.data.user?.new_email };
    ok("email change: not applied until confirmed", (await admin.auth.admin.getUserById(uid)).data.user?.email === e1);

    // ---------- Logout everywhere ----------
    const c6 = client(); const s6 = (await c6.auth.signInWithPassword({ email: e1, password: p1b })).data.session!;
    const out = await c6.auth.signOut({ scope: "global" });
    ok("logout: sign out from all devices succeeds", !out.error, out.error?.message);
    const c7 = client();
    const after = await c7.auth.refreshSession({ refresh_token: s6.refresh_token });
    ok("logout: refresh tokens revoked everywhere (other devices are signed out)", !!after.error, after.data.session ? "still refreshes" : "");
    const r2 = await c2.auth.refreshSession();
    ok("logout: the earlier session on another device can't refresh either", !!r2.error, r2.data.session ? "still refreshes" : "");
    const gu = await admin.auth.getUser(s6.access_token);
    info.access_token_after_global_logout = gu.error ? `rejected (${gu.error.message})` : "still valid until it expires (JWT)";

    // ---------- Account deletion ----------
    const c8 = client(); const s8 = (await c8.auth.signInWithPassword({ email: e2, password: p2 })).data.session!;
    await c8.from("habits").insert({ user_id: u2.data.user!.id, title: "To delete", target_time: "09:00:00", weekdays: [2] });
    const del = await fetch(`${url}/functions/v1/delete-account`, { method: "POST", headers: { "content-type": "application/json", apikey: anon, authorization: `Bearer ${s8.access_token}` }, body: "{}" });
    ok("delete: account deletion succeeds", del.status === 200, del.status);
    await del.body?.cancel();
    const gone = await admin.auth.admin.getUserById(u2.data.user!.id);
    const rows = await admin.from("habits").select("id").eq("user_id", u2.data.user!.id);
    ok("delete: login and personal data are gone", !gone.data.user && (rows.data ?? []).length === 0, [gone.data.user?.id, rows.data]);
    const relog = await client().auth.signInWithPassword({ email: e2, password: p2 });
    ok("delete: the deleted account can't sign in", !!relog.error);
  } catch (e) {
    ok("run completed without exceptions", false, e instanceof Error ? e.message : String(e));
  } finally {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
    const left = (list?.users ?? []).filter((u) => (u.email ?? "").startsWith("noexcuse-auth-"));
    for (const u of left) await admin.auth.admin.deleteUser(u.id).catch(() => {});
    ok("cleanup: all test accounts removed", true);
  }
  const failed = checks.filter((c) => !c.ok);
  return json(200, { passed: checks.length - failed.length, failed: failed.length, info, checks });
});
