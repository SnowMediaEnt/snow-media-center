

## Wix "Sign in to App" Button — QR + Email Magic Link

### What the user will experience

1. Logged-in Wix member visits their Account page on snowmedia.com and clicks **"Sign in on my TV / App"**.
2. A modal opens showing:
   - A QR code (the TV's Snow Media app camera/scanner — or phone camera — reads it and the app signs in instantly)
   - An **"Email me the link instead"** button
   - The plain magic link (copy-paste fallback for typing into the TV browser)
3. The link is **single-use** and expires in **15 minutes**.

### Wix-side work (you do this in the Wix Editor + Velo)

#### A. Set the button ID (`openInAppBtn`)

- Wix Studio: select the button → right-side **Inspector** → expand **Properties** section → enable **Dev Mode** (top toolbar `</>` icon) if you don't see ID fields → set ID to `openInAppBtn`.
- Wix Classic Editor: select button → small popup → **Properties & Events** panel → set ID at top.

#### B. Add a modal/lightbox with three elements

In the Wix Editor, add a Lightbox named `SignInToAppLightbox` containing:
- An **Image** element with ID `qrImage` (will display the QR)
- A **Text** element with ID `magicLinkText` (shows the link as text)
- A **Button** with ID `emailLinkBtn` (label: "Email it to me instead")
- A **Text** element with ID `statusText` (shows loading/success/error states)

#### C. Velo backend file (`backend/smcSso.web.js`)

Already in place from your earlier addition. We'll extend it with a new `emailMagicLink` function so the email fallback is sent server-side (keeps the shared secret hidden).

#### D. Velo frontend code (Account page + lightbox page)

- Account page: button click → opens the lightbox.
- Lightbox page: on open, calls `getSmcLoginLink()` → renders QR (using a small QR data-URL endpoint we already control, or the open QuickChart API) → populates link text → wires the email button.

### App-side work (Snow Media app — this codebase)

#### 1. New magic-link consumption route

Add a route `/sso?token=XYZ` (component `src/pages/SsoConsume.tsx`):
- Reads `token` from query string.
- Calls the existing `wix-sso-bridge` edge function with `{ action: 'redeem', token }`.
- Bridge validates the token (single-use, unexpired), then returns Supabase session tokens (`access_token` + `refresh_token`).
- Calls `supabase.auth.setSession({ access_token, refresh_token })`.
- Redirects to `/` on success or `/auth` on failure.

#### 2. Deep-link handling on Android (Capacitor)

So scanning the QR on an Android device with the app installed opens the app, not the browser:
- Add an `intent-filter` in `AndroidManifest.xml` for scheme `snowmedia` host `sso` AND for `https://snowmedia.com/sso` (App Links).
- Add a Capacitor `App.addListener('appUrlOpen', ...)` in `src/App.tsx` that parses incoming URLs and routes to `/sso?token=...`.
- The QR encodes both: a universal `https://snowmedia.com/sso?token=XYZ` URL — Android opens the app if installed, falls back to web if not.

#### 3. Edge function update — `wix-sso-bridge`

Add two new actions alongside the existing `mint-link`:
- **`redeem`**: input `{ token }`. Validates token in a new `sso_tokens` table (single-use, expires_at, user_id). If valid, generates a fresh Supabase session via `supabase.auth.admin.generateLink({ type: 'magiclink' })` for that user and returns the session — or simpler, exchanges directly using `supabase.auth.admin.createUser`/`getUserById` + signing a session. Marks token used.
- **`email-link`**: input `{ wixMemberId, magicLink }`. Verifies HMAC from Wix, then calls our `send-transactional-email` edge function with template `sso-magic-link` to deliver it.

#### 4. New transactional email template

Template name: `sso-magic-link`. Subject: "Sign in to Snow Media on your TV". Body: branded message + "Sign In" button pointing at the magic link + 15-minute expiry note + plain-text link fallback.

### Database changes

New table `public.sso_tokens`:
- `id uuid pk`, `token text unique`, `user_id uuid` (references profiles), `created_at`, `expires_at` (default now() + 15 min), `used_at` (nullable), `wix_member_id text`.
- RLS: no client access at all — only edge functions (service role) read/write.

### Security notes (addressing your earlier concern)

- **No API keys in the app.** The Supabase anon key is the only key that ships, and it's gated by RLS — it can only do what an unauthenticated user is allowed to do.
- `WIX_SSO_SHARED_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, Wix API key — all stay in Supabase Secrets, only readable by edge functions.
- Magic link tokens are single-use, 15-min TTL, HMAC-validated end-to-end.
- Wix → bridge requests are signed with the shared secret; bridge rejects unsigned/expired requests.

### Files to create/edit

**Create:**
- `src/pages/SsoConsume.tsx` (magic-link landing page)
- `supabase/functions/_shared/transactional-email-templates/sso-magic-link.tsx`
- Migration: `sso_tokens` table + RLS

**Edit:**
- `src/App.tsx` (add `/sso` route + Capacitor `appUrlOpen` listener)
- `android/app/src/main/AndroidManifest.xml` (deep-link intent filters)
- `supabase/functions/wix-sso-bridge/index.ts` (add `redeem` + `email-link` actions, generate token now stored in DB)
- `supabase/functions/_shared/transactional-email-templates/registry.ts` (register new template)

**Wix-side (you):**
- Set `openInAppBtn` ID, build `SignInToAppLightbox`, add the frontend Velo snippet I'll provide post-implementation, extend `backend/smcSso.web.js` with `emailMagicLink` function.

### Open question to confirm before building

Email infrastructure: I see `RESEND_API_KEY` is configured but no `send-transactional-email` edge function exists yet. To send the "Email me the link" fallback, we either need to (a) set up Lovable's transactional email system (recommended — handles unsubscribe, retries, suppression automatically) or (b) write a simple one-off edge function that uses Resend directly. Recommendation: option (a). The first email this enables is the SSO link; we can add others later (welcome email, support replies, etc.).

