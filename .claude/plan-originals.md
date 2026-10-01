# Plan: Snow Originals (owner's own videos in Live TV)

## Plain-English summary

- **What viewers get:** a new **Snow Originals** entry in the Live TV side menu. It shows a wall of the owner's videos, with each video's picture and title and the newest first. A **New** badge marks videos from the last 7 days. OK plays a video full screen.
- **Upright and sideways videos:**
  - Upright (phone) videos play in the middle of the screen, with a blurred copy of the picture filling the sides.
  - Sideways (TV) videos fill the screen.
- **The player:**
  - Resumes longer videos where you left off.
  - Moves on to the next video by itself.
  - ▼ and ▲ jump to the next or previous video.
- **Kids profiles** see only videos marked kid-friendly.
- **Uploading:** done in the **Snow Media Hub**, on a new **Snow Originals** page, by staff only:
  - pick a video from a phone or computer;
  - the page checks it will play on old boxes;
  - add a title and a picture (taken from the video automatically, or uploaded);
  - publish.

  Uploads are resumable, so a big file from a phone doesn't start over when Wi-Fi drops.
- **No conversion step.** The Hub only accepts files the oldest boxes can play: MP4 or MOV, **H.264** video, **AAC** audio, up to 1080p. It tells you how to export anything else (most often HEVC from an iPhone). This is the simplest option that works every time.

### Owner action outside the code (before the first upload)
In the Supabase dashboard for project `falmwzhvxoefvkfsiylp`, go to **Storage → Settings → Upload file size limit** and raise it to at least **300 MB**. The default is 50 MB. The Free plan can't go above 50 MB, so this needs the Pro plan. See Owner decisions 1 and 2.

---

## 0. Shared contract (every item codes against this; nobody changes it alone)

