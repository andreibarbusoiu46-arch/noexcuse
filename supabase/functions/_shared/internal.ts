// Internal endpoints (cron, diagnostics, self-test) accept only the cron secret from the Vault.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { safeEqual } from "./revenuecat.ts";

export async function cronSecret(db: SupabaseClient): Promise<string | null> {
  const fromEnv = Deno.env.get("CRON_SECRET");
  if (fromEnv) return fromEnv;
  const { data } = await db.rpc("cron_secret");
  return typeof data === "string" && data.length >= 32 ? data : null;
}

export async function isInternal(req: Request, db: SupabaseClient): Promise<boolean> {
  const secret = await cronSecret(db);
  return !!secret && safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}
