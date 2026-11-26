// Account deletion: remove every stored file of the user BEFORE the auth user (and with it every row) goes.
// Kept free of Supabase so ordering, paging and partial failures can be tested.
//
// Rules:
//   * Proof and proof-item paths are read with a cursor on the row id (unique, strictly increasing), so the
//     result doesn't depend on ties or on rows written while listing, and no page is skipped or repeated.
//   * Every listing ends only on an EMPTY page. A short page is not trusted as the end, because the API may
//     return fewer rows than asked (its max-rows setting).
//   * Profile photos are listed page by page (the Storage API returns 100 names by default) and a listing
//     error stops the deletion instead of being ignored.
//   * Any failed read or removal returns "failed" with how much was already removed. The caller must then NOT
//     delete the account: running it again is safe (removing a missing object is not an error).
//   * A safety limit on pages turns a runaway listing into a failure, never into a silent partial success.

export interface PathRow { id: string; storage_path: string }
export interface AccountPurgeDeps {
  /** Rows of `table` for the user, ordered by id, strictly after `after`. */
  paths(table: "proofs" | "proof_items", after: string | null, limit: number): Promise<{ rows: PathRow[] } | { error: string }>;
  /** File names in the user's avatar folder, sorted by name. */
  avatars(offset: number, limit: number): Promise<{ names: string[] } | { error: string }>;
  /** Removes objects from a bucket; resolves to an error message, or null on success. */
  remove(bucket: "proofs" | "avatars", paths: string[]): Promise<string | null>;
}
export interface AccountPurgeOptions { userId: string; pageSize?: number; maxPages?: number; batchSize?: number }
export type AccountPurgeOutcome =
  | { status: "complete"; removed: number; proofPaths: number; avatarPaths: number }
  | { status: "failed"; step: "list_proofs" | "list_items" | "list_avatars" | "remove_proofs" | "remove_avatars" | "limit" | "cursor"; detail?: string; removed: number };

export async function listAllPaths(
  read: AccountPurgeDeps["paths"], table: "proofs" | "proof_items", pageSize: number, maxPages: number,
): Promise<{ paths: string[] } | { error: string; limit?: boolean; cursor?: boolean }> {
  const out: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res = await read(table, after, pageSize);
    if ("error" in res) return { error: res.error };
    const rows = res.rows;
    if (rows.length === 0) return { paths: out };
    for (let i = 0; i < rows.length; i++) {
      const prev = i === 0 ? after : rows[i - 1].id;
      if (prev !== null && !(rows[i].id > prev)) return { error: "rows not strictly ordered by id", cursor: true };
    }
    out.push(...rows.map((r) => r.storage_path));
    after = rows[rows.length - 1].id;
    // A short page is not the end (the API may cap pages below `pageSize`); only an empty page is.
  }
  return { error: `limit of ${maxPages} pages reached before the end of ${table}`, limit: true };
}

export async function purgeAccountStorage(deps: AccountPurgeDeps, opts: AccountPurgeOptions): Promise<AccountPurgeOutcome> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 1000, 1), 1000);
  const maxPages = Math.max(opts.maxPages ?? 1000, 1);
  const batchSize = Math.max(opts.batchSize ?? 100, 1);
  const prefix = `${opts.userId}/`;
  let removed = 0;

  // 1. Everything is listed first; nothing is removed unless every listing succeeded.
  const proofs = await listAllPaths(deps.paths, "proofs", pageSize, maxPages);
  if ("error" in proofs) return { status: "failed", step: proofs.limit ? "limit" : proofs.cursor ? "cursor" : "list_proofs", detail: proofs.error, removed };
  const items = await listAllPaths(deps.paths, "proof_items", pageSize, maxPages);
  if ("error" in items) return { status: "failed", step: items.limit ? "limit" : items.cursor ? "cursor" : "list_items", detail: items.error, removed };
  const avatarNames: string[] = [];
  for (let offset = 0, page = 0; ; page++) {
    if (page >= maxPages) return { status: "failed", step: "limit", detail: "too many avatar files", removed };
    const res = await deps.avatars(offset, 100);
    if ("error" in res) return { status: "failed", step: "list_avatars", detail: res.error, removed };
    if (res.names.length === 0) break; // only an empty page ends the listing
    avatarNames.push(...res.names);
    offset += res.names.length; // advance by what was actually returned, even if fewer than asked
  }

  // 2. Only the user's own folder, each path once, in a stable order.
  const proofPaths = [...new Set([...proofs.paths, ...items.paths])].filter((p) => p.startsWith(prefix)).sort();
  const avatarPaths = [...new Set(avatarNames)].map((n) => `${prefix}${n}`).sort();

  for (let i = 0; i < proofPaths.length; i += batchSize) {
    const batch = proofPaths.slice(i, i + batchSize);
    const err = await deps.remove("proofs", batch);
    if (err) return { status: "failed", step: "remove_proofs", detail: err, removed };
    removed += batch.length;
  }
  for (let i = 0; i < avatarPaths.length; i += batchSize) {
    const batch = avatarPaths.slice(i, i + batchSize);
    const err = await deps.remove("avatars", batch);
    if (err) return { status: "failed", step: "remove_avatars", detail: err, removed };
    removed += batch.length;
  }
  return { status: "complete", removed, proofPaths: proofPaths.length, avatarPaths: avatarPaths.length };
}
