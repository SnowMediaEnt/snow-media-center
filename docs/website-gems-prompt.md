# Prompt for snowmediaent.com (Lovable project "Snow Media Launchpad")

Paste everything below the line into that project's chat. It mirrors the
Remote Support Session flow that already exists there, so the agent has a
working example for every piece.

---

Add a private Snow Gems checkout that the Snow Media Center TV app opens by
QR code. Gems must never be visible or purchasable on the website by itself:
no product page, no store listing, no nav link, no sitemap entry, no search
result. The only way in is a QR code from the TV, which carries an order
reference. Mirror `/support-session` exactly: `src/routes/support-session.tsx`,
`src/lib/support-session.ts`, `src/lib/support-session.server.ts`, and the
`notifySupportSessionIfPresent` hook in `src/lib/checkout.server.ts`.

## How the TV side works (already built, do not change it)

The TV app writes a row in its own backend (the SMC Supabase project) and
shows a QR code for:

    https://snowmediaent.com/gems?ref=<uuid>

The SMC bridge (`giveaway-bridge`, the same endpoint and `SMC_INTERNAL_FN_SECRET`
that `callGiveawayBridge` in `src/lib/giveaway.server.ts` already uses) has two
new actions:

- `{ action: "gems-order", ref }` → `{ ok, ref, status, package_name, credits,
  price, created_at, first_name }`. `status` is `pending_payment` for a live
  code; anything else means the code is used or stale. `ok:false` with
  `not_found` means the ref is not real.
- `{ action: "gems-paid", ref, order_number, total, paypal_transaction_id?,
  email? }` → the SMC side credits the gems exactly once and flips the row to
  paid. Safe to send twice; the second is ignored.

## 1. Hidden products

Create one product per gem pack in `products`, category `digital`, with slugs
`snow-gems-<credits>` (for example `snow-gems-50`), the price of that pack,
and a single variant. The packs and prices are whatever the TV app's
`credit_packages` table holds; ask me for the current list before creating
them, and treat `gems-order`'s `price` as the truth at checkout time.

These products must be excluded everywhere the catalogue is read for display:
the store pages, `product-cards`, featured lists, search, the sitemap, the
device configurator and any admin "storefront" listing. The cleanest way is a
`hidden` boolean on `products` (default false) that every catalogue query
filters on, with the gem products set to true. If a hidden flag already
exists, use it. The admin products panel may still show them, marked hidden.

## 2. The route `/gems`

`src/routes/gems.tsx`, modelled on `support-session.tsx`:

- `validateSearch` takes `ref` (trim, 64 chars max). No ref → redirect to `/`.
- `head`: title "Snow Gems — Snow Media Entertainment", `robots: noindex`.
- On load, call a server function (`src/lib/gems.functions.ts` +
  `src/lib/gems.server.ts`, secret stays server-side) that sends
  `gems-order` to the bridge. If the result is not `ok` or `status` is not
  `pending_payment`, show a short plain message: "This code has been used or
  has expired. Pick the pack again on your TV for a fresh one." and stop.
- Otherwise save the ref with a 7-day TTL in localStorage under
  `snow_gems_ref` (copy `support-session.ts`), find the hidden product whose
  slug is `snow-gems-<credits>`, check its variant price equals the bridge's
  `price` to the cent (refuse with a "please contact support" message if
  not), add exactly one to the cart, and go to `/checkout` the way
  `/support-session` does. Greet with `first_name` if present: "Hi Josh,
  you're buying 50 Snow Gems for $5."
- The checkout page must not let the quantity of a gem line be changed, and
  must not let another gem product be added alongside it.

## 3. Telling the TV the gems are paid

In `src/lib/checkout.server.ts`, add `notifyGemsIfPresent` next to
`notifySupportSessionIfPresent`, and call it from the same place in
`checkout.functions.ts` (after `recordOrder`, alongside the other
notifications, and also from the PayPal-recovery path so a recovered payment
credits the gems too). It fires only when the order contains a
`snow-gems-*` line AND a gems ref was carried through, and it sends:

    { action: "gems-paid", ref, order_number, total, paypal_transaction_id, email }

`paypal_transaction_id` is the PayPal capture id when you have it, otherwise
the PayPal order id. Fire-and-forget: never let a bridge failure break
checkout, log a warning instead. Clear the stored gems ref after a successful
notification.

## 4. After paying

On the order confirmation screen, when the order was a gem pack, say: "Your
Snow Gems are being added to your Snow Media Center account. Look at your
TV — they land there by themselves." Do not show a "view gems" link or any
gem balance on the website; the website never holds a balance.

## Rules

- No public route lists, links to, or describes gem packs. `/gems` without a
  valid ref shows nothing sellable.
- The secret stays in server code. Never call the bridge from the browser.
- Do not change the existing renewal, support-session or giveaway
  notifications; add alongside them.
- Keep the site's existing look; no new UI library.
- Run the existing lint and type checks before finishing, and tell me the
  product rows you created with their slugs and prices.
