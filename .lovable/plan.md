## Goal

When the user clicks a live event in the content bar, the popup should show a tailored, ordered list of category suggestions inside Dreamstreams / VibezTV based on the league, the teams playing, and their home cities.

## How the suggestions are picked

For every live event we already know:
- The **league** (NFL, NBA, NHL, MLB, MLS, NCAAF, NCAAB, WNBA, EPL, UCL, F1, NASCAR, PGA, UFC)
- The **two team names** (e.g. "Dodgers", "Yankees")

From that, we build an ordered list (most specific → most general):

1. **{League} Zone** — always (e.g. "MLB Zone", "NFL Zone", "UFC PPV / Fight Night Zone").
2. **{League} Teams → {Team Name}** — one row per team in the matchup (e.g. "Dodgers", "Yankees").
3. **US Sports → Spectrum** — only for **Dodgers** and **Lakers** games. Plus a generic note: "If the game is on ESPN / Fox Sports / TNT / ABC, also check US Sports."
4. **Locals → {City}** — for each US team, derived from a built-in team→city map (Dodgers → Los Angeles, Yankees → New York, Cowboys → Dallas, etc.). For international leagues (EPL, UCL, F1) this row is skipped.

Soccer / racing / golf get just rows 1–2 (no Locals, no Spectrum row).

## Where the logic lives

- **`src/lib/liveCategoryHints.ts`** (new) — pure function `getLiveHints(item)` that returns the ordered list of `{ label, sublabel }` rows. Holds:
  - `TEAM_TO_CITY` map for the four big US leagues (NFL, NBA, MLB, NHL) — ~120 teams.
  - `SPECTRUM_TEAMS = new Set(['Dodgers','Lakers'])`.
  - League → Zone-name map (mostly `"{League} Zone"`, with UFC special-cased to "PPV / Fight Night").
  - Helpers to pull the league + team short names from the existing `MediaItem` (league lives in `subtitle` as `"NBA · 3rd 12:34 · 88-72"`, teams live in `title` as `"Lakers @ Warriors"`).

- **`src/components/MediaBar.tsx`** — replace the current generic dialog body with a structured list rendered from `getLiveHints(liveDialog)`. Keep the same dialog shell, gold accent, and "Got it" button. Each row shows a colored chip ("Zone", "Team", "Locals", "Spectrum") plus the suggested category path, so it reads at a glance from across the room.

No edge-function or backend changes — everything we need is already in the `MediaItem` returned by `media-bar-feed`.

## Example outputs

**Dodgers @ Yankees (MLB)**
- MLB Zone
- MLB Teams → Dodgers
- MLB Teams → Yankees
- US Sports → Spectrum (Dodgers)
- Los Angeles Locals
- New York Locals
- Tip: also check US Sports if it's on ESPN / Fox / TNT / ABC.

**Cowboys @ Eagles (NFL)**
- NFL Zone
- NFL Teams → Cowboys
- NFL Teams → Eagles
- Dallas Locals
- Philadelphia Locals

**Arsenal vs Real Madrid (UCL)**
- UCL Zone
- Soccer Teams → Arsenal
- Soccer Teams → Real Madrid

**UFC 312: Adesanya vs Strickland**
- UFC PPV / Fight Night Zone

## Open assumption

Category names ("MLB Zone", "MLB Teams", "Locals", "US Sports") match what's actually inside Dreamstreams / VibezTV. If a name is slightly different in either app, swap the string in `liveCategoryHints.ts` and the popup updates everywhere — no other files to touch.
