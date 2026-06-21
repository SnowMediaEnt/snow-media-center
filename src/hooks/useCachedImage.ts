import { useEffect, useState } from 'react';

// Persistent, offline-friendly image cache with conditional revalidation every
// ~5 minutes. Uses the Cache Storage API for blob persistence across launches
// + localStorage for ETag / Last-Modified metadata.
//
// Returns a displayable src (object URL of the cached blob) or null if nothing
// has been cached yet — callers fall back to bundled assets in that case.

const CACHE_NAME = 'smc-images-v1';
const META_PREFIX = 'smc-img-meta:';
const REVALIDATE_MS = 5 * 60 * 1000;

type Meta = { etag?: string; lastModified?: string; checkedAt: number };

const supportsCaches = () => typeof caches !== 'undefined';

const readMeta = (url: string): Meta | null => {
  try {
    const raw = localStorage.getItem(META_PREFIX + url);
    return raw ? (JSON.parse(raw) as Meta) : null;
  } catch {
    return null;
  }
};

const writeMeta = (url: string, m: Meta) => {
  try { localStorage.setItem(META_PREFIX + url, JSON.stringify(m)); } catch { /* ignore */ }
};

async function getCachedBlob(url: string): Promise<Blob | null> {
  if (!supportsCaches()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(url);
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

async function putCachedResponse(url: string, response: Response): Promise<void> {
  if (!supportsCaches()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, response.clone());
  } catch { /* ignore */ }
}

async function revalidate(url: string, hasCache: boolean): Promise<{ updated: boolean; blob: Blob | null }> {
  const headers: Record<string, string> = {};
  if (hasCache) {
    const meta = readMeta(url);
    if (meta?.etag) headers['If-None-Match'] = meta.etag;
    if (meta?.lastModified) headers['If-Modified-Since'] = meta.lastModified;
  }
  const res = await fetch(url, { headers, cache: 'no-cache' });
  if (res.status === 304) {
    writeMeta(url, { ...(readMeta(url) ?? {}), checkedAt: Date.now() });
    return { updated: false, blob: null };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await putCachedResponse(url, res);
  const blob = await res.blob();
  writeMeta(url, {
    etag: res.headers.get('etag') ?? undefined,
    lastModified: res.headers.get('last-modified') ?? undefined,
    checkedAt: Date.now(),
  });
  return { updated: true, blob };
}

export function useCachedImage(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setSrc(null); return; }
    let cancelled = false;
    let objectUrl: string | null = null;

    const apply = (blob: Blob) => {
      if (cancelled) return;
      const next = URL.createObjectURL(blob);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = next;
      setSrc(next);
    };

    (async () => {
      const cached = await getCachedBlob(url);
      if (cached) apply(cached);

      const meta = readMeta(url);
      const stale = !meta || Date.now() - meta.checkedAt > REVALIDATE_MS;
      if (!cached || stale) {
        try {
          const r = await revalidate(url, !!cached);
          if (r.updated && r.blob) apply(r.blob);
        } catch { /* offline — keep cached/null */ }
      }
    })();

    const interval = window.setInterval(async () => {
      try {
        const r = await revalidate(url, true);
        if (r.updated && r.blob) apply(r.blob);
      } catch { /* offline — ignore */ }
    }, REVALIDATE_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return src;
}

// Pre-cache + return cached srcs for a list of URLs. Order matches input.
export function useCachedImages(urls: string[]): (string | null)[] {
  const [srcs, setSrcs] = useState<(string | null)[]>(() => urls.map(() => null));

  useEffect(() => {
    let cancelled = false;
    const objectUrls: (string | null)[] = urls.map(() => null);
    const next: (string | null)[] = urls.map(() => null);
    setSrcs(next);

    const apply = (i: number, blob: Blob) => {
      if (cancelled) return;
      const u = URL.createObjectURL(blob);
      if (objectUrls[i]) URL.revokeObjectURL(objectUrls[i]!);
      objectUrls[i] = u;
      setSrcs((prev) => {
        const copy = prev.slice();
        copy[i] = u;
        return copy;
      });
    };

    urls.forEach((url, i) => {
      if (!url) return;
      (async () => {
        const cached = await getCachedBlob(url);
        if (cached) apply(i, cached);
        const meta = readMeta(url);
        const stale = !meta || Date.now() - meta.checkedAt > REVALIDATE_MS;
        if (!cached || stale) {
          try {
            const r = await revalidate(url, !!cached);
            if (r.updated && r.blob) apply(i, r.blob);
          } catch { /* ignore */ }
        }
      })();
    });

    const interval = window.setInterval(() => {
      urls.forEach((url, i) => {
        if (!url) return;
        (async () => {
          try {
            const r = await revalidate(url, true);
            if (r.updated && r.blob) apply(i, r.blob);
          } catch { /* ignore */ }
        })();
      });
    }, REVALIDATE_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      objectUrls.forEach((u) => { if (u) URL.revokeObjectURL(u); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls.join('|')]);

  return srcs;
}
