# Roadmap

## On-screen keyboard fallback for the Lovable/desktop preview — DONE
- [x] `src/lib/screenKeyboard.ts` — desktop-only capability gate, shared target store, React-safe value writes, field ordering.
- [x] `src/components/ScreenKeyboard.tsx` — visible key grid, D-pad highlight + OK typing, Shift/#+=/Space/Delete/Next/Done, Back closes.
- [x] Mounted once in `src/App.tsx`.
- [x] Opened from the shared OK/click path in `src/utils/dpadKeyboard.ts`; closed by `hideKeyboardForDpad`.
- [x] `src/hooks/useTVFocus.ts` yields all remote keys while the overlay is open.
- [x] Tests: `src/components/ScreenKeyboard.test.tsx` (7) + existing native lifecycle tests (21) = 28 passing.
- [x] Browser verification with screenshots in `/tmp/browser/kb/`.

## Remaining (device only)
- [ ] Fire TV / Android TV system keyboard check — needs `npm run build:android` then `npx cap run android` (no `server.url`, so installed APKs need a rebuild).
