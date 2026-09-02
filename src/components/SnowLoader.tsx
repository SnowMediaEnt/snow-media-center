/**
 * SnowLoader — Snow Media's loading animation.
 *
 * "Able" (our yeti) pushes a snowball across the box; the snowball grows the
 * longer loading has been going on (1x at 0s, ~1.9x at 10s, ~2.5x at 20s,
 * asymptote 3.2x), so a stalled screen looks like it is *working* rather
 * than frozen.
 *
 *   <SnowLoader />                                  // 96px scene
 *   <SnowLoader size="lg" label="Buffering…" />     // fullscreen player
 *   <SnowLoader size="sm" startedAt={t0} showElapsed />
 *   <SnowLoader imageSrc="/able.png" />             // raster mascot instead of SVG
 *   <AbleMascot className="w-24 h-24" />            // the character alone
 *
 * LOW-MEMORY EXEMPTION (Fire TV): src/main.tsx puts `native-low-memory` on
 * <html>, and src/index.css then sets animation-duration:0.001ms on every
 * element via a (0,3,0) blanket rule. The loader is NOT excluded from that
 * rule with `:not(.smc-loader *)` — Chromium < 88 rejects combinators inside
 * :not() and would drop the whole rule. Instead snow-loader.css re-applies
 * each animated element's duration with explicit (0,4,0) descendant rules
 * (`.native-low-memory .smc-loader .smc-loader-viewport .smc-loader-track`
 * etc.), so the exact class structure below is load-bearing. Nothing here
 * uses <filter>, blur, backdrop blur or `shadow-[…]`, so none of the
 * low-memory strip rules bite either.
 *
 * SWAPPING IN A RASTER ABLE: pass `imageSrc` (PNG/WebP with transparent
 * background, feet on the bottom edge). It renders in the same box as the
 * SVG (height = 75% of the scene, feet on the ground line) and the snowball
 * still grows / rolls / stays glued to the hands.
 *
 * Perf: the only React state is one number updated every 500ms (elapsed
 * ms); all continuous motion is CSS transforms on their own elements.
 */
import { memo, useEffect, useId, useState, type CSSProperties } from 'react';
import './snow-loader.css';

export type SnowLoaderSize = 'sm' | 'md' | 'lg';

export interface SnowLoaderProps {
  /** sm ≈ 56px tall (inline), md ≈ 96px (default), lg ≈ 150px (fullscreen player). */
  size?: SnowLoaderSize;
  /** Optional caption under the scene, e.g. "Buffering…". */
  label?: string;
  /** Epoch ms when loading began. Defaults to mount time. */
  startedAt?: number;
  /** Raster Able; when given it replaces the SVG yeti (same box). */
  imageSrc?: string;
  className?: string;
  /** Show a small "12s" caption under the scene. */
  showElapsed?: boolean;
}

export interface AbleMascotProps {
  className?: string;
  style?: CSSProperties;
}

/* ------------------------------------------------------------------ */
/* Geometry (viewBox units; the Able crop is 142 x 200, ground at y=180) */
/* ------------------------------------------------------------------ */

const SCENE_HEIGHT_PX: Record<SnowLoaderSize, number> = { sm: 56, md: 96, lg: 150 };
/** Snowball radius at 1x in viewBox units (ball diameter = 25% of scene height). */
const BALL_R_UNITS = 25;
const GROWTH_TICK_MS = 500;
const GROWTH_MAX = 2.2;
const GROWTH_TAU_MS = 18000;

/** s(t) = 1 + 2.2 * (1 - e^(-t/18000)); 1x at 0s, ~1.9x at 10s, ~2.5x at 20s, -> 3.2x. */
const growthScale = (elapsedMs: number): number =>
  1 + GROWTH_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / GROWTH_TAU_MS));

/**
 * How far LEFT Able must shift (px) so the hands keep touching the ball.
 * The ball scales about its bottom-centre and the hands sit at the height of
 * the 1x ball's centre (one radius above the ground). The ball's surface at
 * that height is sqrt(2sR·R - R²) = R·sqrt(2s-1) left of the centre, so the
 * nudge is R·(sqrt(2s-1) - 1): 0 at s=1, ≈1.32R at s=3.2.
 */
const handNudgePx = (s: number, ballRadiusPx: number): number =>
  ballRadiusPx * (Math.sqrt(Math.max(1, 2 * s - 1)) - 1);

