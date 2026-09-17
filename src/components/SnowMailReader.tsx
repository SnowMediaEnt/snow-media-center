// One mail from Snow Media, full screen, at TV size.
//
// The email's blocks render natively at couch-readable sizes rather than as
// the 600px email itself. Up/Down scroll the page; Left/Right step through
// the links in it (buttons, videos, surveys, products), and OK shows the
// picked link as a QR code to scan with a phone. Back closes the code, then
// the mail.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, QrCode, ExternalLink, PlayCircle, ClipboardList, ShoppingBag } from 'lucide-react';
import { blockLink, mailLongDate, sanitizeMailHtml, type MailBlock, type SnowMail } from '@/lib/snowMail';
import { trackEvent } from '@/lib/analytics';

interface Props {
  mail: SnowMail;
  onClose: () => void;
}

const QR_OPTS = { width: 320, margin: 1, color: { dark: '#0b1020', light: '#ffffff' } };

const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;
const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;

const LinkIcon = ({ block }: { block: MailBlock }) => {
  if (block.type === 'video') return <PlayCircle className="w-6 h-6" />;
  if (block.type === 'form') return <ClipboardList className="w-6 h-6" />;
  if (block.type === 'product') return <ShoppingBag className="w-6 h-6" />;
  return <ExternalLink className="w-6 h-6" />;
};

const money = (n?: number) => (typeof n === 'number' ? `$${Number.isInteger(n) ? n : n.toFixed(2)}` : '');

