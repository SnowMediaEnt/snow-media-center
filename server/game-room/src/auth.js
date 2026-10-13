// Verify the user's Supabase JWT presented in the Socket.IO handshake.
// No valid token -> no connection. No anonymous play.
//
// This project has been migrated to ASYMMETRIC JWT signing keys (a JWKS is
// present), so real user access tokens are signed ES256/RS256 and must be
// verified against the project's public JWKS. The legacy HS256 shared secret
// is still accepted for older/symmetric tokens (and our minted test tokens).
// We pick the path from the token header's `alg`.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './config.js';

// Public keys for asymmetric tokens (cached + auto-refreshed by jose).
const JWKS = createRemoteJWKSet(
  new URL(`${env.supabaseUrl}/auth/v1/.well-known/jwks.json`)
);
// Shared secret for legacy HS256 tokens.
const hsKey = new TextEncoder().encode(env.supabaseJwtSecret);

function headerAlg(token) {
  const seg = token.split('.')[0];
  const json = Buffer.from(seg, 'base64url').toString('utf8');
  return JSON.parse(json).alg;
}

export async function verifySupabaseJwt(token) {
  if (!token || typeof token !== 'string') throw new Error('missing token');

  let alg;
  try {
    alg = headerAlg(token);
  } catch {
    throw new Error('malformed token');
  }

  let payload;
  if (alg === 'HS256') {
    ({ payload } = await jwtVerify(token, hsKey, { algorithms: ['HS256'] }));
  } else {
    // ES256 / RS256 — verify against the project's published public keys.
    ({ payload } = await jwtVerify(token, JWKS));
  }

  if (!payload.sub) throw new Error('token has no subject');
  if (payload.role === 'anon') throw new Error('anonymous tokens not allowed');
  return { userId: payload.sub, email: payload.email || null, role: payload.role };
}