const sizeClass: Record<SnowLoaderSize, string> = {
  sm: 'smc-loader--sm',
  md: 'smc-loader--md',
  lg: 'smc-loader--lg',
};
const labelClass: Record<SnowLoaderSize, string> = {
  sm: 'smc-loader-label font-quicksand font-semibold text-brand-ice text-xs text-center',
  md: 'smc-loader-label font-quicksand font-semibold text-brand-ice text-sm text-center',
  lg: 'smc-loader-label font-quicksand font-semibold text-brand-ice text-base text-center',
};

/* ------------------------------------------------------------------ */
/* Able (shared shapes)                                                */
/* ------------------------------------------------------------------ */

const BODY_TOP = '#F4F7FB';
const BODY_SHADE = '#DCE6F2';
const FACE = '#8FCBEF';
const FACE_HI = '#B7DFF7';
const MITTEN = '#9DD0F1';
const INK = '#111111';

interface AbleShapesProps {
  /** Unique id prefix for the gradient defs (from useId). */
  uid: string;
}

/**
 * The character, drawn inside a 142 x 200 box, facing right, leaning
 * slightly forward with both arms reaching to x≈141 (where the snowball
 * sits). Feet on y=180. Plain shapes + one linear gradient — no filters.
 */
const AbleShapes = ({ uid }: AbleShapesProps) => {
  const bodyGrad = `${uid}-body`;
  return (
    <>
      <defs>
        <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={BODY_TOP} />
          <stop offset="0.62" stopColor={BODY_TOP} />
          <stop offset="1" stopColor={BODY_SHADE} />
        </linearGradient>
      </defs>

      {/* Feet (behind the body). ONE animated group — rotating about the
          point between them lifts one foot while the other dips. */}
      <g className="smc-loader-feet" fill={MITTEN}>
        {/* back foot */}
        <ellipse cx="46" cy="172" rx="15" ry="7" />
        <circle cx="59" cy="167.5" r="3.4" />
        <circle cx="61.5" cy="172" r="3.4" />
        <circle cx="59" cy="176.5" r="3.4" />
        {/* front foot */}
        <ellipse cx="80" cy="172" rx="16" ry="8" />
        <circle cx="94" cy="167" r="3.6" />
        <circle cx="96.5" cy="172" r="3.6" />
        <circle cx="94" cy="177" r="3.6" />
      </g>

      {/* Body + head, leaning forward (toward the ball). */}
      <g transform="rotate(5 70 120)">
        {/* fluff bumps on the silhouette */}
        <g fill={BODY_TOP}>
          <circle cx="20" cy="112" r="10" />
          <circle cx="19" cy="146" r="9" />
          <circle cx="116" cy="150" r="10" />
          <circle cx="42" cy="54" r="9" />
          <circle cx="102" cy="56" r="9" />
        </g>
        {/* tuft */}
        <path
          d="M60 48 C58 36 66 30 70 42 C72 30 82 30 82 42 C86 34 92 38 88 50 Z"
          fill={BODY_TOP}
        />
        {/* body */}
        <ellipse cx="68" cy="128" rx="52" ry="44" fill={`url(#${bodyGrad})`} />
        {/* head */}
        <circle cx="72" cy="80" r="38" fill={`url(#${bodyGrad})`} />
        {/* underside shading so the belly reads round */}
        <ellipse cx="72" cy="153" rx="34" ry="14" fill={BODY_SHADE} opacity="0.55" />

        {/* back arm (further from viewer) */}
        <path d="M96 118 L128 134" stroke={BODY_SHADE} strokeWidth="15" strokeLinecap="round" fill="none" />
        <ellipse cx="131" cy="134" rx="9" ry="8" fill={MITTEN} />
        <circle cx="127" cy="126" r="3.8" fill={MITTEN} />

        {/* face */}
        <ellipse cx="78" cy="84" rx="26" ry="21" fill={FACE} />
        <ellipse cx="74" cy="74" rx="16" ry="7" fill={FACE_HI} opacity="0.9" />
        {/* cheeks */}
        <ellipse cx="64" cy="93" rx="4" ry="2.5" fill="#F7B9C9" opacity="0.55" />
        <ellipse cx="94" cy="93" rx="4" ry="2.5" fill="#F7B9C9" opacity="0.55" />
        {/* eyes */}
        <circle cx="69" cy="84" r="4.5" fill={INK} />
        <circle cx="88" cy="84" r="4.5" fill={INK} />
        <circle cx="70.6" cy="82.4" r="1.6" fill="#FFFFFF" />
        <circle cx="89.6" cy="82.4" r="1.6" fill="#FFFFFF" />
        {/* smile */}
        <path d="M73 95 Q78.5 100 84 95" stroke={INK} strokeWidth="2.2" strokeLinecap="round" fill="none" />

        {/* front arm (nearer the viewer) */}
        <path d="M100 140 L128 154" stroke={BODY_TOP} strokeWidth="15" strokeLinecap="round" fill="none" />
        <ellipse cx="131" cy="155" rx="9.5" ry="8.5" fill={MITTEN} />
        <circle cx="127" cy="163" r="4" fill={MITTEN} />
      </g>
    </>
  );
};

