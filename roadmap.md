# Games corrective pass (release-blocking)

## Input / focus
- [ ] Remove Games hub Back key handling (Index owns hardware Back)
- [ ] Shared TV activation guard (Enter/Space/Select/keyCode 23, one activation, held-key swallow)
- [ ] Preserve real DOM focus through pending actions and phase changes
- [ ] Casino Hold'em affordability-only decision list + post-ante balance

## Roulette
- [ ] Remove inner <Cell> wrapper; render module-level RouletteCell directly
- [ ] Ball lands at top pointer (normalize fromBall mod 360)
- [ ] Track all RAFs in lifecycle registry
- [ ] European switch removes 00 chips + history + re-homes focus
- [ ] Undo/decrement removes exact denomination, no nested setState
- [ ] Landscape 720p play surface

## Lifecycle / performance
- [ ] Shared per-game lifecycle utility (RAF/timeout/interval/mounted/visibility)
- [ ] Apply to all six games; no state updates per frame
- [ ] DailySpin canvas sized from container, DPR capped in low-memory
- [ ] Retire will-change; no animated blur/large shadows

## Reduced FX / visuals
- [ ] Global reduced FX (root data class + JS consult)
- [ ] Distinct focal visuals per game; drop redundant headings and emoji FX
- [ ] Focus ring ~1.02-1.04 scale with reserved space

## TV layout / legacy WebView
- [ ] 5% safe area at 1280x720 and 1920x1080
- [ ] .no-inset / .no-flex-gap fallbacks, Chrome 66 floor
- [ ] All cards/grids usable at 720p; no fixed-pixel island at 1080p/4K

## Copy / tests / hygiene
- [ ] Move new English labels into i18n (en/ar/de/es/fr)
- [ ] Expand tests (activation, focus retention, cleanup, Roulette identity/landing/00, Hold'em, hub Back)
- [ ] Preview checks for all six views at 720p and 1080p
- [ ] tsc, npm test, npm run build
- [ ] Restore .lovable/plan.md and roadmap.md to pre-game versions if safely possible
