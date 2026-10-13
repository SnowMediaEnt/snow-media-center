// Provably-fair RNG — built once, used by every game.
//
// Flow:
//   1. commit()        -> { serverSeed, serverSeedHash }. Send the HASH to the
//                         client BEFORE the round; keep serverSeed secret.
//   2. client supplies clientSeed (random or user-set) + a nonce.
//   3. resolve outcome deterministically from (serverSeed, clientSeed, nonce).
//   4. After the round, reveal serverSeed. The client confirms
//      sha256(serverSeed) === serverSeedHash -> proof the result was fixed
//      before they bet.
//
// See PROVABLY_FAIR.md for the exact algorithm and a worked verification.

import { createHash, createHmac, randomBytes } from 'node:crypto';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

// Generate a fresh server seed and its commitment hash.
export function commit() {
  const serverSeed = randomBytes(32).toString('hex');
  return { serverSeed, serverSeedHash: sha256Hex(serverSeed) };
}

// Client-side check that a revealed seed matches the pre-round commitment.
export function verifyReveal(serverSeed, serverSeedHash) {
  return sha256Hex(serverSeed) === serverSeedHash;
}

// Deterministic 32 raw bytes from (serverSeed, clientSeed, nonce, cursor).
// cursor lets a single round draw more entropy than one HMAC provides.
function hmacBytes(serverSeed, clientSeed, nonce, cursor) {
  return createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest();
}

// Uniform float in [0, 1) from the first 4 bytes (base-256 fraction / 2^32).
export function floatFromSeed(serverSeed, clientSeed, nonce) {
  const bytes = hmacBytes(serverSeed, clientSeed, nonce, 0);
  let result = 0;
  for (let i = 0; i < 4; i++) result = result * 256 + bytes[i];
  return result / 0x100000000; // [0, 1)
}

// Unbiased integer in [min, max] inclusive.
// Reads 4-byte draws from the HMAC stream and rejection-samples the top
// remainder so no value is favoured (no modulo bias).
export function intInRange(min, max, serverSeed, clientSeed, nonce) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new Error('intInRange: min/max must be integers');
  }
  if (max < min) throw new Error('intInRange: max < min');
  const range = max - min + 1;
  const space = 0x100000000; // 2^32
  const limit = space - (space % range);
  let cursor = 0;
  // Safety bound: 2^32 cursors is unreachable; this just prevents an
  // infinite loop if something is badly misconfigured.
  while (cursor < 0xffffff) {
    const bytes = hmacBytes(serverSeed, clientSeed, nonce, cursor);
    for (let i = 0; i + 4 <= bytes.length; i += 4) {
      const draw =
        bytes[i] * 0x1000000 +
        bytes[i + 1] * 0x10000 +
        bytes[i + 2] * 0x100 +
        bytes[i + 3];
      if (draw < limit) return min + (draw % range);
    }
    cursor++;
  }
  throw new Error('intInRange: exhausted entropy (should never happen)');
}

// Weighted pick over `weights` (parallel to your prize/symbol array).
// Returns the chosen index. Maps a [0,1) float onto the cumulative weights.
export function weightedIndex(weights, serverSeed, clientSeed, nonce) {
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new Error('weightedIndex: weights must be a non-empty array');
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error('weightedIndex: weights must sum to > 0');
  const r = floatFromSeed(serverSeed, clientSeed, nonce) * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1; // floating-point safety net
}

// Fisher–Yates shuffle of a 52-card (or any) deck, driven by the seed stream.
// Used by blackjack / video poker later; deterministic and verifiable.
export function shuffle(array, serverSeed, clientSeed, nonce) {
  const a = array.slice();
  let cursor = 0;
  for (let i = a.length - 1; i > 0; i--) {
    // Draw j in [0, i] from an independent sub-stream (nonce + cursor).
    const j = intInRange(0, i, serverSeed, clientSeed, `${nonce}:${cursor}`);
    [a[i], a[j]] = [a[j], a[i]];
    cursor++;
  }
  return a;
}
