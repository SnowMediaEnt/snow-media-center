## Wix Webhook → JWT (Custom App) Migration Plan

### Good news on the user-passthrough question

You already have approach (a) wired up. Today, when the user taps "Buy X Credits", `CreditStore.tsx` calls the `wix-integration` edge function, which hits `POST https://www.wixapis.com/ecom/v1/checkouts` with:

```
customFields: [{ title: 'app_user_id', value: <SMC user UUID> }]
```

…then returns the hosted `checkoutUrl` that we QR. So the field is **already** stamped on every checkout we generate. No Velo, no second Wix page needed. We just rename `app_user_id` → `smc_user_id` end-to-end so it matches your spec.

Approach (b) would only be needed if users could land on a Wix product page directly (outside the app). That's not your flow.

---

### 1. New secret (you'll add when ready)

- `WIX_PUBLIC_KEY` — full PEM block (`-----BEGIN PUBLIC KEY-----` … `-----END PUBLIC KEY-----`) copied from the webhook page in dev.wix.com. Used for RS256 JWT verification.
- Existing `WIX_WEBHOOK_SECRET` becomes obsolete — I'll leave it in place but stop reading it.

### 2. Database (one small migration)

Add a dedicated table for webhook idempotency + a manual-review queue. The existing `wix_redeemed_orders` is keyed on `wix_order_id`, but Wix webhooks have their own event IDs that can repeat across event types — safer to track both.

```
processed_wix_events
  id                uuid pk
  event_id          text unique not null   -- JWT `id` claim (Wix event id)
  event_type        text not null          -- e.g. 'wix.ecom.v1.order_approved'
  order_id          text
  created_at        timestamptz default now()
  -- RLS: admin-only SELECT, no public access

pending_credits
  id                uuid pk
  wix_order_id      text not null
  wix_order_number  text
  buyer_email       text
  credits           numeric not null
  raw_payload       jsonb
  resolved          boolean default false
  resolved_user_id  uuid
  created_at        timestamptz default now()
  -- RLS: admin-only
```

Both admin-only via `has_role(auth.uid(),'admin')`.

### 3. Rewrite `supabase/functions/wix-order-webhook/index.ts`

Full rewrite. Key behavior:

1. **Read raw body as text** — Wix posts the JWT as the request body (not JSON).
2. **Verify RS256 JWT** against `WIX_PUBLIC_KEY` using Web Crypto (`crypto.subtle.importKey` with SPKI + `crypto.subtle.verify`). No external lib needed; PEM → DER conversion is ~10 lines.
3. **Reject if signature invalid** → 401.
4. **Parse claims**: `instanceId`, `eventType`, `id` (event id), and `data` (which is itself a JSON string — parse it).
5. **Filter event type**: only act on `wix.ecom.v1.order_approved` (a.k.a. `OrderApproved`). Anything else → log + 200.
6. **Idempotency check**: `select 1 from processed_wix_events where event_id = ?`. If found → 200 immediately.
7. **Insert into `processed_wix_events` first** (using unique constraint as the lock) so concurrent retries dedupe cleanly.
8. **Compute credits** from `order.lineItems[]`:
   - `sku = item.physicalProperties?.sku?.toLowerCase().trim()`
   - Map: `ai50→50, ai120→120, ai250→250, ai600→600`
   - `credits += perUnit * (item.quantity || 1)`
   - If 0 credit SKUs → 200, no work.
9. **Resolve user**:
   - **Primary**: scan `order.customFields` (and `checkoutCustomFields`) for `title === 'smc_user_id'` (also accept legacy `'app_user_id'` during transition).
   - **Fallback**: look up `profiles` by `lower(email) = lower(order.buyerInfo.email)`. Only auto-credit if exactly one match.
   - **Neither**: insert into `pending_credits` with the raw payload, return 200.
10. **Grant credits** via existing `update_user_credits` RPC (`p_transaction_type = 'purchase'`, description `Wix order #<num> (SMC AI Credits)`, `paypal_transaction_id = wix_<orderId>`).
11. **Insert into `wix_redeemed_orders`** (existing table, keeps current admin reporting working).
12. **Return 200 within 1.25s**: verification + DB writes are all fast Postgres calls — no external HTTP. We don't need a deferred queue for this volume; the RPC + 2 inserts run in ~150ms typical. If you ever need it, we can move steps 8–11 into `EdgeRuntime.waitUntil(...)` after returning 200.

Errors that are *our* fault (DB down) → 500 so Wix retries. Errors that are *payload* problems (no SKU match, no user) → 200 so Wix doesn't hammer us.

### 4. `supabase/config.toml`

Already has `[functions.wix-order-webhook]` with `verify_jwt = false`. That's exactly what your "--no-verify-jwt" requirement maps to. No change needed.

### 5. `wix-integration` edge function — rename custom field

In the `create-cart` action, change:

```ts
{ title: 'app_user_id', value: String(appUserIdFromBody) }
```
→
```ts
{ title: 'smc_user_id', value: String(appUserIdFromBody) }
```

Webhook will accept both during transition so any in-flight checkouts already created don't break.

### 6. Frontend — no changes required

`CreditStore.tsx` already passes `appUserId: user.id` into `create-cart`. The rename is server-side only.

### 7. Optional cleanup (not in this pass)

The old "I've completed payment" manual reconciliation button in `CreditStore.tsx` becomes redundant once the webhook is reliable. I'll leave it as a safety net for now.

---

### What you do after I ship this

1. dev.wix.com → your existing Custom App → **Webhooks** → **Create Webhook** → eCommerce → **Order Approved**.
2. Callback URL: `https://falmwzhvxoefvkfsiylp.functions.supabase.co/wix-order-webhook`
3. Copy the **public key** shown on that page.
4. In Lovable, add secret `WIX_PUBLIC_KEY` with the full PEM block.
5. Confirm the app has **Read Orders** scope and is installed on the live site.
6. Place a $0.01 test order with the AI50 SKU from inside the SMC app (so `smc_user_id` is stamped). Verify:
   - 50 credits land on your account
   - A row appears in `processed_wix_events` and `wix_redeemed_orders`
   - Function logs show "JWT verified" + "Credited 50"

### Files I'll touch

- **migration** — create `processed_wix_events`, `pending_credits` (+ RLS)
- **rewrite** `supabase/functions/wix-order-webhook/index.ts`
- **edit** `supabase/functions/wix-integration/index.ts` (custom field rename, accept legacy)

Approve and I'll build it.