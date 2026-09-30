import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HowtoArt, ShotRect } from '@/data/howtoContract';
import TutorialArt from '@/components/TutorialArt';
import RemoteDiagram, { REMOTE_BODY, REMOTE_RECTS, REMOTE_SIDES } from './RemoteDiagram';
import RemoteHintChip, { CHIP_HEIGHT_PX, CHIP_OFFSET_PX, HINT_KEY, chipWidthPx } from './RemoteHintChip';
import {
  ARROW_PX,
  BADGE_PX,
  DEFAULT_FRAME,
  LABEL_FONT_PX,
  LABEL_LINE_PX,
  layoutCallouts,
  spotlightHoles,
  type Box,
  type Callout,
  type CalloutInput,
  type FrameSize,
  type LabelSize,
} from './calloutLayout';
import { normalizeLang, resolveShot } from './shotSource';

export interface HowtoShotProps { art: HowtoArt; titleKey?: string }

const GOLD = 'hsl(39, 31%, 60%)';
const RING_GLOW = '0 0 14px 3px hsla(39, 31%, 60%, 0.55)';
const FRAME_STYLE: React.CSSProperties = { paddingTop: '56.25%' };
const FILL = 'absolute top-0 left-0 right-0 bottom-0';

/** The spotlight is a still ring on boxes that freeze animations (Fire TV sticks). */
const isLowMemory = () => {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
};

/** The arrow from a label to its ring: a triangle at the ring end, a thin stem if the label had to move away. */
function Pointer({ edge, offset, length }: { edge: 'top' | 'bottom' | 'left' | 'right'; offset: number; length: number }) {
  const T = 'solid transparent';
  const G = `${ARROW_PX}px solid ${GOLD}`;
  const stem: React.CSSProperties = { position: 'absolute', backgroundColor: GOLD };
  const tri: React.CSSProperties = { position: 'absolute', width: 0, height: 0 };
  if (edge === 'top' || edge === 'bottom') {
    const up = edge === 'top';
    return (
      <div style={{ position: 'absolute', left: offset + '%', width: 0, height: length + 'px', ...(up ? { bottom: '100%' } : { top: '100%' }) }}>
        <div style={{ ...tri, left: -ARROW_PX + 'px', ...(up ? { top: 0, borderBottom: G } : { bottom: 0, borderTop: G }), borderLeft: `${ARROW_PX}px ${T}`, borderRight: `${ARROW_PX}px ${T}` }} />
        <div style={{ ...stem, left: '-1.5px', width: '3px', ...(up ? { top: ARROW_PX + 'px', bottom: 0 } : { top: 0, bottom: ARROW_PX + 'px' }) }} />
      </div>
    );
  }
  const toRight = edge === 'left'; // label is right of the ring: the arrow points left
  return (
    <div style={{ position: 'absolute', top: offset + '%', height: 0, width: length + 'px', ...(toRight ? { right: '100%' } : { left: '100%' }) }}>
      <div style={{ ...tri, top: -ARROW_PX + 'px', ...(toRight ? { left: 0, borderRight: G } : { right: 0, borderLeft: G }), borderTop: `${ARROW_PX}px ${T}`, borderBottom: `${ARROW_PX}px ${T}` }} />
      <div style={{ ...stem, top: '-1.5px', height: '3px', ...(toRight ? { left: ARROW_PX + 'px', right: 0 } : { left: 0, right: ARROW_PX + 'px' }) }} />
    </div>
  );
}

interface LabelItem { id: string; text: string; rect: ShotRect; side?: CalloutInput['side']; anchor?: Box }

