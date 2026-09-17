# Snow Media mail on the TV — what the website has to do

The TV app (Snow Media Center) now has a **Mail** tab under Support. It lists
every email campaign Snow Media Entertainment sends, dated, marked *New* until
the viewer opens it, and opens one full screen at TV size. The TV app reads
from its own Supabase project (`falmwzhvxoefvkfsiylp`), so the website has to
tell it about each campaign it sends. This document is the contract.

## The endpoint

```
POST https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/mail-publish
Content-Type: application/json
x-internal-secret: <SMC_INTERNAL_FN_SECRET>
```

Same secret and same header the website already uses in
`src/lib/notify-admin-app.ts` for `notify-admin`. Server-side only, never from
the browser. Treat it exactly like `notifyAdminApp`: fire and forget, 5 s
timeout, log and swallow failures, never block the send.

## When to call it

| Website event | Call |
| --- | --- |
| `sendCampaign` finishes with `remaining <= 0` (status becomes `sent`) | `publish` |
| A resumed `sendCampaign` top-up finishes | `publish` again (it upserts, harmless) |
| `deleteCampaign` | `remove` |
| `sendTest` | **nothing** — test sends never reach the TV |
| Scheduled send via `runDueScheduledCampaigns` | same as `sendCampaign` (it calls it) |

Suggested place: at the bottom of `sendCampaign` in `src/lib/campaigns.server.ts`,
after the final status update, when `remaining <= 0`. And in `deleteCampaign`
in `src/lib/campaignsApi.ts` — that one runs in the browser, so route it through
a small server function (or a server-side hook on delete) so the secret stays on
the server.

## Payload — publish

```json
{
  "action": "publish",
  "campaign_id": "<campaigns.id uuid>",
  "subject": "<campaigns.subject>",
  "preheader": "<campaigns.preheader or null>",
  "sent_at": "<campaigns.sent_at ISO>",
  "hero_image": "<optional https url; defaults to the first image block>",
  "audience": { "mode": "all" },
  "blocks": [ ...campaigns.blocks, see below... ]
}
```

### blocks

Send `parseBlocks(campaign.blocks)` as-is, with **one addition**: the TV cannot
read the website's `products` table, so resolve each `product` block before
sending:

```ts
// for every block with type === 'product'
{
  ...block,
  product: product
    ? { name: product.name, price: product.price, image_url: product.image_url, url: `${SITE_URL}/plans` }
    : undefined,
}
```

`loadProducts()` in `campaigns.server.ts` already has what you need. A product
block without a resolved `product` is skipped on the TV.

Every block type renders on the TV: heading, paragraph (rich `html` preferred,
`text` fallback), image, button, product, video (thumbnail + label), form,
html (sanitized to text and structure), divider. Links (button, video, form,
product) become a QR code the viewer scans with their phone, so make sure
button and video URLs are absolute `https://` links.

### audience

The TV shows a mail to a viewer only if it was sent to them:

- Campaign audience `{ mode: 'all' }` → send `{ "mode": "all" }`. Every box sees it, signed in or not.
- Campaign audience `tags` or `custom` → send
  `{ "mode": "targeted", "emails": [ ...the recipient emails that were actually matched... ] }`.
  That is the `matched` list in `sendCampaign` (lowercased). Only a TV signed in
  with one of those addresses sees the mail. Up to 20,000 addresses.

## Payload — remove

```json
{ "action": "remove", "campaign_id": "<campaigns.id uuid>" }
```

## Response

`200 { ok: true, id, campaign_id, blocks, recipients }` on publish,
`200 { ok: true, removed }` on remove, `401` on a bad secret, `400` on a
missing `campaign_id` or `subject`. Re-sending the same `campaign_id` updates
the row in place (subject edits after a send would show up on the TV).

## A worked helper (drop-in)

```ts
// src/lib/notify-smc-mail.ts — server only
const ENDPOINT = "https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/mail-publish";

export async function publishMailToTv(body: Record<string, unknown>): Promise<void> {
  const secret = process.env.SMC_INTERNAL_FN_SECRET;
  if (!secret) return;
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn("[smc-mail] publish failed", err);
  }
}
```

Called from `sendCampaign` once `remaining <= 0`:

```ts
const products = await loadProducts();
const blocks = parseBlocks(campaign.blocks).map((b) => {
  if (b.type !== "product") return b;
  const p = products.find((x) => x.id === b.productId);
  return { ...b, product: p ? { name: p.name, price: p.price, image_url: p.image_url, url: `${SITE_URL}/plans` } : undefined };
});
await publishMailToTv({
  action: "publish",
  campaign_id: campaign.id,
  subject: campaign.subject,
  preheader: campaign.preheader,
  sent_at: campaign.sent_at ?? new Date().toISOString(),
  audience: audience.mode === "all"
    ? { mode: "all" }
    : { mode: "targeted", emails: matched.map((r) => r.email.toLowerCase()) },
  blocks,
});
```

## What the TV does with it

- Lists mails newest first under Support → Mail, with the date, subject, preheader and a *New* pill until opened.
- Shows a count on the home screen's Support card and on the Mail tab, and a heads-up toast when a new one lands while the app is open. Viewers can switch that off under Settings → UI → Mail notifications; the mail still arrives.
- Opened state is kept per viewer on the box, and on the account (`snow_mail_reads`) when signed in, so it follows them to another TV.
- Realtime plus a five-minute poll, so a running TV sees a new campaign within moments of the send.
