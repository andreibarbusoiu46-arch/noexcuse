// Evidence handling shared by verify-proof (live), cron-tick (retries) and appeals.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import jpeg from "npm:jpeg-js@0.4.4";
import { decodeBase64, encodeBase64 } from "./b64.ts";
import { fingerprintJpeg, sha256Hex } from "./dhash.ts";
import type { EngineImage as EvidenceImage } from "./engine.ts";
import { COPY_DETAIL_MIN, type EvidenceKind, LIVE_FLAG_DISTANCE, SCREENSHOT_DUP_DISTANCE, SIMILAR_MIN } from "./rules.ts";
import {
  cropMatch, decodeSignature, detailSimilarity, encodeSignature, type Match as CropMatch, QUICK_MIN, quickScore, type Rgba,
  type Signature,
} from "./similarity.ts";

export interface HashedEvidence extends EvidenceImage {
  bytes: Uint8Array; sha256: string; dhash: string | null; signature: Signature | null; width: number; height: number;
}

export async function hashEvidence(images: EvidenceImage[]): Promise<HashedEvidence[]> {
  const out: HashedEvidence[] = [];
  for (const img of images) {
    const bytes = decodeBase64(img.base64);
    const fp = fingerprintJpeg(bytes);
    out.push({ ...img, bytes, sha256: await sha256Hex(bytes), dhash: fp?.dhash ?? null, signature: fp?.signature ?? null,
      width: fp?.width ?? 0, height: fp?.height ?? 0 });
  }
  return out;
}

export const signatureText = (s: Signature | null) => (s ? encodeSignature(s) : null);

export type DuplicateCheck =
  | { ok: true; notes: string[] }
  | { ok: false; message: string; reason: "same_image_twice" | "copy_in_submission" | "reused" | "reused_same_target" | "screenshot_reused" };

/**
 * A match between new image `input_index` and earlier evidence of the same user.
 * exact = same bytes; distance = dHash distance; copy = confirmed resized/re-encoded/cropped copy
 * (two-stage similarity); similar = looks alike but not confirmed as a copy (e.g. the same place).
 */
export interface Match {
  input_index: number; exact: boolean; distance: number; kind: EvidenceKind; created_at: string;
  same_target?: boolean; copy?: boolean; similar?: boolean;
}

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

/**
 * Decides on duplicates. Refuses: the same image twice in one submission; a copy of one live photo used as
 * the other; any image already used before (exact bytes, or a confirmed copy of a live photo), including
 * earlier attempts for the same target; screenshots nearly identical to an earlier one.
 * Look-alikes that are not confirmed copies (same place, same desk) are only noted for the AI.
 */
export function judgeDuplicates(
  items: { kind: EvidenceKind; sha256: string }[], matches: Match[], internalCopies: [number, number][] = [],
): DuplicateCheck {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.sha256)) return { ok: false, reason: "same_image_twice", message: "The same image was attached twice. Each piece of evidence must be different." };
    seen.add(it.sha256);
  }
  if (internalCopies.length) {
    const [a, b] = internalCopies[0];
    return { ok: false, reason: "copy_in_submission", message: `Photo ${b + 1} is a copy or crop of photo ${a + 1}. Take two separate photos.` };
  }
  const notes: string[] = [];
  const ordered = [...matches].sort((x, y) => Number(!!y.exact) - Number(!!x.exact) || Number(!!y.copy) - Number(!!x.copy));
  for (const m of ordered) {
    const it = items[m.input_index];
    if (!it) continue;
    if (m.exact || (m.copy && it.kind === "live")) {
      return m.same_target
        ? { ok: false, reason: "reused_same_target", message: `Image ${m.input_index + 1} was already submitted for this target. Sending it again won’t change the result — capture a new photo that shows what was asked.` }
        : { ok: false, reason: "reused", message: `Image ${m.input_index + 1} was already used as proof on ${day(m.created_at)}. Old evidence doesn’t count — capture a new one.` };
    }
    if (it.kind === "screenshot" && (m.copy || m.distance <= SCREENSHOT_DUP_DISTANCE)) {
      return { ok: false, reason: "screenshot_reused", message: `The screenshot matches one you submitted on ${day(m.created_at)}. Upload today’s screenshot.` };
    }
  }
  for (const m of ordered) {
    const it = items[m.input_index];
    if (!it || it.kind !== "live") continue;
    if ((m.similar || m.distance <= LIVE_FLAG_DISTANCE) && !notes.some((n) => n.startsWith(`Image ${m.input_index + 1} `))) {
      notes.push(`Image ${m.input_index + 1} looks very similar to evidence submitted on ${day(m.created_at)} (it may be the same place, or a reused photo).`);
    }
  }
  return { ok: true, notes };
}

/**
 * At most this many look-alike candidates per new image are confirmed against the stored photo (stage 2 costs
 * one storage download and ≈ 150 ms CPU each). A real copy scores highest in stage 1, so it is checked first.
 */
const MAX_CONFIRMATIONS = 2;

interface SigRow { proof_item_id: string; proof_id: string; kind: EvidenceKind; storage_path: string; signature: string; same_target: boolean; created_at: string }

