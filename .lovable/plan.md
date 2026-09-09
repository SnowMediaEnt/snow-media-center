# Investigation: the missing on-screen keyboard in the sandbox

## What I checked (read-only, no code changed)

- Searched the whole current codebase and the full git history — including deleted files and every earlier version of the focus/keyboard helpers — for any component that draws a keyboard on screen.
- Read the very first version of the keyboard helper (commit `35263448`, long before the billing/WHMCS work) and every later version.
- Checked which keyboard-related packages have ever been in the project.
- Ran the real app in this sandbox browser: home screen → Player → Live TV → Username, selected the field with OK/Enter, and inspected what was actually drawn on the page plus a screenshot.

## Finding 1 — there has never been an in-app keyboard in this project

No keyboard component, no keyboard screen, no keyboard library has ever existed here, at any commit. The only keyboard-related files ever added are:

- `src/utils/dpadKeyboard.ts`
- `src/utils/keyboardVisibility.ts`
- `src/capacitor/SnowKeyboard.ts` + the matching Android file
- the test file

All of these only *ask the phone/TV's own Android keyboard to open*. None of them draw anything.

The one keyboard package in the project (`@capacitor/keyboard`) is an Android/iOS-only bridge. In a desktop browser it does nothing at all. Even the earliest version of the helper was explicitly wrapped in "only if running as an installed app".

## Finding 2 — reproduced current behavior in this sandbox

On the Live TV sign-in, selecting Username with OK highlights the field (gold) and puts the cursor in it, and nothing else appears — I confirmed there is no panel, overlay or popup drawn anywhere on the page. That is the current behavior in the desktop Chromium preview.

What the history proves: no app-rendered keyboard component was found at any checked commit. What the history does **not** prove: whether the Lovable sandbox previously showed a keyboard. The owner reports it did, so the prior behavior is unresolved — it may have been a browser/device-level on-screen keyboard that the current preview/OS no longer raises, or a different path that has changed.

## Finding 3 — the important distinction

There are two different things:

1. **The device/browser's own system keyboard** (Android/Fire TV OS keyboard, or a mobile/tablet browser's keyboard). An installed Android app can raise the OS keyboard; an Android browser can also display its own system keyboard in some contexts. A desktop Lovable preview cannot display the Android operating system's IME.
2. **A keyboard drawn by the app itself** — an on-screen key grid rendered as part of the app, driven by the remote's arrows and OK. This would show up in any preview and on TV alike.

The history search found nothing for option 2. If the owner saw a keyboard in the sandbox before, it was most likely option 1 on a particular device/browser, but that is not established by the code. The only mechanism the codebase has ever contained asks the platform for its keyboard; it has never rendered its own.

## Resolution — implemented (2026-09-09)

The owner's sandbox is a MacBook Pro (Lovable app, Chrome, Safari), so option 2 was
built: the app now draws its own keyboard in browser previews, while the installed
Android / Fire TV app keeps asking Android for its system keyboard. No claim is made
here about what the owner saw previously; history simply cannot establish it.

What was added / changed:

- `src/lib/screenKeyboard.ts` — desktop-preview-only gate (not native, and
  `(hover: hover) and (pointer: fine)` so phone/tablet browsers keep their own
  keyboard and never get two), a single shared target store, React-controlled value
  writes, caret preservation, and next-field lookup in DOM order within the form.
- `src/components/ScreenKeyboard.tsx` — the visible key grid: digits, letters,
  `@ . - _`, a symbols page, Shift, Space, Delete, Next, Done. One gold key highlight,
  arrows move it, OK types it. Owns remote keys while open; Back/Escape closes.
  Closes itself if the field or screen goes away.
- `src/App.tsx` — mounted once, globally.
- `src/utils/dpadKeyboard.ts` — opens it on the existing web focus path; the native
  `Keyboard.show()` / `SnowKeyboard.show()` sequence is untouched.
- `src/hooks/useTVFocus.ts` — yields every remote key while the overlay is open, so
  background focus/back/submit handlers cannot fire. Always false on native.

## Evidence actually observed (not mocks)

Desktop Chromium preview, home → Player → Live TV, screenshots under `/tmp/browser/kb/`:

- OK on Username: key grid visible with a single gold highlight on `q`; field value
  still `''` — the opening OK types nothing (`A_open.png`).
- Arrows + OK typed `s m c 7 -`, Shift gave `A`, symbols page gave `$`, Delete removed
  it → `smc7-A` (`B_typed.png`).
- Physical typing `zx` and physical Backspace still work; selecting the first two
  characters and pressing a key replaced the selection.
- Next moved to Password, kept the username, typed 2 characters, `type="password"`
  stays masked; no value was ever logged (`C_password.png`).
- Back closed the keyboard and stayed on the sign-in card; a second Back left it
  (`D_back.png`, `E_second_back.png`). Reopening with OK worked, and clicking the
  Password bar opened the keyboard on that bar.
- No login attempt, no form submission, no network credential request was made.

## Test / build results

- `npx vitest run` → 29 passed: the 21 existing native-lifecycle tests unchanged, plus
  8 new in `src/components/ScreenKeyboard.test.tsx` (renders only when asked, absent on
  native, typing/Shift/Delete, single arrow highlight, Next keeps text and mask,
  Back closes without bubbling, cleanup when the field disappears, and the
  Email → Password → First name → Last name Next order where Done does not submit).
- `npx tsgo --noEmit` → clean. `npm run build` → built in 27s (pre-existing chunk warning only).

## Still unverified

Fire TV / Android TV system keyboard behaviour on a real box. It needs
`npm run build:android` then `npx cap run android`; the APK bundles `dist`, so preview
changes do not reach an already-installed app. Nothing was compiled, signed, installed
or published here.

## Technical notes

The unresolved acceptance criteria are: (a) a visible on-screen keyboard appears in the Lovable sandbox when a text field is selected, and (b) it is operable with a D-pad remote.

The smallest change that meets both, independent of the sandbox's host browser/device behavior, is an in-app key grid:

- Render a key grid overlay when OK/Enter is pressed on a managed text field.
- D-pad arrows move between keys, OK types the selected key, Back/Done closes the grid, and text is written into the focused field.
- Show it when `Capacitor.getPlatform() === 'web'` or when the platform's own keyboard cannot be observed, so installed TV apps keep using the system keyboard path they already have.
- Wire it through the existing `useTVFocus` focus system so Player sign-in, billing, support, and chat forms receive it without per-screen changes.

I have not implemented this. Before planning it, I should clarify the exact sandbox device/browser where the owner expects to see the keyboard (desktop Chromium preview, Android mobile browser, etc.).

## Technical notes

- Reproduction path: `http://localhost:8080` → Player → Live TV; fields `#lt-user` / `#lt-pass`; after OK the field is `document.activeElement`, `data-tv-focused="true"`, `readOnly` false, no `inputmode` trap, and zero fixed-position overlays present.
- Web path today: `focusTextInputForDpad` focuses the element then returns immediately on non-native (`if (!Capacitor.isNativePlatform()) return`). Native path: `Keyboard.show()` then the forced `SnowKeyboard.show()` fallback. No renderer is drawn in either path.
- History checked: `git log --all` for deleted/renamed keyboard files (none), `-S 'simple-keyboard'` (none), `package.json` keyboard deps (`@capacitor/keyboard` only, added in `92976700`).
- Pending clarification: exact Lovable sandbox device/browser the owner is using to reproduce the missing keyboard.
- No edits, no build, no publish, no logins, no data operations were performed.
