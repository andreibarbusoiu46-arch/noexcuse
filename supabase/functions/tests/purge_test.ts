// Regression tests: "Delete all my evidence" (privacy) and account deletion storage clean-up.
import nodeAssert from "node:assert/strict";
import { type EvidenceRow, purgeEvidence, type PurgeDeps } from "../_shared/evidencePurge.ts";
import { type AccountPurgeDeps, listAllPaths, purgeAccountStorage } from "../_shared/accountPurge.ts";

const assert = (v: unknown, msg = "assertion failed") => nodeAssert.ok(v, msg);
const eq = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);
const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`; // ordered like Postgres uuids

/** In-memory stand-in for evidence_for_user_deletion_page + storage + mark_evidence_deleted. */
function fakeEvidence(n: number, isKept: (i: number) => boolean, opts: { removeFailsOnCall?: number; markFailsOnCall?: number; readFailsOnPage?: number; apiCap?: number } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ proof_id: uid(i + 1), paths: [`${USER}/t${i}/p${i}.jpg`, `${USER}/t${i}/p${i}-2.jpg`], kept: isKept(i), deleted: false }));
  const stored = new Set(rows.flatMap((r) => r.paths));
  let removeCalls = 0, markCalls = 0, pageCalls = 0;
  const removed: string[] = [];
  const deps: PurgeDeps = {
    page: (after, limit) => {
      pageCalls++;
      if (opts.readFailsOnPage === pageCalls) return Promise.resolve({ error: "read failed" });
      const out: typeof rows = [];
      for (const r of rows) { if (!r.deleted && (after === null || r.proof_id > after)) out.push(r); if (out.length >= Math.min(limit, opts.apiCap ?? 1000)) break; }
      const page = out
        .map(({ proof_id, paths, kept }) => ({ proof_id, paths, kept }) as EvidenceRow);
      return Promise.resolve({ rows: page });
    },
    remove: (paths) => {
      removeCalls++;
      if (opts.removeFailsOnCall === removeCalls) return Promise.resolve("storage unavailable");
      for (const p of paths) { stored.delete(p); removed.push(p); }
      return Promise.resolve(null);
    },
    mark: (ids) => {
      markCalls++;
      if (opts.markFailsOnCall === markCalls) return Promise.resolve({ error: "db down" });
      let c = 0;
      const want = new Set(ids);
      for (const r of rows) if (want.has(r.proof_id) && !r.deleted) { r.deleted = true; c++; }
      return Promise.resolve({ count: c });
    },
  };
  return { rows, stored, removed, deps, calls: () => ({ removeCalls, markCalls, pageCalls }), opts };
}
const prefix = { pathPrefix: `${USER}/` };
const deletableLeft = (f: ReturnType<typeof fakeEvidence>) => f.rows.filter((r) => !r.kept && !r.deleted).length;
const deletablePhotosLeft = (f: ReturnType<typeof fakeEvidence>) => f.rows.filter((r) => !r.kept).flatMap((r) => r.paths).filter((p) => f.stored.has(p)).length;

Deno.test("evidence purge: more than 1,000 records with the first 1,000 all kept — everything after them is still deleted", async () => {
  const f = fakeEvidence(1200, (i) => i < 1000);
  const r = await purgeEvidence(f.deps, prefix);
  eq(r.status, "complete");
  eq([r.deleted, r.kept, r.scanned], [200, 1000, 1200]);
  eq(deletableLeft(f), 0); eq(deletablePhotosLeft(f), 0);
  eq(f.rows.filter((x) => x.kept).flatMap((x) => x.paths).filter((p) => !f.stored.has(p)).length, 0, "no kept photo was removed");
});

Deno.test("evidence purge: the previous algorithm (re-read until a page has nothing deletable) misses those photos", async () => {
  // Reproduces the bug this replaces, against the same data, so the regression is visible.
  const f = fakeEvidence(1200, (i) => i < 1000);
  let deleted = 0;
  for (let round = 0; round < 50; round++) {
    const res = await f.deps.page(null, 1000);
    if ("error" in res) break;
    const go = res.rows.filter((x) => !x.kept);
    if (go.length) { await f.deps.remove(go.flatMap((x) => x.paths)); deleted += ((await f.deps.mark(go.map((x) => x.proof_id))) as { count: number }).count; }
    if (res.rows.length < 1000 || go.length === 0) break;
  }
  eq(deleted, 0); eq(deletableLeft(f), 200, "200 deletable photos left behind by the old loop");
});

Deno.test("evidence purge: >1,000 mixed records — counts are exact across pages and batches", async () => {
  const f = fakeEvidence(2345, (i) => i % 3 === 0); // 782 kept, 1563 deletable
  const r = await purgeEvidence(f.deps, { ...prefix, pageSize: 500, batchSize: 100 });
  eq(r.status, "complete");
  eq([r.deleted, r.kept, r.scanned], [1563, 782, 2345]);
  eq(r.pages, 6, "5 pages of up to 500, then the empty page that proves the end");
  eq(f.calls().removeCalls, Math.ceil(334 / 100) * 4 + Math.ceil(227 / 100), "batched per page, never more than 100 proofs per storage call");
  eq(deletableLeft(f), 0); eq(deletablePhotosLeft(f), 0);
  eq(new Set(f.removed).size, f.removed.length, "no path removed twice");
});

Deno.test("evidence purge: more than the 50,000-record safety limit → explicit incomplete, never success; a second run finishes", async () => {
  const f = fakeEvidence(50_001, () => false);
  const r = await purgeEvidence(f.deps, prefix); // defaults: 100 pages × 500
  eq(r.status, "incomplete");
  assert(r.status === "incomplete" && r.reason === "limit");
  eq([r.deleted, r.kept, r.scanned], [50_000, 0, 50_000]);
  eq(deletableLeft(f), 1, "one record beyond the limit is still there, and was reported as remaining");
  const again = await purgeEvidence(f.deps, prefix);
  eq(again.status, "complete"); eq(again.deleted, 1); eq(deletableLeft(f), 0);
});

Deno.test("evidence purge: exactly at the page boundary of the limit is still reported as incomplete (cannot prove nothing is left)", async () => {
  const f = fakeEvidence(1000, () => false);
  const r = await purgeEvidence(f.deps, { ...prefix, pageSize: 500, maxPages: 2 });
  eq(r.status, "incomplete", "2 full pages used the whole limit before an empty page was seen");
  eq(r.deleted, 1000);
  const again = await purgeEvidence(f.deps, { ...prefix, pageSize: 500, maxPages: 2 });
  eq(again.status, "complete"); eq(again.deleted, 0); eq(again.pages, 1); eq(deletableLeft(f), 0);
});

Deno.test("evidence purge: a storage failure stops with storage_error; counts include only finished batches; a retry completes", async () => {
  const f = fakeEvidence(1500, (i) => i % 4 === 0, { removeFailsOnCall: 3 }); // 375 kept, 1125 deletable
  const r = await purgeEvidence(f.deps, { ...prefix, pageSize: 500, batchSize: 100 });
  eq(r.status, "incomplete");
  assert(r.status === "incomplete" && r.reason === "storage_error");
  eq(r.deleted, 200, "two batches of 100 finished before the third storage call failed");
  eq(r.kept, 125, "kept counted for the page being processed");
  eq(f.calls().markCalls, 2, "the failed batch is not marked deleted (its photos may still exist)");
  f.opts.removeFailsOnCall = undefined;
  const again = await purgeEvidence(f.deps, { ...prefix, pageSize: 500, batchSize: 100 });
  eq(again.status, "complete");
  eq(r.deleted + again.deleted, 1125, "total deleted across both runs is exact");
  eq(again.kept, 375);
  eq(deletableLeft(f), 0); eq(deletablePhotosLeft(f), 0);
});

Deno.test("evidence purge: read and bookkeeping failures are incomplete, never success", async () => {
  const read = fakeEvidence(1200, () => false, { readFailsOnPage: 2 });
  const r1 = await purgeEvidence(read.deps, prefix);
  assert(r1.status === "incomplete" && r1.reason === "read_error"); eq(r1.deleted, 500);
  const mark = fakeEvidence(300, () => false, { markFailsOnCall: 2 });
  const r2 = await purgeEvidence(mark.deps, prefix);
  assert(r2.status === "incomplete" && r2.reason === "mark_error"); eq(r2.deleted, 100);
});

Deno.test("evidence purge: a cursor that doesn't advance or an unordered page stops instead of looping forever", async () => {
  const stuck: PurgeDeps = {
    page: () => Promise.resolve({ rows: Array.from({ length: 500 }, (_, i) => ({ proof_id: uid(i + 1), paths: [], kept: true })) }),
    remove: () => Promise.resolve(null), mark: (ids) => Promise.resolve({ count: ids.length }),
  };
  const r = await purgeEvidence(stuck, prefix);
  assert(r.status === "incomplete" && r.reason === "cursor_error"); eq(r.pages, 2);
  const unordered: PurgeDeps = { ...stuck, page: () => Promise.resolve({ rows: [{ proof_id: uid(2), paths: [], kept: true }, { proof_id: uid(1), paths: [], kept: true }] }) };
  const r2 = await purgeEvidence(unordered, prefix);
  assert(r2.status === "incomplete" && r2.reason === "cursor_error");
});

Deno.test("evidence purge: never removes paths outside the user's own folder; nothing to delete is a clean success", async () => {
  const f = fakeEvidence(3, () => false);
  f.rows[1].paths.push("someone-else/t/p.jpg");
  const r = await purgeEvidence(f.deps, prefix);
  eq(r.status, "complete"); assert(!f.removed.includes("someone-else/t/p.jpg"));
  const empty = await purgeEvidence(fakeEvidence(0, () => false).deps, prefix);
  eq(empty, { status: "complete", deleted: 0, kept: 0, scanned: 0, pages: 1 });
});

// ---------------- account deletion ----------------

function fakeAccount(nProofs: number, nItems: number, nAvatars: number, opt: { failList?: "proofs" | "proof_items" | "avatars"; removeFailsOnCall?: number; apiCap?: number; avatarCap?: number } = {}) {
  const tbl = {
    proofs: Array.from({ length: nProofs }, (_, i) => ({ id: uid(i + 1), storage_path: `${USER}/t${i}/p${i}.jpg` })),
    proof_items: Array.from({ length: nItems }, (_, i) => ({ id: uid(100_000 + i), storage_path: `${USER}/t${i}/p${i}-${i % 2 ? "b" : "a"}.jpg` })),
  };
  const avatars = Array.from({ length: nAvatars }, (_, i) => `avatar-${String(i).padStart(4, "0")}.jpg`);
  const store = new Set([...tbl.proofs, ...tbl.proof_items].map((r) => `proofs:${r.storage_path}`).concat(avatars.map((a) => `avatars:${USER}/${a}`)));
  let removeCalls = 0;
  const reads: string[] = [];
  const deps: AccountPurgeDeps = {
    paths: (table, after, limit) => {
      reads.push(`${table}:${after ?? "start"}`);
      if (opt.failList === table) return Promise.resolve({ error: "list failed" });
      const rows = tbl[table].filter((r) => after === null || r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, Math.min(limit, opt.apiCap ?? 1000));
      return Promise.resolve({ rows });
    },
    avatars: (offset, limit) => opt.failList === "avatars" ? Promise.resolve({ error: "list failed" }) : Promise.resolve({ names: avatars.slice(offset, offset + Math.min(limit, opt.avatarCap ?? 1000)) }),
    remove: (bucket, paths) => {
      removeCalls++;
      if (opt.removeFailsOnCall === removeCalls) return Promise.resolve("storage unavailable");
      for (const p of paths) store.delete(`${bucket}:${p}`);
      return Promise.resolve(null);
    },
  };
  return { store, deps, reads, calls: () => removeCalls };
}

Deno.test("account deletion: thousands of photos and 150 avatar files are all removed (cursor paging, avatar paging)", async () => {
  const f = fakeAccount(2500, 700, 150);
  const r = await purgeAccountStorage(f.deps, { userId: USER });
  eq(r.status, "complete");
  assert(r.status === "complete" && r.proofPaths === 3200 && r.avatarPaths === 150);
  eq(f.store.size, 0, "nothing left in storage");
  eq(f.reads.filter((x) => x.startsWith("proofs:")).length, 4, "proofs read in 3 cursor pages of up to 1,000, then an empty page");
});

Deno.test("account deletion: listing is deterministic — same order and same pages on every run", async () => {
  const a = fakeAccount(2100, 0, 0), b = fakeAccount(2100, 0, 0);
  const pa = await listAllPaths(a.deps.paths, "proofs", 1000, 10), pb = await listAllPaths(b.deps.paths, "proofs", 1000, 10);
  eq(pa, pb); assert("paths" in pa && pa.paths.length === 2100 && new Set(pa.paths).size === 2100, "no row skipped or repeated");
  eq(a.reads, ["proofs:start", `proofs:${uid(1000)}`, `proofs:${uid(2000)}`, `proofs:${uid(2100)}`]);
});

Deno.test("account deletion: any listing failure removes nothing (account must not be deleted)", async () => {
  for (const t of ["proofs", "proof_items", "avatars"] as const) {
    const f = fakeAccount(50, 10, 3, { failList: t });
    const r = await purgeAccountStorage(f.deps, { userId: USER });
    eq(r.status, "failed"); eq(r.removed, 0); eq(f.calls(), 0, `no removal after a failed ${t} listing`);
  }
});

Deno.test("account deletion: a storage failure mid-way reports what was removed; a retry finishes everything", async () => {
  const f = fakeAccount(450, 0, 2, { removeFailsOnCall: 3 });
  const r = await purgeAccountStorage(f.deps, { userId: USER });
  eq(r.status, "failed"); assert(r.status === "failed" && r.step === "remove_proofs"); eq(r.removed, 200);
  const retry = fakeAccount(0, 0, 0); // fresh call counter, same store
  const again = await purgeAccountStorage({ ...f.deps, remove: (bucket, paths) => retry.deps.remove(bucket, paths).then((e) => { for (const p of paths) f.store.delete(`${bucket}:${p}`); return e; }) }, { userId: USER });
  eq(again.status, "complete"); eq(f.store.size, 0);
});

Deno.test("account deletion: unordered rows or a runaway listing fail safely", async () => {
  const bad: AccountPurgeDeps = {
    paths: () => Promise.resolve({ rows: [{ id: uid(5), storage_path: `${USER}/a.jpg` }, { id: uid(5), storage_path: `${USER}/b.jpg` }] }),
    avatars: () => Promise.resolve({ names: [] }), remove: () => Promise.resolve(null),
  };
  const r = await purgeAccountStorage(bad, { userId: USER });
  assert(r.status === "failed" && r.step === "cursor");
  const big = fakeAccount(30, 0, 0);
  const r2 = await purgeAccountStorage(big.deps, { userId: USER, pageSize: 10, maxPages: 2 });
  assert(r2.status === "failed" && r2.step === "limit"); eq(big.calls(), 0);
});

Deno.test("account deletion: only the user's own folder is touched", async () => {
  const f = fakeAccount(2, 0, 0);
  const seen: string[] = [];
  const deps: AccountPurgeDeps = {
    ...f.deps,
    paths: async (t, a, l) => {
      const r = await f.deps.paths(t, a, l);
      return "rows" in r && t === "proofs" && a === null ? { rows: [...r.rows, { id: uid(999), storage_path: "other-user/x.jpg" }] } : r;
    },
    remove: (b, p) => { seen.push(...p); return Promise.resolve(null); },
  };
  const r = await purgeAccountStorage(deps, { userId: USER });
  eq(r.status, "complete"); assert(!seen.includes("other-user/x.jpg"));
});

// ---------------- short pages (API max-rows below the requested page size) ----------------

Deno.test("evidence purge: short pages are not the end — an API cap of 120 rows still reaches every record", async () => {
  const f = fakeEvidence(1000, (i) => i % 5 === 0, { apiCap: 120 }); // 200 kept, 800 deletable
  const r = await purgeEvidence(f.deps, { ...prefix, pageSize: 500 });
  eq(r.status, "complete");
  eq([r.deleted, r.kept, r.scanned], [800, 200, 1000], "exact counts across short pages");
  eq(r.pages, Math.ceil(1000 / 120) + 1, "9 short pages, then the empty page");
  eq(deletableLeft(f), 0); eq(deletablePhotosLeft(f), 0);
});

Deno.test("evidence purge: the old 'short page = end' rule would have stopped after the first page", async () => {
  // Same data and cap as above, with the rule this round removed: it would report success with 680 left.
  const f = fakeEvidence(1000, (i) => i % 5 === 0, { apiCap: 120 });
  const first = await f.deps.page(null, 500);
  if (!("rows" in first)) throw new Error("page failed");
  assert(first.rows.length === 120 && first.rows.length < 500, "the API returned a short first page");
  eq(1000 - first.rows.length, 880, "880 records would never have been read");
});

Deno.test("evidence purge: a short page in the middle of the run does not end it", async () => {
  const f = fakeEvidence(1200, () => false);
  let call = 0;
  const flaky: PurgeDeps = { ...f.deps, page: async (after, limit) => { call++; const r = await f.deps.page(after, call === 2 ? 37 : limit); return r; } };
  const r = await purgeEvidence(flaky, { ...prefix, pageSize: 500 });
  eq(r.status, "complete"); eq(r.deleted, 1200); eq(deletableLeft(f), 0);
});

Deno.test("evidence purge: with short pages, hitting the safety limit is still reported as incomplete", async () => {
  const f = fakeEvidence(1000, () => false, { apiCap: 100 });
  const r = await purgeEvidence(f.deps, { ...prefix, pageSize: 500, maxPages: 5 });
  assert(r.status === "incomplete" && r.reason === "limit");
  eq(r.deleted, 500, "5 short pages of 100 were processed; the rest is reported as remaining, not as done");
  const again = await purgeEvidence(f.deps, { ...prefix, pageSize: 500, maxPages: 10 });
  eq(again.status, "complete"); eq(r.deleted + again.deleted, 1000); eq(deletableLeft(f), 0);
});

Deno.test("account deletion: short pages from the API (250 rows, 40 avatar names) still list and remove everything", async () => {
  const f = fakeAccount(2500, 700, 150, { apiCap: 250, avatarCap: 40 });
  const r = await purgeAccountStorage(f.deps, { userId: USER });
  eq(r.status, "complete");
  assert(r.status === "complete" && r.proofPaths === 3200 && r.avatarPaths === 150, "every proof, item and avatar path found");
  eq(f.store.size, 0, "nothing left in storage");
  eq(f.reads.filter((x) => x.startsWith("proofs:")).length, 11, "10 short pages of 250, then an empty page");
});

Deno.test("account deletion: with short pages, a runaway listing still fails safely before anything is removed", async () => {
  const f = fakeAccount(600, 0, 0, { apiCap: 100 });
  const r = await purgeAccountStorage(f.deps, { userId: USER, pageSize: 1000, maxPages: 3 });
  assert(r.status === "failed" && r.step === "limit"); eq(f.calls(), 0, "no removal, so the account is not deleted");
});