### Table `public.snow_originals` (new; no existing table is touched)
| column | type | notes |
|---|---|---|
| `id` | uuid PK, default `gen_random_uuid()` | The Hub sets it itself (so file paths can use it) |
| `title` | text not null | 1–80 chars (check) |
| `description` | text null | ≤ 500 chars (check) |
| `video_path` | text not null | Object path in the bucket, e.g. `3f2a…/v-k8d2m1qz.mp4` |
| `poster_path` | text null | `3f2a…/p-k8d2m1qz.jpg`, long side ≤ 720 px, JPEG |
| `backdrop_path` | text null | `3f2a…/b-k8d2m1qz.jpg`, the same frame **32 px wide**, JPEG (the "blur" fill) |
| `duration_sec` | double precision not null | > 0 and ≤ 900 (DB ceiling; the Hub enforces the owner's limit) |
| `width`, `height` | integer not null | > 0. **Display** size after rotation (what the browser's `<video>` reports) |
| `orientation` | text, generated stored | `'portrait'` when height > width, else `'landscape'` |
| `file_size` | bigint not null | Bytes (the Hub's storage total) |
| `video_codec` | text null | E.g. `avc1.640028` (for diagnosis only) |
| `kid_friendly` | boolean not null default false | |
| `published` | boolean not null default false | |
| `published_at` | timestamptz null | Set by a trigger the first time `published` turns true; drives "New" |
| `sort` | integer not null default 0 | Lower first. The Hub gives a new upload `min(sort) − 10` so it lands on top |
| `created_at`, `updated_at` | timestamptz not null default now() | `updated_at` via `public.update_updated_at_column()` |
| `created_by` | uuid null default `auth.uid()` | References `auth.users` on delete set null |

**Order (SMC and Hub):** `sort asc, published_at desc nulls last, created_at desc`.

**RLS (same shape as `backup_streams`):**
- anon and authenticated may SELECT where `published = true`;
- `has_role(auth.uid(),'admin')` may SELECT all, INSERT, UPDATE and DELETE (`TO authenticated`).
- Grants: SELECT to anon; SELECT, INSERT, UPDATE and DELETE to authenticated; ALL to service_role.
- **Staff = the `admin` role in `public.user_roles`, checked by `public.has_role`.** The Hub's `useAuth` and every server check already use it. No new role.

### Storage bucket `snow-originals` (new)
- `public = true`, `file_size_limit = 314572800` (300 MB), `allowed_mime_types = {video/mp4, image/jpeg}`.
- **Paths:** `<row id>/v-<rand8>.mp4`, `<row id>/p-<rand8>.jpg`, `<row id>/b-<rand8>.jpg`.
  - `rand8` = 8 random `[a-z0-9]`.
  - A replaced file always gets a new name, so `cacheControl: 31536000` is safe and the CDN never serves an old copy.
- **Policies on `storage.objects`:**
  - admin (`has_role`) INSERT, UPDATE and DELETE;
  - admin SELECT, which list and remove need;
  - **no anon SELECT policy.** Public downloads go through `/object/public/…` without one, and adding one would let anyone list the drafts' files.
- **Public URL:** `https://falmwzhvxoefvkfsiylp.supabase.co/storage/v1/object/public/snow-originals/<path>`. SMC gets it from `supabase.storage.from('snow-originals').getPublicUrl(path)`, which makes no network call.

### TypeScript (SMC, `src/lib/snowOriginals.ts`, owned by B)
```ts
export const ORIGINALS_BUCKET = 'snow-originals';
export interface SnowOriginalRow { id: string; title: string; description: string | null; video_path: string; poster_path: string | null; backdrop_path: string | null; duration_sec: number; width: number; height: number; orientation: 'portrait' | 'landscape'; kid_friendly: boolean; published: boolean; published_at: string | null; sort: number; created_at: string }
export interface SnowOriginal { id: string; title: string; description: string | null; videoUrl: string; posterUrl: string | null; backdropUrl: string | null; durationSec: number; width: number; height: number; portrait: boolean; kidFriendly: boolean; publishedAt: string | null; createdAt: string; sort: number }
```

### Player interface (C implements, B mounts)
```ts
// src/components/livetv/OriginalsPlayer.tsx (default export)
interface OriginalsPlayerProps { items: SnowOriginal[]; startId: string; onClose: (lastId: string) => void }
```
`items` is the list the viewer sees (already Kids-filtered and in order), used for next and previous.

### i18n keys (B writes all 5 languages; C only calls them)
- `live.sections.originalsLabel` = "Snow Originals" (the same in all 5 languages). Add "Snow Originals" to `glossary.json › doNotTranslate`.
- New area `originals.json` (en, es, fr, de, ar). The English text:
  - `originals.browse.heading` "Snow Originals"
  - `originals.browse.subtitle` "Short videos made by Snow Media"
  - `originals.browse.newChip` "New"
  - `originals.browse.uprightLabel` "Upright video" (aria only)
  - `originals.browse.loading` "Loading Snow Originals…"
  - `originals.browse.empty` "No videos yet. Check back soon."
  - `originals.browse.emptyKids` "No kid-friendly videos yet."
  - `originals.browse.offline` "You're offline. This is the last list we had."
  - `originals.browse.loadFailed` "Couldn't load Snow Originals. Try again in a moment."
  - `originals.browse.playHint` "OK to play"
  - `originals.player.hintPlaying` "OK pause · ◀ ▶ 10 s · ▼ next · ▲ previous · Back list"
  - `originals.player.hintPaused` "OK play · ◀ ▶ 10 s · ▼ next · ▲ previous · Back list"
  - `originals.player.resumed` "Picked up where you left off"
  - `originals.player.upNext` "Up next"
  - `originals.player.upNextHint` "OK to play now · Back for the list"
  - `originals.player.cantPlay` "This video can't play right now."
  - `originals.player.retryHint` "OK to try again · Back for the list"
- Countdown numbers are digits only, so no plural keys are needed.

### Analytics (new event names only; tables and columns unchanged)
- `mode_enter` with `mode: 'originals'`: fired automatically by LiveTV's existing section effect.
- `originals_play`: `{ id, title, orientation, kid_profile: boolean, resumed: boolean, autoplay: boolean }`.
- `originals_finish`: `{ id, title }` (reached the end).
- Timer `startTimer('watch', 'originals_watch', 'player', { id, title })` and `stopTimer('watch')`.
- `player_error`: the existing event with `kind: 'originals'`, `channel_or_title: title` and `message` (≤200 chars, never the URL).
- None of these fire in demo mode (`isDemo()`).

---

## Item A: migration (no edge function)

There is no edge function. The Hub writes with the staff member's own signed-in session, and RLS plus storage policies do the checking. Upload, edit and delete need no server code.

1. **New** `supabase/migrations/20261001060000_snow_originals.sql`:
   - `create table if not exists public.snow_originals` (§0), with checks: title length, description length, duration range, width/height > 0, file_size > 0.
   - Index `(published, sort, published_at desc)`.
   - Grants, `enable row level security`, 5 policies (`drop policy if exists` first, as in `20260903030000_support_attachments.sql`).
   - Trigger `update_snow_originals_updated_at` (BEFORE UPDATE, `public.update_updated_at_column()`).
   - Trigger function `public.snow_originals_set_published_at()`, BEFORE INSERT OR UPDATE: when `new.published` and `new.published_at is null`, set `now()`. `security invoker`, `set search_path = public`.
   - `insert into storage.buckets … on conflict (id) do update set public=true, file_size_limit=…, allowed_mime_types=…`.
   - 4 `storage.objects` policies scoped to `bucket_id = 'snow-originals'` (admin insert, update, delete and select).
   - No realtime publication. Doesn't touch any other table, function, bucket or migration. In particular it doesn't touch `20260922060000_remote_support_codes.sql` or `20260930070000_*`.
2. `src/integrations/supabase/types.ts`: add the `snow_originals` Row, Insert and Update entries by hand, matching §0. Lovable regenerates the same. This lets B's `.from('snow_originals')` type-check.

**Files:**
- `supabase/migrations/20261001060000_snow_originals.sql` (new)
- `src/integrations/supabase/types.ts`

**Tests:** none run against SQL here. Check: `npx tsc --noEmit -p tsconfig.app.json`.

**Order:** A is small. Merge it first, so B and C's type checks pass. The orchestrator applies the migration through Lovable.

---

## Item B: SMC data layer, browse screen, Live TV wiring

1. **New** `src/lib/snowOriginals.ts`:
   - The §0 types and `ORIGINALS_BUCKET`.
   - `toOriginal(row)`: builds the public URLs with `getPublicUrl`, `portrait = height > width`, and drops rows with no `video_path` or a zero size.
   - `fetchOriginals()`:
     - `.from('snow_originals').select(<the §0 columns, no created_by>).eq('published', true)`. Always filter explicitly: a box signed in as an admin would otherwise see drafts through the admin policy.
     - Order as in §0, `.limit(200)`.
   - Cache in localStorage `smc-originals-v1` = `{ at, rows }`, every read and write in try/catch:
     - `loadCachedOriginals()` and `saveCachedOriginals()`;
     - `FRESH_MS = 60_000` (newer than this: don't refetch on section entry);
     - `KEEP_MS = 7 days` (kept for offline display).
   - `forViewer(list, level = kidsLevel())`: any Kids level (little, kids, teen) keeps only `kidFriendly`.
   - `isNew(item, now)`: `(publishedAt ?? createdAt)` within 7 days.
   - `fmtDuration(sec)`: digits only, `m:ss` or `h:mm:ss`.
2. **New** `src/hooks/useSnowOriginals.ts`. Returns `{ items, loading, offline, error, refresh }`:
   - Starts from the cache synchronously.
   - If the cache is older than `FRESH_MS`, fetches once via `runWhenIdle`. There is no realtime and no polling, so nothing loads behind the viewer's back.
   - A failed fetch with a cache gives `offline: true`. Without a cache it gives `error: true`.
   - `paused` argument: no fetch while a video plays.
   - In demo mode it returns `originalsDemo` and makes no network call.
3. **New** `src/data/originalsDemo.ts`: 6 made-up items.
   - 3 portrait and 3 landscape; 2 new and 2 kid-friendly.
   - Inline SVG data-URI posters (like `liveTvDemo.ts`), `videoUrl: ''`.
4. **New** `src/components/livetv/OriginalsSection.tsx`. Props `{ isActive, onExitLeft, onExitUp }`; no creds needed. It follows `BackupsSection`'s key pattern: a capture-phase window keydown handler gated on `isActive`, refs for state, blur the lingering DOM focus, no `stopImmediatePropagation` on arrows.
   - **Layout (960×540):**
     - A header strip with the focused item's title, its description (2 lines, clamped with `-webkit-line-clamp`), its duration and the New chip.
     - Under it, a grid of **4 columns of 16:9 tiles**, each about 200×112 with the title underneath.
     - Tile height is fixed in px (no `aspect-ratio`). Spacing uses margins or `gap-1..4` only. No `inset`.
     - **Upright posters** sit centred in the 16:9 tile, on top of their `backdropUrl` stretched to the tile and darkened by `bg-black/40`. That is the same look as the player. A tile with no poster shows a Snowflake placeholder.
     - Titles and descriptions are shown as the owner typed them, never translated.
   - **Remote:**
     - Arrows move in the grid.
     - Up from the top row calls `onExitUp`; Left from column 0 calls `onExitLeft`.
     - OK opens the player.
     - Back stamps `__overlayHandledBackAt` and calls `onExitLeft`.
     - The focused tile is scrolled with `scrollIntoView({ block: 'nearest' })`.
   - **Player:** OK sets `playingId`, and `<OriginalsPlayer items={visible} startId=… onClose={(lastId) => …}>` mounts lazily (`lazy(() => import('./OriginalsPlayer'))`).
     - While it is open the section's own handler steps aside.
     - On close, focus goes to the tile of `lastId`. One Back = one step: player, then grid, then side menu.
   - **Low-memory** (`native-low-memory` class): only the rows within ±1 row of the focused row render their `<img>`; other rows show the placeholder. `decoding="async"` on images.
   - **States:** loading, `empty` or `emptyKids`, the `offline` banner over the cached grid, and `loadFailed`.
   - **Demo:** shows the made-up items. OK shows the demo note (`demoDialogMsg()`, the same overlay pattern as `MoviesSection`'s `demoNotice`) and never mounts the player.
5. `src/components/LiveTV.tsx`:
   - Add `'originals'` to `SectionId`.
   - In the `mode === 'live'` sections list, add `{ id: 'originals', labelKey: 'live.sections.originalsLabel', icon: Snowflake }` **after Game Day, before VOD**, on every profile (the Kids filter is inside the section).
   - `const OriginalsSection = lazy(() => import('./livetv/OriginalsSection'))`. Render `{inSection('originals') && <Suspense …><OriginalsSection isActive={pane === 'content' && !claimOpen} onExitLeft={onExitLeft} onExitUp={onExitUp} /></Suspense>}`.
   - No intent, chooser or `enterMode` changes.
   - The side menu is shared by the Classic, Compact and Vibez layouts (layouts only change `LiveSection`'s channel list), so Originals looks the same in all three. `LiveSection` is not touched.
6. **i18n:**
   - New `src/i18n/locales/{en,es,fr,de,ar}/originals.json` with the §0 keys, including C's `originals.player.*`.
   - Add `sections.originalsLabel` to `live.json` in all 5 languages.
   - Add "Snow Originals" to `glossary.json › doNotTranslate`.
   - New `src/i18n/guard/covered/originals.txt` listing `OriginalsSection.tsx`, `OriginalsPlayer.tsx` and `src/lib/snowOriginals.ts`.

**Files:**
- `src/lib/snowOriginals.ts` (new)
- `src/hooks/useSnowOriginals.ts` (new)
- `src/data/originalsDemo.ts` (new)
- `src/components/livetv/OriginalsSection.tsx` (new)
- `src/components/LiveTV.tsx`
- `src/i18n/locales/{en,es,fr,de,ar}/originals.json` (new ×5)
- `src/i18n/locales/{en,es,fr,de,ar}/live.json`
- `src/i18n/glossary.json`
- `src/i18n/guard/covered/originals.txt` (new)
- `src/lib/snowOriginals.test.ts` (new)
- `src/components/livetv/OriginalsSection.test.tsx` (new)
- `src/components/LiveTV.kids.test.tsx`

**Tests:**
- `snowOriginals.test.ts`:
  - row mapping and public URL;
  - bad rows dropped;
  - `forViewer` for each Kids level;
  - `isNew` at the 7-day edge;
  - cache: fresh, stale, offline fallback, and storage that throws;
  - the query always includes `published = true` (mock supabase).
- `OriginalsSection.test.tsx`:
  - the grid renders;
  - Left at column 0 and Back call `onExitLeft`; Up on the top row calls `onExitUp`;
  - OK mounts the (mocked) player with the visible list;
  - close returns focus to `lastId`;
  - a Kids profile hides non-kid items and shows `emptyKids`;
  - New chip; offline banner;
  - demo: no supabase call, and OK shows the demo note.
- `LiveTV.kids.test.tsx`: the sidebar becomes `['Live TV','Guide','Snow Originals','VOD','Multi-Screen']`. Mock `OriginalsSection`.
- `locales.parity.test.ts` and `hardcoded.guard.test.ts` cover the new area automatically.

---

## Item C: the Originals player

**Choice: the native ExoPlayer (`useNativePlayer`, `live: false`) whenever `hasNativePlayer()`, otherwise the HTML5 `VideoPlayer`.**
- Why native:
  - It decodes in hardware on old boxes.
  - It handles MP4s with the index at the end (range requests).
  - It retries with backoff, keeps the place on app resume, and handles the remote's media keys.
  - `RecordingsScreen` and Backups already play files this way.
  - Its `rect` lets the picture sit in an exact centred box for upright video.
- The Chrome 66 WebView `<video>` is the fallback only (browser and dev).

1. **New** `src/lib/originalsProgress.ts`. Key `smc-originals-progress-v1:<activeProfile().id>` = `{ [id]: { pos, dur, at } }`, newest 50 kept, try/catch everywhere.
   - `resumeAt(id, durationSec)`:
     - **only videos ≥ 120 s resume**: shorts always start at 0;
     - returns pos when 15 s ≤ pos ≤ dur − 10 s, else 0.
   - `saveProgress(id, pos, dur)` and `clearProgress(id)` (at ≥ 95%, or at the end).
2. **New** `src/components/livetv/OriginalsPlayer.tsx`, following `RecordingsScreen`'s `RecordingPlayer` pattern:
   - **Native:** `useNativePlayer({ active: true, url: cur.videoUrl, live: false, volume: loadPlayerVolume(), startPosition: resumeAt(…), onEnded, rect })`.
     - **Portrait:** `H = innerHeight`, `W = round(H × width / height)`, `rect = { x: (innerWidth − W) / 2, y: 0, width: W, height: H }`. This gives the right shape whatever the viewer's Screen format setting.
     - **Landscape:** `rect` undefined (full screen, fit).
     - Add the `snowplayer-fullscreen` class while open. The root stays `bg-transparent` (no white or black flash over the native surface).
   - **Blurred sides (portrait):** two WebView bands, left `0..x` and right `x+W..innerWidth`, leaving the centre transparent so the native picture shows through.
     - Each band shows `backdropUrl` as if it were one full-screen layer: `background-size: <innerWidth>px <innerHeight>px` plus an offset `background-position`, with a `bg-black/40` overlay.
     - The 32-px backdrop stretched by the browser looks blurred, and costs no CSS `filter`, no second decoder and almost no memory, so it works on Chrome 66 and 2 GB boxes.
     - With no backdrop, it uses the poster at the same size, else plain black.
   - **HTML5 fallback:**
     - Full-screen black root with the backdrop layer (portrait).
     - A centred `W×H` box, or full screen for landscape, holding `<VideoPlayer src … onEnded onReady>`.
     - Resume by `controller.seek(resumeAt)` in `onReady`.
   - **Remote** (capture-phase handler; media keys left to `useNativePlayer`):
     - OK toggles pause and shows the bar;
     - ◀ and ▶ seek −10 and +10 s (clamped);
     - ▼ plays the next video, ▲ the previous one;
     - Back calls `onClose(currentId)` exactly once, after `__overlayHandledBackAt`.
   - **Bar:** title, a progress line and `m:ss / m:ss` (polled every 1 s via `getPosition`), plus the hint. It hides after 4 s (`useTransientVisible`) and comes back on any key. `resumed` shows for 3 s when started past 0.
   - **Progress:** save every 5 s and on close; clear at the end.
   - **Auto-play next:**
     - On `ended`, `originals_finish` fires and an "Up next" card shows the next title and poster with a 5-4-3-2-1 countdown.
     - OK plays now, Back closes to the grid, and at 0 the next video plays (`autoplay: true`).
     - After the last video it closes to the grid. Nothing is preloaded.
   - **Error:** a native or HTML5 error shows `cantPlay` and `retryHint`. OK calls `native.retry()`. `player_error` fires (kind `originals`).
   - **Analytics:** as in §0, all skipped in demo mode. B never mounts the player in demo mode anyway.

**Files:**
- `src/lib/originalsProgress.ts` (new)
- `src/components/livetv/OriginalsPlayer.tsx` (new)
- `src/lib/originalsProgress.test.ts` (new)
- `src/components/livetv/OriginalsPlayer.test.tsx` (new)

**Tests:**
- `originalsProgress.test.ts`: the 120 s rule, the 15 s and end-margin limits, per-profile keys, the 50-entry cap, storage that throws.
- `OriginalsPlayer.test.tsx`, with `useNativePlayer` and `hasNativePlayer` mocked (see `RecordingsScreen.test.tsx` and `useNativePlayer.*.test`):
  - portrait passes the centred rect and draws two bands; landscape passes no rect;
  - OK toggles; ◀ and ▶ call `seekTo` with ∓10;
  - ▼ and ▲ switch items;
  - Back calls `onClose` once with the current id;
  - `ended` shows Up next, and the countdown plays the next item;
  - the last item's end closes;
  - an error shows retry, and OK calls `retry`;
  - `originals_play`, `originals_finish` and `player_error` are called with the §0 props;
  - the HTML5 path is used when there is no native player.

**Dependency:** C imports `SnowOriginal` from B's `snowOriginals.ts`. Code against §0, and run C's final `tsc` after B merges.

---

## Item D: Hub "Snow Originals" page (hand this whole section to the Hub chat)

> **For the Snow Media Hub (`smchub`, TanStack Start + React Query + sonner, Supabase client `@/integrations/supabase/db`).**
> The table and bucket already exist in the shared project `falmwzhvxoefvkfsiylp`; they come from SMC migration `20261001060000_snow_originals.sql`. **Do not create migrations or SQL for them in the Hub**, and don't add them to `setup-sql.ts`. The page is staff-only. The `_authenticated` layout already lets in only `has_role(admin)` users, and the database enforces the same rule.

### What exists in the database
- **Table `public.snow_originals`**:
  - `id` uuid (you set it)
  - `title` text 1–80
  - `description` text ≤500 or null
  - `video_path` text
  - `poster_path` text or null
  - `backdrop_path` text or null
  - `duration_sec` float, > 0 and ≤ 900
  - `width` int and `height` int (display size)
  - `orientation` (generated, read-only: `portrait` or `landscape`)
  - `file_size` bigint (bytes)
  - `video_codec` text or null
  - `kid_friendly` bool
  - `published` bool
  - `published_at` (set by the database on first publish, read-only)
  - `sort` int (lower first)
  - `created_at`, `updated_at`, `created_by` (default `auth.uid()`)
- Admins can read every row (drafts too) and can insert, update and delete. TV boxes only see `published = true`.
- **Bucket `snow-originals`** (public read, admin write):
  - 300 MB per file;
  - allowed types `video/mp4` and `image/jpeg` only.
- **File paths** (`rand8` = 8 random `[a-z0-9]`; a replacement always gets a new rand8 and the old file is deleted):
  - Video: `<id>/v-<rand8>.mp4`
  - Poster: `<id>/p-<rand8>.jpg`
  - Backdrop: `<id>/b-<rand8>.jpg`
- **Upload options:** `contentType` `video/mp4` for the video, even when the source is `.mov`. `image/jpeg` for the images. `cacheControl: '31536000'`. `upsert: false`.
- **Public URL:** `supabase.storage.from('snow-originals').getPublicUrl(path).data.publicUrl`.

### Files to add or change in the Hub
- `src/routes/_authenticated/originals.tsx` (new): the page.
- `src/routes/_authenticated.tsx`: add a nav item `{ to: "/originals", label: "Snow Originals", icon: Clapperboard }` after "Backups".
- `src/components/originals/` (new): `OriginalsList.tsx`, `UploadDialog.tsx`, `EditDialog.tsx`, `PosterPicker.tsx`.
- `src/lib/originals/` (new):
  - `limits.ts`: the constants below;
  - `inspect.ts`: file checks;
  - `frames.ts`: poster and backdrop grabbing;
  - `upload.ts`: TUS and image uploads;
  - `api.ts`: list, insert, update, reorder, delete.
- New dependencies: `tus-js-client` (resumable uploads) and `mp4box` (reads codecs inside MP4/MOV in the browser). Use `bun add`.

### Limits (`limits.ts`; the owner's choice, see Owner decisions)
- `MAX_DURATION_SEC = 180`
- `MAX_FILE_BYTES = 300 * 1024 * 1024`
- `MAX_LONG_SIDE = 1920`, `MAX_SHORT_SIDE = 1080`, `MAX_FPS = 60`
- `WARN_BITRATE_KBPS = 10000`
- `TITLE_MAX = 80`, `DESC_MAX = 500`

### File checks in the browser (`inspect.ts`), before anything is uploaded
1. Accept `.mp4`, `.m4v` and `.mov` (`video/mp4` or `video/quicktime`).
2. **Read with `mp4box`.** Feed the `File` in 1 MB slices (`file.slice`) until `onReady`; the index may be at the end. From the result:
   - Video codec must start with `avc1` or `avc3` (H.264). The profile must be Baseline (`42`), Main (`4D`) or High (`64`).
   - **Block** these, with the message *"This video uses a format older TV boxes can't play (HEVC/High-10/…). Export it as MP4, H.264, AAC, 1080p or lower, and upload that file."*:
     - `hvc1` or `hev1` (HEVC, the iPhone default);
     - High 10 (`6E`) and higher profiles;
     - `vp09`, `av01`, ProRes, Dolby Vision.
   - Audio must be `mp4a` (AAC) or absent. Block anything else (e.g. `ac-3`, `Opus`).
   - **Warn (allowed):** the index is at the end (not "fast start"); average bitrate > `WARN_BITRATE_KBPS`; no audio track.
3. **Read with a hidden `<video preload="metadata" muted playsinline>` on an object URL:**
   - `duration` must be ≤ `MAX_DURATION_SEC`;
   - `videoWidth` and `videoHeight` are the **display** size after rotation: store these as `width` and `height`;
   - long side ≤ 1920 and short side ≤ 1080.
   - `file.size` must be ≤ `MAX_FILE_BYTES`.
4. Show a checklist (green ✓ / red ✗ / amber !) with the detected orientation (Upright or Sideways), resolution, length, size and codec. Upload is disabled while any ✗ remains.

### Export guidance (show it on the page, collapsed under "Will my video play?")
- **iPhone camera:** Settings → Camera → Formats → **Most Compatible** (records H.264), or export from an editor.
- **CapCut / editors:** export **MP4, H.264** (turn **off** HEVC / "smart HDR"), **1080p or 720p**, **30 fps**, bitrate "Recommended".
- **Recommended:**
  - upright **720×1280**, about 3 Mbps (half the data of 1080p and looks the same on a TV);
  - sideways **1920×1080**, about 6 Mbps;
  - AAC 128 kbps stereo.

### Poster and backdrop (`frames.ts`, `PosterPicker.tsx`)
- **Auto:**
  - After the checks, seek the preview `<video>` to `min(1 s, 10% of duration)`.
  - A slider lets staff pick another frame.
  - iOS Safari: call `play()` then `pause()` once so frames can be drawn.
- **Poster:** draw the frame to a canvas whose long side is 720 px (same orientation as the video), `toBlob('image/jpeg', 0.82)`.
- **Backdrop:** draw the same frame to a canvas **32 px wide** (height to scale), `toBlob('image/jpeg', 0.7)`. That's about 1 KB, and the TV stretches it into the blurred sides.
- **Upload an image instead:** accept JPEG, PNG, WebP or HEIC if the browser decodes it. Make the poster and backdrop from that image the same way. Always store JPEG.

### Upload (`upload.ts`, `UploadDialog.tsx`)
1. **Form:**
   - Title (required, ≤80);
   - Description (optional, ≤500);
   - **Kid-friendly** switch (default **off**, help text "Kids profiles only see videos with this on");
   - **Publish now** switch (default **on**).
2. **On Upload:**
   - `id = crypto.randomUUID()`, `r = rand8()`.
   - **Video, resumable TUS** with `tus-js-client`:
     - endpoint `https://falmwzhvxoefvkfsiylp.storage.supabase.co/storage/v1/upload/resumable` (build it from `SHARED_PROJECT_ID`);
     - `chunkSize: 6 * 1024 * 1024` (**must be exactly 6 MB** for Supabase);
     - `retryDelays: [0, 3000, 5000, 10000, 20000]`;
     - `uploadDataDuringCreation: true`, `removeFingerprintOnSuccess: true`;
     - headers `{ 'x-upsert': 'false' }`;
     - in `onBeforeRequest`, set `authorization: Bearer <fresh access_token>` from `supabase.auth.getSession()`, so an upload longer than the 1-hour token keeps working;
     - `metadata: { bucketName: 'snow-originals', objectName: \`${id}/v-${r}.mp4\`, contentType: 'video/mp4', cacheControl: '31536000' }`.
   - **Progress:** a progress bar with %, MB of MB and speed, plus **Pause / Resume / Cancel** buttons.
   - **Interrupted uploads:** call `findPreviousUploads()` and `resumeFromPreviousUpload()` so a reloaded page continues an unfinished upload of the same file. Supabase keeps it for 24 h.
   - Add a `beforeunload` warning while uploading.
   - **Images:** after the video, `supabase.storage.from('snow-originals').upload(\`${id}/p-${r}.jpg\`, poster, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })`, then the same for `b-${r}.jpg`.
   - **Then insert the row:**
     - `{ id, title, description, video_path, poster_path, backdrop_path, duration_sec, width, height, file_size, video_codec, kid_friendly, published }`;
     - `sort = (current min sort, or 0) − 10`, so it lands on top.
   - **If anything after the video upload fails:** `storage.remove([...uploaded paths])` and show the error. Never leave files without a row.
3. Toast "Published", or "Saved as draft" when Publish now is off.

### List page (`originals.tsx`, `OriginalsList.tsx`)
- **Query:** `from('snow_originals').select('*').order('sort').order('published_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })` (React Query key `['snow-originals']`).
- **Each row shows:**
  - the poster (upright posters in a 9:16 thumbnail, sideways in 16:9);
  - title, an Upright or Sideways badge, `m:ss`, size in MB;
  - a Kid-friendly badge;
  - a Published switch (toggles `published`), or a Draft badge;
  - a "New on TVs" badge when `published_at` is under 7 days old;
  - a play button (preview in a `<video controls>` dialog);
  - Up and Down buttons (reorder);
  - Edit and Delete.
- **Header:** an "Upload video" button, plus "Storage used: X GB" (the sum of `file_size`) and a short note that each view of a video counts toward monthly bandwidth.
- **Reorder:** Up or Down swaps `sort` with the neighbour (two updates). If two rows share a value, renumber the whole list 0, 10, 20… first.
- **Edit:**
  - title, description, kid-friendly, published;
  - **Replace picture:** a new frame or image gets new `p-`/`b-` paths, the row is updated, then the old two files are removed.
  - The video itself isn't replaced. To swap the video, delete and upload again.
- **Delete:** confirm ("This removes the video from every TV and deletes its files"), then `storage.remove([video_path, poster_path, backdrop_path].filter(Boolean))`. **If that succeeds**, delete the row; if it fails, show the error and keep the row.
- **Unpublish** hides the video from TVs within about a minute; boxes refetch on their next visit to the section.
- **Empty state:** "No Snow Originals yet. Upload your first video."

### Acceptance (Hub)
- An HEVC iPhone clip is blocked with the export message.
- A CapCut H.264 1080×1920 clip passes, is detected as Upright, and uploads with progress. Pausing and resuming works. Turning Wi-Fi off mid-upload, then on, continues the upload.
- The row appears at the top and plays in the preview dialog. It shows on a TV under Live TV › Snow Originals.
- Delete removes the 3 files (they no longer show in the bucket) and the row.
- A non-admin account can't open the page, and its direct API writes are refused by RLS.

---

## What must stay the same
- **Live TV:** channels, Guide, Game Day, VOD, Multi-Screen and Backups behave exactly as now. `LiveSection` and the 3 layouts are untouched. Only the side-menu list gets one entry.
- **Remote:** D-pad focus; one Back = one step (player → grid → side menu → leave Live TV).
- **Kids profiles:** no Backups or Game Day as before; Originals shows only kid-friendly videos.
- **Demo mode:** no Supabase calls from Originals, and analytics stay off.
- **Chrome 66:** no `aspect-ratio`, no `inset`, no `:is()`, `gap` only 1–4, no CSS `filter` blur, no `loading="lazy"` reliance.
- **Untouched:** analytics tables and columns, all existing tables, buckets and migrations (including `20260922060000_remote_support_codes.sql` and `20260930070000_*`), `src/components/games`, `src/components/kids`, `games.*`.
- **Orchestrator only:** `versionCode` and `TRACKER.md`.

## Risks
- **Rotation.** iPhone camera files store a landscape frame plus a "rotate 90°" flag. ExoPlayer on a TextureView may not apply it on some boxes, and the video would show sideways.
  - We store the display size, so the layout is right; only the picture would be turned.
  - Device test: upload one clip straight from the iPhone camera roll (H.264 "Most Compatible").
  - If it's wrong: either the Hub blocks rotated files with an "export from an editor" message (mp4box gives the matrix), or a fixer handles `unappliedRotationDegrees` in `SnowPlayerPlugin.kt`.
- **Supabase upload limit.** Until the project's global limit is raised, files over 50 MB fail at about 50 MB. Owner action above.
- **Old Android certificates.** ExoPlayer uses the system's certificates, not the WebView's. Very old boxes (Android 5–7) that can't validate Supabase's certificate get a play error. It would show as `player_error` kind `originals`. A fallback to the HTML5 player would be a follow-up.
- **Drafts in a public bucket.** A draft's file can be fetched by anyone who has its exact random URL. No list is exposed. See Owner decision 4.
- **Bandwidth cost grows with views**, not uploads. See Owner decision 2.

---

## Owner decisions
1. **Longest video and biggest file.** Recommended: **3 minutes and 300 MB**. The database allows up to 15 minutes if you raise it later.
2. **Supabase plan and bandwidth.**
   - Uploads over 50 MB need the **Pro** plan, with the upload limit raised to 300 MB (Storage → Settings).
   - Rough cost at Pro's prices (check the current pricing page):
     - Pro includes about 250 GB of video data a month;
     - after that, about $0.09 per GB, less for data served from the CDN cache.
   - Example: a 1-minute upright 720p video is about 25 MB. 300 boxes × 20 views a month ≈ 150 GB, which fits in what's included. The same at 1080p is about 2× that.
   - Recommended: stay on Pro and export upright videos at **720p**.
3. **The blurred sides.** Recommended: a **blurred still from the video** (looks almost the same, works on every box). The alternative is a live blurred copy of the moving video, which needs a second video decoder. Old 2 GB boxes can't do it, and it would make playback stutter.
4. **Drafts.**
   - Recommended: one public bucket. A draft's file is reachable only by its secret random link, and boxes never list drafts.
   - The alternative is a private bucket with expiring links. That's more work and more moving parts on the TV.
5. **Videos in the wrong format.** Recommended: **the Hub refuses them and says how to export.** Automatic conversion would need a paid video service or a conversion server; it can be added later if refusals become a hassle.
6. **Menu position.** Recommended: **after Game Day, before VOD**. Teen profiles follow the Kids rule (kid-friendly only), like the other Kids levels. Say if teens should see everything.
