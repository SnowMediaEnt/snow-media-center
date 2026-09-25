# Plinko physics contract

The current client uses `src/components/games/plinkoPhysics.js` for fixed-step
puck/peg/wall collisions. Deploy that **same file byte-for-byte** to
`/opt/smc-game-server/src/games/plinkoPhysics.js`; compare SHA-256 hashes. The
VPS game server also has `plinkoPhysicsRounds.js` and `plinko_start` /
`plinko_finish` socket handlers. Older `arcade_play` clients are still supported.

- Tower launches from the center. Wide sweeps its gate automatically from left
  rail to right rail and back; pressing OK captures the nearest of eleven
  launch lanes. The puck's seeded launch, peg impacts, and wall rebounds produce
  its final `x` and bucket. No path or bucket is chosen before the drop.
- Before a coin drop, the client stores a 256-bit secret locally and sends only
  its SHA-256 commitment. The server stores its own seed and *atomically* debits
  the bet in a pending round (`20260925220000_plinko_physics_rounds.sql`). The
  server cannot derive the puck's physics seed from the client commitment.
- After landing, the client submits its bucket and reveals its secret. The
  server verifies the commitment, derives the same physics seed, re-simulates
  the puck, and credits the matching payout exactly once. A reconnect resumes
  the existing pending drop and never receives a fresh seed for free.
- The displayed paytable is normalized against 10,000 deterministic physics
  samples per launch lane to target roughly 105% Snow Coin return. Tower uses
  the center distribution; Wide normalizes separately for each lane. These are
  sampled estimates, not a guarantee on a short session.

The Supabase functions are service-role-only and the existing `game_rounds`
table remains readable only by its owner. A player who loses the locally saved
client secret, such as by switching devices mid-drop, cannot complete that
pending drop; support must review the ledger/round before any adjustment. Snow
Coins are free entertainment credits with no cash value.
