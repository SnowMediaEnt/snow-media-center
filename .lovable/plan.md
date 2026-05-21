# Fix: APK shows old layout even though `version.json` says 1.0.5

## What's actually happening

Your APK is running an **old JavaScript bundle** that was committed to the GitHub repo months ago. The "v1.0.5" label is unrelated — it comes from a tiny static file (`public/version.json`) that just says `"1.0.5"`. The version number didn't change, so the app *looks* up-to-date, but the actual UI code is stale.

Two things combined to cause this:

1. **Prebuilt web assets are committed to the repo** at `android/app/src/main/assets/public/assets/` (the `index-d9rX3euz.js`, `MediaBar-*.js`, etc. files). These are snapshots of an old build.
2. **Your last `npm run build` failed** on the Mac mini with the `@swc/core` native binding error. When `npx cap sync android` ran afterward, there was no fresh `dist/` to copy from — so Capacitor kept the **old committed files** inside the Android project and packaged them into the APK.

Result: APK installs cleanly, `version.json` still reads 1.0.5, but the UI is whatever was last committed to `android/app/src/main/assets/public/` — the old 4-tile layout, no media bar, etc.

## The fix (two parts)

### Part 1 — Make the next build actually succeed on your Mac

On the Mac mini, in the project folder:

```bash
rm -rf node_modules package-lock.json dist
npm install
npm run build          # MUST complete without errors — confirm "dist/" appears
npx cap sync android
npx cap open android
```

If `npm run build` errors again, stop and send the full error. Do not run `npx cap sync` on a failed build — that's what got you here.

### Part 2 — Stop committing prebuilt assets so this can't happen again

Add `android/app/src/main/assets/public/` to `.gitignore` and remove the committed copy. After this change, the Android assets folder is always regenerated from a fresh `npm run build` + `npx cap sync android`, so a stale bundle can never sneak into the APK.

I'll also bump `public/version.json` to `1.0.6` so once the real new build lands, you'll see the version change confirm it's the fresh bundle.

## Technical details

- Files to change:
  - `.gitignore` — add `android/app/src/main/assets/public/`
  - `public/version.json` — bump to `1.0.6`
  - `git rm -r --cached android/app/src/main/assets/public/` (you'll run this locally on the Mac after pulling)
- No source code (React/TS) changes — the current `src/` already has the new layout, media bar, etc. The repo is fine; only the build/packaging pipeline is broken.

## How you'll verify it worked

After Part 1 completes successfully:
- `android/app/src/main/assets/public/index.html` timestamp is **today**
- The filenames inside `android/app/src/main/assets/public/assets/` have **different hashes** than the ones currently committed (e.g. `index-d9rX3euz.js` → something new)
- APK is back around ~25 MB
- App shows the new layout with media bar, and version reads `1.0.6`
