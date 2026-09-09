# Roadmap

- [x] Correct the investigation record in `.lovable/plan.md` (no unsupported claims about past sandbox behaviour).
- [ ] Shared browser on-screen keyboard fallback (desktop preview only):
  - [ ] `src/lib/screenKeyboard.ts` — capability gate + shared open/close/target store + controlled-value writer.
  - [ ] `src/components/ScreenKeyboard.tsx` — D-pad key grid overlay, exclusive key ownership, Next/Done/Back.
  - [ ] Mount once in `src/App.tsx`; open from OK/Enter (`focusTextInputForDpad`) and from pointer clicks.
  - [ ] Verify in the real browser: Live TV Username, arrow+OK typing, Next to Password, Back, reopen, click-open, symbols, backspace, no duplicate first char.
  - [ ] Keep the 21 existing regression tests, typecheck and build green.
