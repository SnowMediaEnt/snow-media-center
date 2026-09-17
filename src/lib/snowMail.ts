// Mail from Snow Media Entertainment, read on the TV.
//
// Every campaign the website sends by email is also published to `snow_mail`
// (see supabase/functions/mail-publish). Support lists it newest first, opens
// one full screen, and remembers which ones this viewer has opened — on the
// device, and on the account when signed in so the marker follows them.
//
// One shared store feeds every screen that shows mail (the home badge, the
// Support tab, the list): a single fetch, a single realtime channel, a single
// poll, however many components are listening.
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';
import { setPausableInterval } from '@/utils/pausableInterval';

export type MailBlockType = 'heading' | 'paragraph' | 'image' | 'button' | 'product' | 'video' | 'form' | 'html' | 'divider';

export interface MailBlock {
  id: string;
  type: MailBlockType;
  text?: string;
  html?: string;
  url?: string;
  label?: string;
  formSlug?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  product?: { name: string; price?: number; image_url?: string; url?: string };
}

export interface SnowMail {
  id: string;
  campaignId: string;
  subject: string;
  preheader?: string;
  blocks: MailBlock[];
  heroImage?: string;
  sentAt: string;
}

export const SITE_URL = 'https://snowmediaent.com';
export const MAIL_EVENT = 'snow-mail:changed';
export const MAIL_NOTIFY_EVENT = 'snow-mail:notify';

const READ_PREFIX = 'snow-mail-read:';
const NOTIFY_KEY = 'snow-mail-notify';
const LIST_LIMIT = 60;
const POLL_MS = 5 * 60 * 1000;

/* ── notification preference ─────────────────────────────────────────────── */

export const loadMailNotify = (): boolean => {
  try { return localStorage.getItem(NOTIFY_KEY) !== 'off'; } catch { return true; }
};

export const saveMailNotify = (on: boolean): void => {
  try { localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(MAIL_NOTIFY_EVENT, { detail: on })); } catch { /* ignore */ }
};

/** Whether new mail is announced (badge on Support, heads-up on Home). */
export function useMailNotify(): boolean {
  const [on, setOn] = useState<boolean>(() => loadMailNotify());
  useEffect(() => {
    const h = () => setOn(loadMailNotify());
    window.addEventListener(MAIL_NOTIFY_EVENT, h);
    return () => window.removeEventListener(MAIL_NOTIFY_EVENT, h);
  }, []);
  return on;
}

/* ── parsing ─────────────────────────────────────────────────────────────── */

const BLOCK_TYPES: MailBlockType[] = ['heading', 'paragraph', 'image', 'button', 'product', 'video', 'form', 'html', 'divider'];
const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

export const parseBlocks = (raw: unknown): MailBlock[] => {
  if (!Array.isArray(raw)) return [];
  const out: MailBlock[] = [];
  raw.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const r = b as Record<string, unknown>;
    if (!BLOCK_TYPES.includes(r.type as MailBlockType)) return;
    const p = r.product && typeof r.product === 'object' ? r.product as Record<string, unknown> : undefined;
    out.push({
      id: s(r.id) ?? String(i),
      type: r.type as MailBlockType,
      text: s(r.text), html: s(r.html), url: s(r.url), label: s(r.label),
      formSlug: s(r.formSlug), videoUrl: s(r.videoUrl), thumbnailUrl: s(r.thumbnailUrl),
      product: p ? { name: s(p.name) ?? 'Product', price: typeof p.price === 'number' ? p.price : undefined, image_url: s(p.image_url), url: s(p.url) } : undefined,
    });
  });
  return out;
};

interface MailRow { id: string; campaign_id: string; subject: string; preheader: string | null; blocks: unknown; hero_image: string | null; sent_at: string }

const toMail = (r: MailRow): SnowMail => ({
  id: r.id, campaignId: r.campaign_id, subject: r.subject, preheader: r.preheader ?? undefined,
  blocks: parseBlocks(r.blocks), heroImage: r.hero_image ?? undefined, sentAt: r.sent_at,
});

/** Where a block sends the reader. On a TV that becomes a QR code. */
export const blockLink = (b: MailBlock): { url: string; label: string } | null => {
  switch (b.type) {
    case 'button': return b.url ? { url: b.url, label: b.label || 'Open link' } : null;
    case 'video': return b.videoUrl ? { url: b.videoUrl, label: b.label || 'Watch video' } : null;
    case 'form': return b.formSlug ? { url: `${SITE_URL}/f/${encodeURIComponent(b.formSlug)}`, label: b.label || 'Take the survey' } : null;
    case 'product': return b.product ? { url: b.product.url || `${SITE_URL}/plans`, label: `Shop ${b.product.name}` } : null;
    default: return null;
  }
};

/* ── read state ──────────────────────────────────────────────────────────── */

const readKey = (viewer: string) => `${READ_PREFIX}${viewer}`;

