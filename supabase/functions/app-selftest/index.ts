// Internal end-to-end test of the Phase 7 features against the REAL project, as real signed-in users.
// POST with the Vault cron secret. Creates two confirmed throw-away users (…@example.com, no e-mail is sent),
// runs every flow through the same public APIs the app uses (REST with the user's JWT, Storage, RPCs, the
// privacy function), checks the results, and deletes both users and their files at the end — even on failure.
// The only service-role writes are the setup (users) and a points fixture for the ranking check.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { adminClient, env, json } from "../_shared/http.ts";
import { isInternal } from "../_shared/internal.ts";

const JPEG_A = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyeiiigD//2Q==";
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const hm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

type Check = { name: string; ok: boolean; detail?: string };

Deno.serve(async (req) => {
  const admin = adminClient();
  if (!(await isInternal(req, admin))) return json(401, { error: "unauthorized" });

  const url = env("SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY");
  const checks: Check[] = [];
  const ok = (name: string, cond: unknown, detail?: unknown) => {
    checks.push({ name, ok: !!cond, ...(cond ? {} : { detail: typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 300) }) });
  };
  const created: string[] = [];
  const tz = "Europe/Bucharest";

  async function makeUser(name: string): Promise<{ id: string; db: SupabaseClient; token: string }> {
    const email = `noexcuse-e2e-${rnd()}@example.com`;
    const password = `E2e-${rnd()}-${rnd()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    created.push(data.user.id);
    const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const s = await db.auth.signInWithPassword({ email, password });
    if (s.error || !s.data.session) throw new Error(`signIn: ${s.error?.message}`);
    return { id: data.user.id, db, token: s.data.session.access_token };
  }
  const privacy = async (token: string, body: unknown) => {
    const r = await fetch(`${url}/functions/v1/privacy`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: anon }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null };
  };

  try {
    const A = await makeUser(`E2E Alpha ${rnd().slice(0, 4)}`);
    const B = await makeUser(`E2E Beta ${rnd().slice(0, 4)}`);
    const aName = `E2E Alpha ${rnd().slice(0, 6)}`;
    {
      const r = await A.db.from("profiles").update({ timezone: tz, display_name: aName }).eq("id", A.id).select("id");
      ok("profile: user updates own time zone and name", !r.error && r.data?.length === 1, r.error);
    }

    // ---------------- TASKS ----------------
    const ins = await A.db.from("habits").insert({ user_id: A.id, title: "E2E gym", target_time: "07:13:00", weekdays: [1, 2, 3, 4, 5, 6, 7], category: "fitness", proof_hint: "me at the rack" })
      .select("id, target_time").single();
    ok("task: create with exact time 07:13", !ins.error && ins.data?.target_time === "07:13:00", ins.error ?? ins.data);
    const hid = ins.data!.id as string;

    const upd = await A.db.from("habits").update({ target_time: "21:47:00" }).eq("id", hid).select("id");
    ok("task: edit time to 21:47 (row updated)", !upd.error && upd.data?.length === 1, upd.error);
    // Fresh session = what a refresh sees.
    const fresh = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${A.token}` } }, auth: { persistSession: false } });
    const back = await fresh.from("habits").select("title, target_time, weekdays, category, proof_hint, is_active").eq("id", hid).single();
    ok("task: time persists after reload (21:47:00)", back.data?.target_time === "21:47:00", back.data ?? back.error);
    ok("task: editing time kept title, days, category, proof hint", back.data?.title === "E2E gym" && back.data?.weekdays?.length === 7
      && back.data?.category === "fitness" && back.data?.proof_hint === "me at the rack", back.data);
    const tg = await fresh.from("targets").select("due_at, status").eq("habit_id", hid).eq("status", "pending").order("due_at");
    const times = (tg.data ?? []).map((t) => hm(t.due_at as string, tz));
    ok("task: upcoming windows rescheduled at 21:47 Bucharest time (no UTC shift)", times.length > 0 && times.every((x) => x === "21:47"), times);

    const bTry = await B.db.from("habits").update({ target_time: "05:00:00" }).eq("id", hid).select("id");
    ok("ownership: another user cannot edit the task", !bTry.error && bTry.data?.length === 0, bTry.data ?? bTry.error);

    const arc = await A.db.from("habits").update({ archived_at: new Date().toISOString() }).eq("id", hid).select("archived_at, is_active").single();
    ok("task: archive", !arc.error && !!arc.data?.archived_at && arc.data?.is_active === false, arc.error ?? arc.data);
    const pend = await fresh.from("targets").select("id").eq("habit_id", hid).eq("status", "pending");
    ok("task: archived task has no upcoming windows", (pend.data ?? []).length === 0, pend.data);
    const res = await A.db.from("habits").update({ archived_at: null }).eq("id", hid).select("archived_at, is_active").single();
    ok("task: restore (comes back paused)", !res.error && res.data?.archived_at === null && res.data?.is_active === false, res.error ?? res.data);
    const persisted = await fresh.from("habits").select("archived_at, target_time").eq("id", hid).single();
    ok("task: restore persists after reload, time intact", persisted.data?.archived_at === null && persisted.data?.target_time === "21:47:00", persisted.data);

    const bDel = await privacy(B.token, { action: "delete_commitment", habit_id: hid });
    ok("ownership: another user cannot delete the task (404)", bDel.status === 404, bDel);
    const del = await privacy(A.token, { action: "delete_commitment", habit_id: hid });
    ok("task: permanent delete", del.status === 200 && (del.body?.mode === "erased" || del.body?.mode === "removed"), del);
    const gone = await fresh.from("habits").select("id").eq("id", hid);
    ok("task: deleted task is gone after reload", (gone.data ?? []).length === 0, gone.data);
    const del2 = await privacy(A.token, { action: "delete_commitment", habit_id: hid });
    ok("task: second delete is refused (no double deletion)", del2.status === 404, del2);
    const dbRow = await admin.from("habits").select("id").eq("id", hid);
    ok("task: never-settled task is erased from the database", (dbRow.data ?? []).length === 0, dbRow.data);

    // ---------------- CHALLENGES ----------------
    const today = new Date().toISOString().slice(0, 10);
    const mk = async (status: string) => (await admin.from("challenges").insert({ user_id: A.id, title: `E2E ${status}`, start_date: today, end_date: today,
      weekdays: [1, 2, 3, 4, 5, 6, 7], required_days: 1, bonus_points: 0, status }).select("id").single()).data!.id as string;
    const abandoned = await mk("abandoned");
    const dc = await A.db.rpc("delete_challenge", { p_id: abandoned });
    const dcGone = await admin.from("challenges").select("id").eq("id", abandoned);
    ok("challenge: abandoned challenge deleted", !dc.error && (dcGone.data ?? []).length === 0, dc.error);
    const bc = await mk("failed");
    const bcTry = await B.db.rpc("delete_challenge", { p_id: bc });
    ok("ownership: another user cannot delete the challenge", !!bcTry.error, bcTry);

    // ---------------- PROFILE PHOTO ----------------
    const p1 = `${A.id}/${rnd()}.jpg`;
    const up1 = await A.db.storage.from("avatars").upload(p1, bytes(JPEG_A), { contentType: "image/jpeg" });
    const set1 = await A.db.rpc("set_avatar", { p_path: p1 });
    ok("photo: upload and set", !up1.error && !set1.error && set1.data === null, up1.error ?? set1.error);
    const pub = await fetch(`${url}/storage/v1/object/public/avatars/${p1}`);
    ok("photo: visible at its public URL", pub.status === 200 && (pub.headers.get("content-type") ?? "").startsWith("image/jpeg"), pub.status);
    await pub.arrayBuffer().catch(() => {});

    const bUp = await B.db.storage.from("avatars").upload(`${A.id}/${rnd()}.jpg`, bytes(JPEG_A), { contentType: "image/jpeg" });
    ok("photo: another user cannot write into my folder", !!bUp.error, bUp.data);
    const bSet = await B.db.rpc("set_avatar", { p_path: p1 });
    ok("photo: another user cannot point their profile at my file", !!bSet.error, bSet.data);
    const bad = await A.db.storage.from("avatars").upload(`${A.id}/${rnd()}.jpg`, new TextEncoder().encode("not an image"), { contentType: "text/plain" });
    ok("photo: non-image type rejected", !!bad.error, bad.data);
    const big = await A.db.storage.from("avatars").upload(`${A.id}/${rnd()}.jpg`, new Uint8Array(2_200_000), { contentType: "image/jpeg" });
    ok("photo: file over 2 MB rejected", !!big.error, big.data);

    const p2 = `${A.id}/${rnd()}.jpg`;
    await A.db.storage.from("avatars").upload(p2, bytes(JPEG_A), { contentType: "image/jpeg" });
    const set2 = await A.db.rpc("set_avatar", { p_path: p2 });
    ok("photo: replace returns the old file", set2.data === p1, set2.data ?? set2.error);
    await A.db.storage.from("avatars").remove([p1]);
    const old = await admin.storage.from("avatars").list(A.id);
    ok("photo: old file removed after replace", !(old.data ?? []).some((o) => `${A.id}/${o.name}` === p1) && (old.data ?? []).some((o) => `${A.id}/${o.name}` === p2), (old.data ?? []).map((o) => o.name));

    // ---------------- ARENA ----------------
    // Points fixture (service role): A gets 120 this week and 900 all-time, B gets 40 this week and 1600 all-time.
    const fixture = async (uid: string, week: number, total: number) => {
      const h = (await admin.from("habits").insert({ user_id: uid, title: "E2E ranking", target_time: "09:00:00", weekdays: [1], is_active: false }).select("id").single()).data!.id;
      const t = (await admin.from("targets").insert({ habit_id: h, user_id: uid, local_date: today, due_at: new Date().toISOString(), status: "verified" }).select("id").single()).data!.id;
      await admin.from("score_events").insert({ user_id: uid, habit_id: h, target_id: t, delta: week, reason: "verified", streak_after: 1 });
      await admin.from("profiles").update({ total_points: total }).eq("id", uid);
    };
    await fixture(A.id, 120, 900);
    await fixture(B.id, 40, 1600);

    type Row = Record<string, unknown>;
    const board = async (db: SupabaseClient, q: Record<string, unknown>) =>
      (await db.rpc("get_arena_board", { p_period: "week", p_sort: "points", p_search: null, p_scope: "all", p_offset: 0, p_limit: 20, ...q })).data as { total: number; rows: Row[]; me: Row } | null;

    const wk = await board(B.db, { p_search: "E2E" });
    const rowA = wk?.rows.find((r) => r.user_id === A.id);
    const rowB = wk?.rows.find((r) => r.user_id === B.id);
    ok("arena: real registered users listed (both test users)", !!rowA && !!rowB, wk);
    ok("arena: weekly ranking A (120) above B (40)", !!rowA && !!rowB && rowA.points === 120 && rowB.points === 40 && (rowA.rank as number) < (rowB.rank as number), [rowA, rowB]);
    const all = await board(B.db, { p_period: "all", p_search: "E2E" });
    const allA = all?.rows.find((r) => r.user_id === A.id), allB = all?.rows.find((r) => r.user_id === B.id);
    ok("arena: all-time ranking B (1600) above A (900), levels 4 and 3", !!allA && !!allB && (allB.rank as number) < (allA.rank as number) && allB.level === 4 && allA.level === 3, [allA, allB]);
    const mo = await board(B.db, { p_period: "month", p_search: "E2E" });
    ok("arena: monthly ranking counts this month", mo?.rows.find((r) => r.user_id === A.id)?.points === 120, mo?.rows);
    ok("arena: photo shown on the board", rowA?.avatar_path === p2, rowA);
    ok("arena: no e-mail in any row", !JSON.stringify(wk).includes("@example.com") && !JSON.stringify(wk).toLowerCase().includes("email"), "email found");
    const s1 = await board(B.db, { p_search: aName });
    ok("arena: search by name", s1?.rows.length === 1 && s1.rows[0].user_id === A.id, s1?.rows);
    const pg1 = await board(B.db, { p_search: "E2E", p_limit: 1 });
    const pg2 = await board(B.db, { p_search: "E2E", p_limit: 1, p_offset: 1 });
    ok("arena: pagination (1 per page)", pg1?.rows.length === 1 && pg2?.rows.length === 1 && pg1.rows[0].user_id !== pg2.rows[0].user_id && (pg1.total ?? 0) >= 2, [pg1?.total, pg1?.rows[0]?.user_id, pg2?.rows[0]?.user_id]);

    await A.db.from("profiles").update({ show_streak: false }).eq("id", A.id);
    const ss = await board(B.db, { p_search: aName });
    ok("privacy: hidden streak is not exposed", ss?.rows[0] && ss.rows[0].streak === null, ss?.rows);
    await A.db.from("profiles").update({ arena_visible: false }).eq("id", A.id);
    const hid2 = await board(B.db, { p_search: "E2E" });
    ok("privacy: hidden profile disappears from the Arena", !hid2?.rows.some((r) => r.user_id === A.id) && hid2?.rows.some((r) => r.user_id === B.id), hid2?.rows.map((r) => r.user_id));
    const meHidden = await board(A.db, {});
    ok("privacy: hidden user still sees own points, unranked", meHidden?.me?.hidden === true && meHidden.me.points === 120, meHidden?.me);
    const anonBoard = await createClient(url, anon, { auth: { persistSession: false } }).rpc("get_arena_board", {});
    ok("privacy: Arena needs sign-in", !!anonBoard.error, anonBoard.data);

    const rm = await A.db.rpc("remove_avatar");
    await A.db.storage.from("avatars").remove([rm.data as string]);
    const prof = await fresh.from("profiles").select("avatar_path").eq("id", A.id).single();
    ok("photo: remove", rm.data === p2 && prof.data?.avatar_path === null, [rm.data, prof.data]);
  } catch (e) {
    ok("run completed without exceptions", false, e instanceof Error ? e.message : String(e));
  } finally {
    for (const id of created) {
      const files = await admin.storage.from("avatars").list(id);
      if (files.data?.length) await admin.storage.from("avatars").remove(files.data.map((f) => `${id}/${f.name}`));
      await admin.auth.admin.deleteUser(id);
    }
    const left = await admin.from("profiles").select("id").in("id", created.length ? created : ["00000000-0000-0000-0000-000000000000"]);
    ok("cleanup: test users and their data removed", (left.data ?? []).length === 0, left.data);
  }

  const failed = checks.filter((c) => !c.ok);
  return json(200, { passed: checks.length - failed.length, failed: failed.length, checks });
});
