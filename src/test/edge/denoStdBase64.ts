// Stand-in for https://deno.land/std/encoding/base64.ts in tests.
export function encode(data: Uint8Array | ArrayBuffer | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
