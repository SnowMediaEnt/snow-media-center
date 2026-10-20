// The IPTV services Snow Media sells, and how to tell whether a host is one
// of them. Kept apart from xtream.ts (which re-exports SERVERS) so modules
// that only need the answer — the outside-service rule, analytics, channel
// status — can import it without pulling in the whole Xtream client or
// making an import cycle with it. No imports on purpose.

export interface XtreamServer {
  label: string;
  host: string; // no trailing slash
}

// EDIT THESE to add / change servers. Order = probe order.
export const SERVERS: XtreamServer[] = [
  { label: 'Dreamstreams', host: 'http://dstreams.xyz:8080' },
  { label: 'Vibez',    host: 'https://strmz.xyz' },
];

/**
 * The bare host name of a URL or host ("http://dstreams.xyz:8080/" →
 * "dstreams.xyz"): lowercase, no scheme, port, path or trailing dot. '' when
 * it can't be read. A host typed without a scheme is read as http.
 */
export const hostNameOf = (urlOrHost: string | null | undefined): string => {
  let s = String(urlOrHost ?? '').trim().toLowerCase();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
  try {
    return new URL(s).hostname.replace(/\.$/, '');
  } catch {
    return '';
  }
};

/**
 * Is this one of our services (DreamStreams, Vibez)? Matched on the host
 * name, so the scheme, the port and a trailing slash don't matter (lines
 * saved long ago say "http://dstreams.xyz" without the :8080), and a sub-
 * domain of ours counts as ours too.
 */
export const isOurHost = (urlOrHost: string | null | undefined): boolean => {
  const h = hostNameOf(urlOrHost);
  if (!h) return false;
  return SERVERS.some((s) => {
    const ours = hostNameOf(s.host);
    return !!ours && (h === ours || h.endsWith(`.${ours}`));
  });
};
