# Plinko board contract

The SMC game server lives at `/opt/smc-game-server` on the Snow Media VPS. Its
`src/games/arcade.js` Plinko handler was updated alongside this client change.
The pre-change file is backed up at
`backups/arcade-before-plinko-boards-20260925.js`; the server-side regression
test is `src/games/arcade.test.js`.

- `board: "tower"` (or omitted by an older app) keeps the original centered
  10-decision path, eleven buckets, and risk multipliers.
- `board: "wide"` requires an integer `dropLane` from 0 through 10. The server
  commits the random decisions, reflects any move that would cross a side rail,
  and returns the actual ten-step `path`, `slot`, `multiplier`, and `payout`.
- The wide paytable changes with drop lane. Both client and server compute the
  exact ten-step landing distribution and normalize the displayed multipliers
  to about 105% expected Snow Coin return at every lane. Moving toward a rail
  makes nearby edge hits more likely, but reduces their displayed multiplier.

The server must be deployed before a client that sends `board: "wide"`; old
clients remain compatible. If the paytable or path math changes, update both
`src/components/games/plinkoBoards.ts` here and the VPS handler and test.
