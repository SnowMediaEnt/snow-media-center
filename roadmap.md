# Roadmap

## On-screen keyboard fallback for the Lovable/desktop preview — DONE
- [x] Restore the missing shared target store and visible key grid.
- [x] Mount globally and connect the shared OK/click path.
- [x] Ensure the overlay exclusively owns D-pad keys while open.
- [x] Add focused tests and verify the real preview.

## Remaining (device only)
- [ ] Fire TV / Android TV system keyboard check — needs `npm run build:android` then `npx cap run android` (no `server.url`, so installed APKs need a rebuild).
