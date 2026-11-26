// "Delete all my evidence": the paging loop, kept free of Supabase so every edge case can be tested.
//
// The rows come from evidence_for_user_deletion_page, ordered by proof id and paged with a cursor (the last
// proof id seen). Paging never depends on what was deleted: a page made only of photos that must be kept
// (a running verification, a pending appeal, an open appeal window) simply moves the cursor on.
// Everything is counted across the whole run. The run ends in exactly one of two ways:
//   complete   - pages were read until an EMPTY page (a short page is not trusted as the end: the API may
//                return fewer rows than asked), and every deletable photo was removed and marked;
//   incomplete - a read, storage or bookkeeping step failed, or the safety limit was reached before an empty
//                page was seen. Counts so far are returned, and the caller must not report success.
// Re-running is safe: removed photos are marked deleted and drop out of later runs.

export interface EvidenceRow {
  proof_id: string;
  paths: string[];
  kept: boolean;
}

export interface PurgeDeps {
  /** One page of the caller's undeleted evidence, ordered by proof_id, strictly after `after`. */
  page(after: string | null, limit: number): Promise<{ rows: EvidenceRow[] } | { error: string }>;
  /** Removes storage objects; resolves to an error message, or null on success. */
  remove(paths: string[]): Promise<string | null>;
  /** Marks proofs' evidence as deleted; resolves to the number marked, or an error message. */
  mark(proofIds: string[]): Promise<{ count: number } | { error: string }>;
}

export interface PurgeOptions {
  /** Rows per page. Must stay under the API's 1,000-row response cap. */
  pageSize?: number;
  /** Safety limit on pages per run, including the final empty page that proves the end. */
  maxPages?: number;
  /** Proofs per storage call. */
  batchSize?: number;
  /** Only paths in this folder may be removed (the caller's own `<user id>/`). */
  pathPrefix: string;
}

export type PurgeOutcome =
  | { status: "complete"; deleted: number; kept: number; scanned: number; pages: number }
  | {
    status: "incomplete";
    reason: "limit" | "read_error" | "storage_error" | "mark_error" | "cursor_error";
    detail?: string;
    deleted: number;
    kept: number;
    scanned: number;
    pages: number;
  };

export const PURGE_DEFAULTS = { pageSize: 500, maxPages: 100, batchSize: 100 } as const;

export async function purgeEvidence(deps: PurgeDeps, opts: PurgeOptions): Promise<PurgeOutcome> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? PURGE_DEFAULTS.pageSize, 1), 1000);
  const maxPages = Math.max(opts.maxPages ?? PURGE_DEFAULTS.maxPages, 1);
  const batchSize = Math.max(opts.batchSize ?? PURGE_DEFAULTS.batchSize, 1);
  let deleted = 0, kept = 0, scanned = 0, pages = 0;
  let after: string | null = null;
  type Reason = Extract<PurgeOutcome, { status: "incomplete" }>["reason"];
  const stop = (reason: Reason, detail?: string): PurgeOutcome => ({ status: "incomplete", reason, detail, deleted, kept, scanned, pages });

  while (pages < maxPages) {
    const res = await deps.page(after, pageSize);
    pages++;
    if ("error" in res) return stop("read_error", res.error);
    const rows = res.rows;
    if (rows.length === 0) return { status: "complete", deleted, kept, scanned, pages };
    if (rows.length > pageSize) return stop("read_error", "page larger than requested");

    // The cursor must move strictly forward, or the loop could repeat a page forever.
    const last = rows[rows.length - 1].proof_id;
    if (after !== null && !(last > after)) return stop("cursor_error", "cursor did not advance");
    for (let i = 1; i < rows.length; i++) {
      if (!(rows[i].proof_id > rows[i - 1].proof_id)) return stop("cursor_error", "page not ordered by proof_id");
    }

    scanned += rows.length;
    kept += rows.filter((r) => r.kept).length;
    const go = rows.filter((r) => !r.kept);
    for (let i = 0; i < go.length; i += batchSize) {
      const batch = go.slice(i, i + batchSize);
      const paths = [...new Set(batch.flatMap((r) => r.paths))].filter((p) => typeof p === "string" && p.startsWith(opts.pathPrefix));
      if (paths.length) {
        const err = await deps.remove(paths);
        if (err) return stop("storage_error", err);
      }
      const marked = await deps.mark(batch.map((r) => r.proof_id));
      if ("error" in marked) return stop("mark_error", marked.error);
      deleted += marked.count;
    }

    // Keep going even after a short page: the API may cap a page below `pageSize` (its max-rows setting),
    // so only an empty page proves there is nothing left.
    after = last;
  }
  // The safety limit was reached without seeing an empty page: more rows may remain.
  return stop("limit", `limit of ${maxPages} pages reached before the end of the evidence`);
}
