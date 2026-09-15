# Snow Casino: Aurora After Dark

## Goal
Overhaul the existing Games hub and six games as one TV-first Snow Media casino experience while preserving all server-authoritative rules and contracts.

## Implementation
- Audit current game logic, socket events, phase transitions, and focus behavior before editing.
- Add a lightweight shared game layer for shell, balance/status, controls, bets, cards, results, fairness, effects, and lobby artwork.
- Redesign the lobby and each game using CSS, SVG, and bounded Canvas2D effects with reduced-FX and low-memory behavior.
- Keep D-pad navigation deterministic and isolate frame animation from React rendering, especially Daily Spin and Roulette.
- Preserve all existing authentication, balance, cooldown, free-spin, payout, and fairness behavior.

## Verification
- Add focused navigation, duplicate-action, shared-card, and Roulette identity/performance coverage.
- Run TypeScript, the full test suite, production build, and remote-key preview checks at 1280×720 and 1920×1080.
