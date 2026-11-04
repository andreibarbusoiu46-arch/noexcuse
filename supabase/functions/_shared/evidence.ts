// Evidence handling shared by verify-proof (live), cron-tick (retries) and appeals.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { decodeBase64, encodeBase64 } from "./b64.ts";
import { dhashFromJpeg, sha256Hex } from "./dhash.ts";
import type { EvidenceImage } from "./ai.ts";
import { type EvidenceKind, LIVE_FLAG_DISTANCE, SCREENSHOT_DUP_DISTANCE } from "./rules.ts";

export interface HashedEvidence extends EvidenceImage { bytes: Uint8Array; sha256: string; dhash: string | null }

export async function hashEvidence(images: EvidenceImage[]): Promise<HashedEvidence[]> {
  const out: HashedEvidence[] = [];
  for (const img of images) {
    const bytes = decodeBase64(img.base64);
    out.push({ ...img, bytes, sha256: await sha256Hex(bytes), dhash: dhashFromJpeg(bytes) });
  }
  return out;
}

export type DuplicateCheck =
  | { ok: true; notes: string[] }
  | { ok: false; message: string };

interface Match { input_index: number; exact: boolean; distance: number; kind: EvidenceKind; created_at: string }

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

/**
 * Refuses evidence that was already used (same bytes, or a screenshot that is nearly identical),
 * and returns notes for the AI about live photos that look almost the same as an earlier proof.
 */
export function judgeDuplicates(items: { kind: EvidenceKind; sha256: string }[], matches: Match[]): DuplicateCheck {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.sha256)) return { ok: false, message: "The same image was attached twice. Each piece of evidence must be different." };
    seen.add(it.sha256);
  }
  const notes: string[] = [];
  for (const m of matches) {
    const it = items[m.input_index];
    if (!it) continue;
    if (m.exact) return { ok: false, message: `Image ${m.input_index + 1} was already used as proof on ${day(m.created_at)}. Old evidence doesn’t count — capture a new one.` };
    if (it.kind === "screenshot" && m.distance <= SCREENSHOT_DUP_DISTANCE) {
      return { ok: false, message: `The screenshot matches one you submitted on ${day(m.created_at)}. Upload today’s screenshot.` };
    }
    if (it.kind === "live" && m.distance <= LIVE_FLAG_DISTANCE && !notes.some((n) => n.startsWith(`Image ${m.input_index + 1} `))) {
      notes.push(`Image ${m.input_index + 1} is nearly identical to evidence submitted on ${day(m.created_at)}.`);
    }
  }
  return { ok: true, notes };
}

export async function checkDuplicates(db: SupabaseClient, userId: string, targetId: string, items: HashedEvidence[]): Promise<DuplicateCheck> {
  const { data, error } = await db.rpc("find_duplicate_evidence", {
    p_user: userId, p_target: targetId, p_sha256: items.map((i) => i.sha256), p_dhash: items.map((i) => i.dhash), p_max_distance: 6,
  });
  if (error) throw new Error(`find_duplicate_evidence: ${error.message}`);
  return judgeDuplicates(items, (data ?? []) as Match[]);
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
