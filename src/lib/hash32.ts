// FNV-1a, 32 bits: a stable number for a string, for ids and keys made from
// an address (lib/m3u's stream and category ids, lib/outsideSource's service
// ids). No imports on purpose: outsideSource may import nothing that reaches
// the Xtream client.

export const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};
