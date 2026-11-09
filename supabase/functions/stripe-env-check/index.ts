// Internal diagnostic (Vault cron secret): which STRIPE_* variables the functions see and what KIND of key each
// holds (sk_test_, rk_live_, …) and its length — never the value.
import { adminClient, json } from "../_shared/http.ts";
import { isInternal } from "../_shared/internal.ts";

Deno.serve(async (req) => {
  if (!(await isInternal(req, adminClient()))) return json(401, { error: "unauthorized" });
  const kind = (v: string) => {
    const m = v.trim().match(/^(sk|rk|pk|whsec)_(test|live)?_?/);
    return `${m ? m[0] : "unrecognised "}…(${v.trim().length} chars)`;
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(Deno.env.toObject())) if (/STRIPE/i.test(k)) out[k] = kind(v);
  return json(200, out);
});