const SnowMailReader = ({ mail, onClose }: Props) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<Map<string, HTMLElement>>(new Map());
  const links = useMemo(() => mail.blocks.map((b) => ({ block: b, link: blockLink(b) })).filter((x) => x.link), [mail.blocks]);
  const [linkIdx, setLinkIdx] = useState(0);
  const [qr, setQr] = useState<{ url: string; label: string; png?: string } | null>(null);

  useEffect(() => {
    try { trackEvent('mail_open', 'support', { campaign: mail.campaignId }); } catch { void 0; }
  }, [mail.campaignId]);

  const focusLink = useCallback((idx: number) => {
    const item = links[idx];
    if (!item) return;
    setLinkIdx(idx);
    const el = linkRefs.current.get(item.block.id);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [links]);

  const openQr = useCallback((idx: number) => {
    const item = links[idx];
    if (!item?.link) return;
    const next = { url: item.link.url, label: item.link.label };
    setQr(next);
    QRCode.toDataURL(item.link.url, QR_OPTS)
      .then((png) => setQr((cur) => (cur && cur.url === next.url ? { ...cur, png } : cur)))
      .catch(() => undefined);
    try { trackEvent('mail_link', 'support', { campaign: mail.campaignId, url: item.link.url }); } catch { void 0; }
  }, [links, mail.campaignId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (isBack(e)) {
        stop();
        if (qr) setQr(null); else onClose();
        return;
      }
      if (qr) { if (isOk(e)) { stop(); setQr(null); } return; }
      const box = scrollRef.current;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        stop();
        box?.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * Math.round(box.clientHeight * 0.45), behavior: 'smooth' });
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (links.length === 0) { stop(); return; }
        stop();
        focusLink(e.key === 'ArrowRight' ? Math.min(links.length - 1, linkIdx + 1) : Math.max(0, linkIdx - 1));
        return;
      }
      if (isOk(e)) { stop(); if (links.length) openQr(linkIdx); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [qr, onClose, links.length, linkIdx, focusLink, openQr]);

  const renderBlock = (b: MailBlock, i: number) => {
    const link = blockLink(b);
    const idx = link ? links.findIndex((x) => x.block.id === b.id) : -1;
    const picked = idx >= 0 && idx === linkIdx;
    const ring = picked ? 'ring-4 ring-brand-gold shadow-[0_0_0_6px_rgba(195,170,114,0.25)]' : 'ring-1 ring-white/15';
    const setRef = (el: HTMLElement | null) => { if (el) linkRefs.current.set(b.id, el); else linkRefs.current.delete(b.id); };

    switch (b.type) {
      case 'heading':
        return <h2 key={b.id} className={`text-3xl font-extrabold text-white leading-tight ${i === 0 ? '' : 'mt-8'} mb-3`}>{b.text}</h2>;
      case 'paragraph':
        if (b.html?.trim()) {
          return <div key={b.id} className="mail-prose text-xl leading-relaxed text-white/85 mb-5" dangerouslySetInnerHTML={{ __html: sanitizeMailHtml(b.html) }} />;
        }
        return <p key={b.id} className="text-xl leading-relaxed text-white/85 mb-5 whitespace-pre-line">{b.text}</p>;
      case 'image':
        return b.url ? <img key={b.id} src={b.url} alt="" className="w-full rounded-2xl mb-6 object-cover max-h-[60vh]" loading="lazy" /> : null;
      case 'divider':
        return <hr key={b.id} className="border-white/15 my-7" />;
      case 'html':
        return b.text?.trim()
          ? <div key={b.id} className="mail-prose text-xl leading-relaxed text-white/85 mb-5" dangerouslySetInnerHTML={{ __html: sanitizeMailHtml(b.text) }} />
          : null;
      case 'button':
      case 'form':
        return link ? (
          <div key={b.id} ref={setRef} onClick={() => { setLinkIdx(idx); openQr(idx); }}
            className={`inline-flex items-center gap-3 rounded-full px-7 py-3.5 my-2 mr-3 text-lg font-bold cursor-pointer transition-all ${picked ? 'bg-brand-gold text-slate-900' : 'bg-brand-ice text-slate-900'} ${ring}`}>
            <LinkIcon block={b} />
            {link.label}
            <span className="text-sm font-semibold opacity-70 flex items-center gap-1"><QrCode className="w-4 h-4" /> OK to scan</span>
          </div>
        ) : null;
      case 'video':
        return link ? (
          <div key={b.id} ref={setRef} onClick={() => { setLinkIdx(idx); openQr(idx); }}
            className={`relative rounded-2xl overflow-hidden mb-6 cursor-pointer min-h-[12rem] bg-black/40 ${ring}`}>
            {b.thumbnailUrl && <img src={b.thumbnailUrl} alt="" className="w-full object-cover max-h-[55vh]" loading="lazy" />}
            <div className="absolute inset-0 flex items-center justify-center bg-black/35">
              <div className={`flex items-center gap-3 rounded-full px-7 py-3.5 text-lg font-bold ${picked ? 'bg-brand-gold text-slate-900' : 'bg-white/90 text-slate-900'}`}>
                <PlayCircle className="w-7 h-7" /> {link.label} <span className="text-sm font-semibold opacity-70">· OK to scan</span>
              </div>
            </div>
          </div>
        ) : null;
      case 'product':
        return link && b.product ? (
          <div key={b.id} ref={setRef} onClick={() => { setLinkIdx(idx); openQr(idx); }}
            className={`flex items-center gap-6 rounded-2xl bg-white/[0.06] p-5 mb-6 cursor-pointer ${ring}`}>
            {b.product.image_url && <img src={b.product.image_url} alt="" className="w-40 h-40 object-cover rounded-xl shrink-0" loading="lazy" />}
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-extrabold text-white truncate">{b.product.name}</div>
              {typeof b.product.price === 'number' && <div className="text-xl font-bold text-brand-gold mt-1">{money(b.product.price)}</div>}
              <div className={`inline-flex items-center gap-2 mt-4 rounded-full px-6 py-2.5 text-base font-bold ${picked ? 'bg-brand-gold text-slate-900' : 'bg-brand-ice text-slate-900'}`}>
                <ShoppingBag className="w-5 h-5" /> Shop now <span className="text-sm font-semibold opacity-70">· OK to scan</span>
              </div>
            </div>
          </div>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#0b1020] text-white flex flex-col" data-snow-mail-reader>
      <div className="shrink-0 flex items-center gap-4 px-8 py-3 border-b border-white/10 bg-gradient-to-r from-[#5E0466]/60 to-[#0A2147]/60">
        <button type="button" onClick={onClose} className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-base font-semibold hover:bg-white/20">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <img src="https://snowmediaent.com/yeti-logo.png" alt="" className="w-9 h-9 rounded-full" />
        <div className="min-w-0">
          <div className="text-base font-bold text-white/90 leading-tight">Snow Media Entertainment</div>
          <div className="text-sm text-white/60 leading-tight">{mailLongDate(mail.sentAt)}</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-5xl mx-auto px-10 pt-8 pb-24">
          <h1 className="text-4xl font-black leading-tight text-white mb-2">{mail.subject}</h1>
          {mail.preheader && <p className="text-xl text-brand-ice/90 mb-6">{mail.preheader}</p>}
          <div className="mt-6">
            {mail.blocks.map(renderBlock)}
            {mail.blocks.length === 0 && <p className="text-xl text-white/60">This mail has no content to show.</p>}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-8 py-2.5 border-t border-white/10 text-sm text-white/55 flex gap-6 bg-[#0b1020]">
        <span>▲ ▼ Scroll</span>
        {links.length > 0 && <span>◀ ▶ Pick a link ({linkIdx + 1} of {links.length})</span>}
        {links.length > 0 && <span>OK Scan it with your phone</span>}
        <span>Back Close</span>
      </div>

      {qr && (
        <div className="absolute inset-0 z-10 bg-black/75 flex items-center justify-center" onClick={() => setQr(null)}>
          <div className="bg-[#111827] rounded-3xl p-8 flex items-center gap-8 max-w-4xl ring-1 ring-white/15">
            <div className="w-[320px] h-[320px] rounded-2xl bg-white flex items-center justify-center overflow-hidden">
              {qr.png ? <img src={qr.png} alt="" className="w-full h-full" /> : <span className="text-slate-500">Making code…</span>}
            </div>
            <div className="min-w-0">
              <div className="text-sm uppercase tracking-widest text-brand-gold font-bold mb-2">Scan with your phone</div>
              <div className="text-3xl font-extrabold leading-tight mb-3">{qr.label}</div>
              <div className="text-base text-white/60 break-all">{qr.url}</div>
              <div className="text-sm text-white/50 mt-6">Press OK or Back to close</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SnowMailReader;
