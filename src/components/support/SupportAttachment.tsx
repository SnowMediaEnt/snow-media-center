import { memo, useEffect, useState } from 'react';
import { ImageIcon, Loader2, Mic, AlertTriangle } from 'lucide-react';
import { attachmentUrl } from '@/lib/supportAttachments';

interface Props {
  path: string;
  kind: string | null;
  mime: string | null;
  durationMs: number | null;
}

const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Renders one attachment on a support message.
 *
 * The bucket is private, so nothing can be rendered from the stored path
 * directly — a signed URL is fetched per attachment. They expire, which is the
 * point: a link that leaks out of an email is not a permanent window into
 * somebody's screenshot.
 */
const SupportAttachment = memo(({ path, kind, mime, durationMs }: Props) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null); setFailed(false);
    void attachmentUrl(path)
      .then((u) => { if (!cancelled) { if (u) setUrl(u); else setFailed(true); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);

  if (failed) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-nunito text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        This attachment could not be opened.
      </div>
    );
  }

  if (!url) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs font-nunito text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {kind === 'audio' ? 'Loading voice message…' : 'Loading screenshot…'}
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-lg bg-black/30 px-3 py-2">
        <Mic className="h-4 w-4 shrink-0 text-brand-gold" />
        {/* Native controls: this has to be operable with a D-pad, and the
            browser's own audio player already is. */}
        <audio src={url} controls preload="none" className="h-9 w-full max-w-xs" />
        {durationMs ? (
          <span className="shrink-0 text-xs font-nunito tabular-nums text-slate-400">{clock(durationMs)}</span>
        ) : null}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="tv-ring mt-2 block w-fit overflow-hidden rounded-lg border border-white/10"
      aria-label="Open screenshot full size"
    >
      <img src={url} alt="Screenshot attached to this message" className="max-h-64 w-auto object-contain" />
      <span className="flex items-center gap-1 bg-black/50 px-2 py-1 text-[11px] font-nunito text-slate-300">
        <ImageIcon className="h-3 w-3" /> {mime === 'image/png' ? 'Screenshot (PNG)' : 'Screenshot'}
      </span>
    </a>
  );
});
SupportAttachment.displayName = 'SupportAttachment';

export default SupportAttachment;