/** Stage 0 + stage 1 against stored signatures (pure). Returns candidates worth confirming, best first. */
export function shortlist(item: { signature: Signature | null }, rows: { signature: string }[]): { row: number; match: CropMatch }[] {
  if (!item.signature) return [];
  const out: { row: number; match: CropMatch }[] = [];
  rows.forEach((r, i) => {
    const s = decodeSignature(r.signature);
    if (!s || quickScore(item.signature!, s) < QUICK_MIN) return;
    const m = cropMatch(item.signature!, s);
    if (m.score >= SIMILAR_MIN) out.push({ row: i, match: m });
  });
  return out.sort((a, b) => b.match.score - a.match.score);
}

function decodeRgba(bytes: Uint8Array): Rgba | null {
  try {
    const im = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256, maxResolutionInMP: 40 });
    return { data: im.data, width: im.width, height: im.height };
  } catch {
    return null;
  }
}

/** Live photos in one submission that are copies of each other (pairs of indexes). */
export function copiesWithin(items: HashedEvidence[], decoded: (i: number) => Rgba | null): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.kind !== "live" || b.kind !== "live" || !a.signature || !b.signature) continue;
    if (quickScore(a.signature, b.signature) < QUICK_MIN) continue;
    const m = cropMatch(a.signature, b.signature);
    if (m.score < SIMILAR_MIN) continue;
    const ra = decoded(i), rb = decoded(j);
    if (ra && rb && detailSimilarity(ra, rb, m) >= COPY_DETAIL_MIN) out.push([i, j]);
  }
  return out;
}

export async function checkDuplicates(db: SupabaseClient, userId: string, targetId: string, items: HashedEvidence[], excludeProof: string | null = null): Promise<DuplicateCheck> {
  const { data, error } = await db.rpc("find_duplicate_evidence_v2", {
    p_user: userId, p_target: targetId, p_sha256: items.map((i) => i.sha256), p_dhash: items.map((i) => i.dhash),
    p_max_distance: 6, p_exclude_proof: excludeProof,
  });
  if (error) throw new Error(`find_duplicate_evidence_v2: ${error.message}`);
  const matches = (data ?? []) as Match[];

  const cache = new Map<number, Rgba | null>();
  const decoded = (i: number) => {
    if (!cache.has(i)) cache.set(i, decodeRgba(items[i].bytes));
    return cache.get(i)!;
  };
  const internal = copiesWithin(items, decoded);
  const quick = judgeDuplicates(items, matches, internal);
  if (!quick.ok) return quick;

  // Similarity against the user's recent evidence (live photos only; screenshots keep the dHash rule,
  // because screenshots of the same app legitimately look alike every day).
  if (items.some((i) => i.kind === "live" && i.signature)) {
    const { data: rows, error: sErr } = await db.rpc("recent_evidence_signatures", { p_user: userId, p_target: targetId, p_exclude_proof: excludeProof, p_limit: 400 });
    if (sErr) throw new Error(`recent_evidence_signatures: ${sErr.message}`);
    const sigs = (rows ?? []) as SigRow[];
    const stored = new Map<string, Rgba | null>();
    const storedPhoto = async (path: string) => {
      if (!stored.has(path)) {
        const file = await db.storage.from("proofs").download(path);
        stored.set(path, file.data ? decodeRgba(new Uint8Array(await file.data.arrayBuffer())) : null);
      }
      return stored.get(path)!;
    };
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== "live") continue;
      for (const { row, match } of shortlist(items[i], sigs).slice(0, MAX_CONFIRMATIONS)) {
        const r = sigs[row];
        const old = await storedPhoto(r.storage_path);
        const mine = decoded(i);
        // The new image is cropMatch's first argument. If the stored photo can't be read, the look-alike is only
        // noted for the AI (we never refuse evidence without confirming the copy).
        const copy = !!(old && mine) && detailSimilarity(mine, old, match) >= COPY_DETAIL_MIN;
        matches.push({ input_index: i, exact: false, distance: 64, kind: r.kind, created_at: r.created_at, same_target: r.same_target, copy, similar: !copy });
        if (copy) return judgeDuplicates(items, matches);
      }
    }
  }
  return judgeDuplicates(items, matches);
}

/** All evidence of a stored proof, in order (falls back to the single photo of older proofs). */
export async function loadEvidence(db: SupabaseClient, proof: { id: string; storage_path: string }): Promise<EvidenceImage[] | null> {
  const { data: items } = await db.from("proof_items").select("kind, storage_path").eq("proof_id", proof.id).order("position");
  const list = items?.length ? items as { kind: EvidenceKind; storage_path: string }[] : [{ kind: "live" as const, storage_path: proof.storage_path }];
  const out: EvidenceImage[] = [];
  for (const it of list) {
    const file = await db.storage.from("proofs").download(it.storage_path);
    if (file.error || !file.data) return null;
    out.push({ kind: it.kind, base64: encodeBase64(new Uint8Array(await file.data.arrayBuffer())) });
  }
  return out;
}

/** Re-derives the duplicate notes for a stored proof (used by retries and appeals). */
export async function storedNotes(db: SupabaseClient, userId: string, targetId: string, proofId: string): Promise<string[]> {
  const { data: items } = await db.from("proof_items").select("kind, sha256, dhash").eq("proof_id", proofId).order("position");
  if (!items?.length) return [];
  const { data } = await db.rpc("find_duplicate_evidence", {
    p_user: userId, p_target: targetId, p_sha256: items.map((i) => i.sha256), p_dhash: items.map((i) => i.dhash), p_max_distance: 6,
  });
  const r = judgeDuplicates(items as { kind: EvidenceKind; sha256: string }[], ((data ?? []) as Match[]).filter((m) => !m.exact));
  return r.ok ? r.notes : [];
}