export const loadReadIds = (viewer: string): Set<string> => {
  try {
    const raw = localStorage.getItem(readKey(viewer));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
};

const saveReadIds = (viewer: string, ids: Set<string>) => {
  try { localStorage.setItem(readKey(viewer), JSON.stringify(Array.from(ids).slice(-500))); } catch { /* ignore */ }
};

export function markMailRead(viewer: string, mailId: string): void {
  const ids = loadReadIds(viewer);
  if (ids.has(mailId)) return;
  ids.add(mailId);
  saveReadIds(viewer, ids);
  store.readIds = ids;
  emit();
  if (viewer !== 'device') {
    void supabase.from('snow_mail_reads').upsert({ user_id: viewer, mail_id: mailId }, { onConflict: 'user_id,mail_id' })
      .then(() => undefined, () => undefined);
  }
}

async function syncReadsFromCloud(userId: string): Promise<Set<string>> {
  const ids = loadReadIds(userId);
  try {
    const { data } = await supabase.from('snow_mail_reads').select('mail_id').eq('user_id', userId).limit(500);
    for (const r of data ?? []) ids.add(String(r.mail_id));
    saveReadIds(userId, ids);
  } catch { /* offline: local is enough */ }
  return ids;
}

/* ── the shared store ────────────────────────────────────────────────────── */

export interface MailState {
  viewer: string;
  mails: SnowMail[];
  readIds: Set<string>;
  loaded: boolean;
}

const store: MailState = { viewer: 'device', mails: [], readIds: new Set(), loaded: false };
const listeners = new Set<() => void>();
let refs = 0;
let teardown: (() => void) | null = null;
let inflight: Promise<void> | null = null;
let syncedViewer = '';

const emit = () => { listeners.forEach((l) => { try { l(); } catch { /* ignore */ } }); };

async function currentViewer(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? 'device';
  } catch { return 'device'; }
}

export function refreshMail(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const viewer = await currentViewer();
    if (viewer !== store.viewer || !store.loaded) {
      store.viewer = viewer;
      store.readIds = loadReadIds(viewer);
    }
    try {
      const { data, error } = await supabase
        .from('snow_mail')
        .select('id,campaign_id,subject,preheader,blocks,hero_image,sent_at')
        .order('sent_at', { ascending: false })
        .limit(LIST_LIMIT);
      if (!error && data) store.mails = (data as MailRow[]).map(toMail);
    } catch { /* keep what we have */ }
    if (viewer !== 'device' && syncedViewer !== viewer) {
      store.readIds = await syncReadsFromCloud(viewer);
      syncedViewer = viewer;
    }
    store.loaded = true;
    emit();
  })().finally(() => { inflight = null; });
  return inflight;
}

function start(): () => void {
  const cancelIdle = runWhenIdle(() => { void refreshMail(); }, 2500);
  let channel: ReturnType<typeof supabase.channel> | null = null;
  const cancelFirst = onFirstInteraction(() => {
    channel = supabase
      .channel('snow_mail_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snow_mail' }, () => { void refreshMail(); })
      .subscribe();
  });
  const cancelPoll = setPausableInterval(() => { void refreshMail(); }, POLL_MS);
  const onVisible = () => { if (document.visibilityState === 'visible') void refreshMail(); };
  document.addEventListener('visibilitychange', onVisible);
  const { data: auth } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { syncedViewer = ''; store.loaded = false; void refreshMail(); }
  });
  return () => {
    cancelIdle(); cancelFirst(); cancelPoll();
    document.removeEventListener('visibilitychange', onVisible);
    auth.subscription.unsubscribe();
    if (channel) supabase.removeChannel(channel);
  };
}

/** Subscribe a component to the shared mail state. */
export function subscribeMail(listener: () => void): () => void {
  listeners.add(listener);
  if (refs++ === 0) teardown = start();
  return () => {
    listeners.delete(listener);
    if (--refs === 0) { teardown?.(); teardown = null; }
  };
}

export const getMailState = (): MailState => store;

export const unreadMail = (state: MailState): SnowMail[] => state.mails.filter((m) => !state.readIds.has(m.id));

/** Short date for a list row: "Sep 17", or "Sep 17, 2025" once it is old. */
export const mailDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};

/** Full date for the reader header: "Wednesday, September 17, 2026". */
export const mailLongDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

/* ── the html block: a strict allow-list, no scripts, no styles, no links out ── */

const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'a', 'img', 'blockquote', 'span', 'div']);

/** Keeps text and structure only. `<a>` loses its href (links are shown as
 *  QR codes elsewhere) and `<img>` keeps only an https src. */
export function sanitizeMailHtml(raw: string): string {
  let input = raw.replace(/<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, '');
  input = input.replace(/<!--[\s\S]*?-->/g, '');
  let out = '';
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const open: string[] = [];
  while ((m = tagRe.exec(input)) !== null) {
    out += input.slice(last, m.index);
    last = tagRe.lastIndex;
    const name = m[1].toLowerCase();
    const attrs = m[2] ?? '';
    const closing = m[0].startsWith('</');
    if (!ALLOWED.has(name)) continue;
    if (name === 'br') { out += '<br />'; continue; }
    if (name === 'img') {
      const src = /src\s*=\s*["']?(https:\/\/[^"'\s>]+)/i.exec(attrs)?.[1];
      if (src) out += `<img src="${src.replace(/"/g, '&quot;')}" alt="" />`;
      continue;
    }
    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) continue;
      open.splice(idx, 1);
      out += `</${name}>`;
      continue;
    }
    open.push(name);
    out += `<${name}>`;
  }
  out += input.slice(last);
  for (let i = open.length - 1; i >= 0; i -= 1) out += `</${open[i]}>`;
  return out;
}
