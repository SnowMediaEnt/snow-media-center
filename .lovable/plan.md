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

1. **The TV's own keyboard** (Fire TV / Android box). Only the installed app can raise it. A browser cannot, by design — no code change can make Android's keyboard appear in a desktop browser.
2. **A keyboard drawn by the app itself** — an on-screen key grid rendered as part of the app, driven by the remote's arrows and OK. This *would* show up in the sandbox and on TV alike.

Because option 1 is impossible in the preview, the only way to see and test a keyboard in the sandbox is option 2 — a keyboard the app draws itself. That is new work, not a restoration: there is nothing in the history to restore.

## Recommended next step (not yet implemented)

The smallest change that gives a visible, remote-operable keyboard in the sandbox:

- Add one small in-app key grid that opens when OK is pressed on a text field, arrows move between keys, OK types, and Back closes it, writing straight into the field that opened it.
- Show it only where the device's own keyboard is not available (the browser/preview), so the installed TV app keeps using the real system keyboard it already asks for and nothing about current TV behaviour changes.
- Wire it through the existing focus system so every form (Player sign-in, billing, support, chat) gets it at once, with no per-screen edits.

I have not written any of this. Say the word and I will plan it properly, including whether you also want it on the TV app itself as a fallback for boxes whose system keyboard misbehaves.

## Technical notes

- Reproduction path: `http://localhost:8080` → Player → Live TV; fields `#lt-user` / `#lt-pass`; after OK the field is `document.activeElement`, `data-tv-focused="true"`, `readOnly` false, no `inputmode` trap, and zero fixed-position overlays present.
- Web path today: `focusTextInputForDpad` focuses the element then returns immediately on non-native (`if (!Capacitor.isNativePlatform()) return`). Native path: `Keyboard.show()` then the forced `SnowKeyboard.show()` fallback.
- History checked: `git log --all` for deleted/renamed keyboard files (none), `-S 'simple-keyboard'` (none), `package.json` keyboard deps (`@capacitor/keyboard` only, added in `92976700`).
- No edits, no build, no publish, no logins, no data operations were performed.