/** Dim layer, rings and labels over whatever is drawn under them. */
function Spotlight({ items, frame, avoid }: { items: LabelItem[]; frame: FrameSize; avoid: Box[] }) {
  const still = useMemo(isLowMemory, []);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);
  // Real label sizes, kept per slide/frame: a new slide starts from estimates again.
  const signature = items.map((i) => i.id + ':' + i.text).join('|') + '@' + frame.width + 'x' + frame.height;
  const [measured, setMeasured] = useState<{ key: string; list: (LabelSize | undefined)[] }>({ key: '', list: [] });
  const sizes = measured.key === signature ? measured.list : [];
  const inputs: CalloutInput[] = items.map((i) => ({ rect: i.rect, chars: i.text.length, side: i.side, anchor: i.anchor }));
  const callouts: Callout[] = layoutCallouts(inputs, { frame, sizes, avoid });

  // Measure the drawn labels; if the estimate was off, lay out once more before paint.
  // Runs after every render on purpose: it only sets state when a size really changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    let changed = false;
    const next = items.map((_, i) => {
      const el = nodes.current[i];
      if (!el || !el.offsetWidth || !el.offsetHeight) return sizes[i];
      const size = { width: (el.offsetWidth / frame.width) * 100, height: (el.offsetHeight / frame.height) * 100 };
      const old = sizes[i];
      if (old && Math.abs(old.width - size.width) <= 0.3 && Math.abs(old.height - size.height) <= 0.3) return old;
      changed = true;
      return size;
    });
    if (changed) setMeasured({ key: signature, list: next });
  });

  const holes = spotlightHoles(callouts.map((c) => c.ring));
  const path = 'M0 0H100V100H0Z' + holes.map((h) => `M${h.left} ${h.top}h${h.width}v${h.height}h${-h.width}Z`).join('');

  return (
    <>
      {callouts.length > 0 && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={FILL} focusable="false" data-testid="howto-dim">
          <path d={path} fillRule="evenodd" fill="rgba(0,0,0,0.6)" />
        </svg>
      )}
      {callouts.map((c, i) => (
        <div
          key={'ring-' + items[i].id}
          data-testid="howto-ring"
          className={'absolute rounded-lg border-[3px] border-brand-gold' + (still ? '' : ' animate-pulse')}
          style={{ left: c.ring.left + '%', top: c.ring.top + '%', width: c.ring.width + '%', height: c.ring.height + '%', boxShadow: RING_GLOW }}
        />
      ))}
      {callouts.map((c, i) => (
        <div
          key={'label-' + items[i].id}
          ref={(el) => { nodes.current[i] = el; }}
          data-testid="howto-label"
          className="absolute flex items-center rounded-lg bg-brand-gold text-brand-navy font-bold"
          style={{
            left: c.label.left + '%',
            top: c.label.top + '%',
            maxWidth: c.label.maxWidth + '%',
            padding: '5px 10px',
            fontSize: LABEL_FONT_PX + 'px',
            lineHeight: LABEL_LINE_PX + 'px',
            boxShadow: '0 3px 10px rgba(0,0,0,0.65)',
          }}
        >
          {c.badge !== null && (
            <span
              data-testid="howto-badge"
              className="flex-shrink-0 flex items-center justify-center rounded-full bg-brand-navy text-brand-gold font-extrabold"
              style={{ width: BADGE_PX - 6 + 'px', height: BADGE_PX - 6 + 'px', marginRight: '6px', fontSize: '14px', lineHeight: '1' }}
            >
              {c.badge}
            </span>
          )}
          <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', textAlign: 'left' }}>{items[i].text}</span>
          {c.pointer && <Pointer edge={c.pointer.edge} offset={c.pointer.offset} length={c.pointer.length} />}
        </div>
      ))}
    </>
  );
}

/**
 * One slide's picture: the real screenshot (drawn remote for `remote`), the
 * rest of the screen dimmed, a gold ring and a numbered label on each
 * highlight, and a small remote hint. No picture yet -> the old schematic.
 * The slide's text says everything, so the frame is hidden from screen readers.
 */
export default function HowtoShot({ art }: HowtoShotProps) {
  const { t, i18n } = useTranslation();
  const lang = normalizeLang(i18n.language);
  const isRemote = art.shot === 'remote';
  const resolved = useMemo(() => (isRemote ? null : resolveShot(art.shot, lang)), [isRemote, art.shot, lang]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = !!resolved && failedUrl !== resolved.url;

  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<FrameSize>(DEFAULT_FRAME);
  useLayoutEffect(() => {
    const measure = () => {
      const el = frameRef.current;
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        setFrame((old) => (old.width === el.offsetWidth && old.height === el.offsetHeight ? old : { width: el.offsetWidth, height: el.offsetHeight }));
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const hintText = art.remote ? t(HINT_KEY[art.remote]) : '';
  const rects = isRemote ? REMOTE_RECTS : resolved?.rects;
  const items: LabelItem[] = (art.highlights ?? [])
    .filter((h) => rects && rects[h.id])
    .slice(0, 3)
    .map((h) => ({
      id: h.id,
      text: t(h.labelKey),
      rect: rects![h.id],
      side: isRemote ? REMOTE_SIDES[h.id] : undefined,
      anchor: isRemote ? REMOTE_BODY : undefined,
    }));

  // The hint chip sits bottom-left; labels keep off it.
  const avoid: Box[] = art.remote
    ? [{
        left: (CHIP_OFFSET_PX / frame.width) * 100,
        width: (chipWidthPx(hintText) / frame.width) * 100,
        height: (CHIP_HEIGHT_PX / frame.height) * 100,
        top: 100 - ((CHIP_OFFSET_PX + CHIP_HEIGHT_PX) / frame.height) * 100,
      }]
    : [];

  const chip = art.remote ? <RemoteHintChip hint={art.remote} /> : null;

  if (!isRemote && !showImage) {
    return (
      <TutorialArt shot={art.shot} highlight={art.highlights && art.highlights[0] ? art.highlights[0].id : undefined}>
        {chip}
      </TutorialArt>
    );
  }

  return (
    <div ref={frameRef} dir="ltr" aria-hidden="true" data-testid="howto-frame" className="relative w-full" style={FRAME_STYLE}>
      <div className={FILL + ' overflow-hidden rounded-xl border border-white/15 bg-[#0b1220]'}>
        {isRemote ? (
          <RemoteDiagram />
        ) : (
          <img
            key={resolved!.url}
            src={resolved!.url}
            decoding="async"
            alt=""
            className={FILL}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setFailedUrl(resolved!.url)}
          />
        )}
        <Spotlight items={items} frame={frame} avoid={avoid} />
        {chip}
      </div>
    </div>
  );
}
