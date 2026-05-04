
## Goal
Let users buy credits **in-app via PayPal** AND automatically receive credits for any past or future Wix store purchase ("SMC AI Credits") tied to their email.

---

## Part 1 — PayPal in-app checkout

**Secrets needed (you provide):**
- `PAYPAL_CLIENT_ID` — from developer.paypal.com → My Apps → REST API app
- `PAYPAL_CLIENT_SECRET` — same place
- `PAYPAL_MODE` — `live` or `sandbox`

**New edge function: `paypal-checkout`**
- Action `create-order`: takes `package_id`, looks up price from `credit_packages`, creates a PayPal order via PayPal REST API, returns `approval_url` + PayPal `order_id`.
- Action `capture-order`: takes PayPal `order_id`, captures payment, verifies status = COMPLETED, then calls `update_user_credits` to add credits + record transaction with the PayPal txn ID (uses existing `paypal_transaction_id` column in `credit_transactions` for dedup).

**Frontend (`CreditStore.tsx`):**
- "Buy with PayPal" button on each package → calls `create-order` → opens approval URL in **Capacitor Browser** (in-app browser, works on Android TV/Firestick/mobile; `window.open` fallback on web).
- On browser close, calls `capture-order` with the order ID.
- Refreshes profile to show new credit balance + success toast.

---

## Part 2 — Wix auto-link by SKU

**SKU → Credits mapping (hardcoded constant, easy to edit later):**
```
ai5    → 50 credits
ai120  → 120 credits
ai250  → 250 credits
ai600  → 600 credits
```
Product name on Wix: **"SMC AI Credits"** (any variant). Matching is done by **SKU on each line item**, not product name — quantity multiplier applied (e.g. 2× ai120 = 240 credits).

**How it works:**
1. User signs in (already linked by email — `profiles.email`).
2. App calls `wix-integration` edge function with new action `sync-credit-orders`.
3. Function fetches PAID Wix orders for that email (reuses existing `get-orders` logic + adds `sku` to line-item mapping).
4. For each line item with a SKU in the map, looks up credit value × quantity.
5. Checks `wix_redeemed_orders` table to skip already-credited orders.
6. Calls `update_user_credits` per new order, inserts row into `wix_redeemed_orders` (dedup by `wix_order_id`).
7. Returns `{ newOrders, totalCreditsAdded }`.

**When sync runs:**
- Silently once after sign-in (only toasts if credits were added).
- Manual "Sync Wix Purchases" button at the top of Credit Store.

---

## Database changes (one migration)

New table `wix_redeemed_orders`:
- `id` uuid PK default gen_random_uuid()
- `user_id` uuid not null
- `wix_order_id` text not null UNIQUE
- `wix_order_number` text
- `credits_granted` numeric not null
- `created_at` timestamptz default now()

RLS:
- SELECT: `auth.uid() = user_id`
- INSERT/UPDATE/DELETE: blocked for users (only service role from edge function writes).

---

## Files

**New:**
- `supabase/functions/paypal-checkout/index.ts`
- Migration: `wix_redeemed_orders` table + RLS

**Modified:**
- `supabase/functions/wix-integration/index.ts` — add `sync-credit-orders` action; include `sku` in line-item parsing
- `src/components/CreditStore.tsx` — PayPal button per package + "Sync Wix Purchases" button
- `src/hooks/useAuth.ts` — fire-and-forget Wix sync after successful sign-in

---

## What you'll need to do after approval
1. Provide PayPal Client ID + Secret + mode (sandbox/live) — I'll prompt via the secrets tool.
2. Confirm the four Wix SKUs are exactly: `ai5`, `ai120`, `ai250`, `ai600` (case-insensitive match in code).
3. Rebuild the Android APK (`npx cap sync android`) so PayPal opens in the in-app browser on TV/mobile.

---

## Out of scope (can add later if wanted)
- Real-time Wix webhook (instant credit even before app opens).
- Stripe / other providers.
- Refund handling.
- Admin UI to edit the SKU→credits map (currently a code constant).
