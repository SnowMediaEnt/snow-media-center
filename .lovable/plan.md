# Settings tabs + Home menu order

## 1. Settings: gold bar follows the cursor

In `src/components/Settings.tsx`, the gold pill is the Tabs "active" state, but Left/Right currently only moves the focus ring — the user has to press Enter to switch the active tab. Make the active tab follow the focused tab so the whole gold bar slides with the cursor as you move between Media Manager → Updates → (App Alerts).

- In the `ArrowLeft` / `ArrowRight` handlers (≈ lines 148–155), after setting the new focused tab, also call `setActiveTab` with the matching value (`media` / `updates` / `alerts`).
- No change needed to the visual styling — `data-[state=active]:bg-brand-gold` already provides the sliding bar; we're just driving it from focus.

## 2. Home: reorder main menu to Main Apps · Support · Store

In `src/pages/Index.tsx`:

- `buttons` array (≈ lines 427–446): keep Main Apps at index 0, put Support at index 1, Store at index 2.
- Enter handler (≈ lines 405–411): `1 → support`, `2 → store`.
- Card click handler (≈ lines 693–695): `1 → support`, `2 → store`.

Index 0 (Main Apps) stays put, so the pinned-apps popup logic at lines 371/710 is unaffected. No other code paths reference indices 1 or 2.

## Out of scope

- No styling, animation, or focus-color changes.
- No changes to the dashboard / settings / logo header row.