/** Able on his own (static), centred in a 200 x 200 viewBox. Reusable anywhere. */
export const AbleMascot = ({ className, style }: AbleMascotProps) => {
  const uid = useId();
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(29 0)">
        <AbleShapes uid={uid} />
      </g>
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Snowball                                                            */
/* ------------------------------------------------------------------ */

const SNOW_SHADE = '#E3ECF5';
const FLAKE = '#C9DBEA';

/** Static white ball with a soft shadow crescent at the lower-left. */
const SnowballBase = () => (
  <svg
    className="smc-loader-ball-base"
    viewBox="0 0 50 50"
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="25" cy="25" r="24" fill={SNOW_SHADE} />
    <circle cx="27" cy="22.5" r="21.5" fill="#FFFFFF" />
  </svg>
);

/** Rotating flake dots so the roll is visible. */
const SnowballFlakes = () => (
  <svg
    className="smc-loader-ball-spin"
    viewBox="0 0 50 50"
    aria-hidden="true"
    focusable="false"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g fill={FLAKE}>
      <circle cx="16" cy="14" r="2.2" />
      <circle cx="33" cy="18" r="1.8" />
      <circle cx="20" cy="32" r="2" />
      <circle cx="34" cy="33" r="1.6" />
    </g>
  </svg>
);

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

const SnowLoader = ({
  size = 'md',
  label,
  startedAt,
  imageSrc,
  className,
  showElapsed = false,
}: SnowLoaderProps) => {
  const uid = useId();
  const [mountedAt] = useState(() => Date.now());
  const start = startedAt ?? mountedAt;
  // The ONLY state: elapsed ms, refreshed every 500ms.
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - start);

  useEffect(() => {
    setElapsedMs(Date.now() - start);
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setElapsedMs(Date.now() - start);
    }, GROWTH_TICK_MS);
    return () => clearInterval(id);
  }, [start]);

  const scale = growthScale(elapsedMs);
  const ballRadiusPx = (SCENE_HEIGHT_PX[size] * BALL_R_UNITS) / 200;
  const nudgePx = handNudgePx(scale, ballRadiusPx);

  const ableWrapStyle: CSSProperties = {
    transform: `translate3d(${(-nudgePx).toFixed(2)}px, 0, 0)`,
  };
  const ballStyle: CSSProperties = {
    transform: `scale(${scale.toFixed(3)})`,
  };

  const rootClass = ['smc-loader', sizeClass[size], className].filter(Boolean).join(' ');
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));

  return (
    <div className={rootClass} role="status" aria-label={label ?? 'Loading'}>
      <div className="smc-loader-viewport">
        <div className="smc-loader-ground" />
        <div className="smc-loader-track">
          <div className="smc-loader-scene">
            <div className="smc-loader-able-wrap" style={ableWrapStyle}>
              {imageSrc ? (
                <img
                  className="smc-loader-able-img"
                  src={imageSrc}
                  alt=""
                  draggable={false}
                  decoding="async"
                />
              ) : (
                <svg
                  className="smc-loader-able"
                  viewBox="0 0 142 200"
                  aria-hidden="true"
                  focusable="false"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <AbleShapes uid={uid} />
                </svg>
              )}
            </div>
            <div className="smc-loader-ball" style={ballStyle}>
              <SnowballBase />
              <SnowballFlakes />
            </div>
          </div>
        </div>
      </div>
      {/* aria-hidden: the root's aria-label already names the status; the
          ticking counter must not be re-announced by the live region. */}
      {label ? (
        <div className={labelClass[size]} aria-hidden="true">
          {label}
        </div>
      ) : null}
      {showElapsed ? (
        <div
          className="smc-loader-elapsed text-xs text-brand-ice/70 font-nunito tabular-nums text-center"
          aria-hidden="true"
        >
          {seconds}s
        </div>
      ) : null}
    </div>
  );
};

export default memo(SnowLoader);
