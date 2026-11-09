import assert from "node:assert/strict";
import { formEncode, snapshot, verifyStripeSignature } from "../_shared/stripe.ts";

async function sign(secret: string, t: number, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("stripe: valid signature accepted", async () => {
  const t = 1_800_000_000, body = '{"id":"evt_1"}';
  assert.equal(await verifyStripeSignature(body, `t=${t},v1=${await sign("whsec_abc", t, body)}`, "whsec_abc", t + 10), true);
});
Deno.test("stripe: tampered body, wrong secret, stale timestamp and missing header rejected", async () => {
  const t = 1_800_000_000, body = '{"id":"evt_1"}', v1 = await sign("whsec_abc", t, body);
  assert.equal(await verifyStripeSignature('{"id":"evt_2"}', `t=${t},v1=${v1}`, "whsec_abc", t), false);
  assert.equal(await verifyStripeSignature(body, `t=${t},v1=${v1}`, "whsec_other", t), false);
  assert.equal(await verifyStripeSignature(body, `t=${t},v1=${v1}`, "whsec_abc", t + 301), false);
  assert.equal(await verifyStripeSignature(body, null, "whsec_abc", t), false);
  assert.equal(await verifyStripeSignature(body, `t=${t}`, "whsec_abc", t), false);
});
Deno.test("stripe: one of several v1 signatures may match (secret rotation)", async () => {
  const t = 1_800_000_000, body = "{}";
  assert.equal(await verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${await sign("whsec_abc", t, body)}`, "whsec_abc", t), true);
});
Deno.test("stripe: form encoding of nested params", () => {
  assert.equal(formEncode({ a: 1, b: { c: "x y", d: [1, 2] }, e: undefined }), "a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D=1&b%5Bd%5D%5B1%5D=2");
});
Deno.test("stripe: snapshot reads the period from the item on newer API versions", () => {
  const s = snapshot({ id: "sub_1", customer: "cus_1", status: "trialing", trial_start: 1, trial_end: 2, cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_1" }, current_period_start: 10, current_period_end: 20 }] }, metadata: { user_id: "u1" },
    latest_invoice: { status: "paid" } }, 99);
  assert.deepEqual([s.current_period_start, s.current_period_end, s.price_id, s.user_id, s.latest_invoice_status, s.event_created], [10, 20, "price_1", "u1", "paid", 99]);
});
