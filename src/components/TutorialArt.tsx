import { VolumeX } from 'lucide-react';
import { TUTORIAL_SHOTS, SPOT_RECTS } from '@/data/tutorialShots';

interface TutorialArtProps {
  screen: string;
  highlight?: string;
}

/**
 * Schematic "TV screen" mocks used by the How-to-use-SMC tutorial.
 * Chrome 66 floor: no CSS aspect-ratio, no `inset` shorthand, no flex `gap`.
 */

// Chrome 66 has no clamp(): the inline clamp is dropped as invalid and the
// h-[220px] utility class below acts as the plain-px fallback.
const ART_HEIGHT: React.CSSProperties = { height: 'clamp(180px, 34vh, 300px)' };

const PARENT: Record<string, string> = {
  'player-card': 'cards',
  ok: 'dpad',
  'settings-tab': 'tabs',
  pin: 'grid',
};

export default function TutorialArt({ screen, highlight }: TutorialArtProps) {
  // Region wrapper: gold ring + glow when highlighted, dimmed when something else is.
  const R = (name: string, className: string, children?: React.ReactNode, style?: React.CSSProperties) => {
    const isOn = highlight === name;
    const isParentOfActive = !!highlight && PARENT[highlight] === name;
    const isNestedChild = name in PARENT;
    const isOff = !!highlight && !isOn && !isParentOfActive && !isNestedChild;
    return (
      <div
        key={name}
        style={style}
        className={[
          className,
          'transition-opacity duration-300',
          isOn
            ? 'ring-2 ring-brand-gold shadow-[0_0_18px_4px_hsl(45_93%_58%/0.45)] rounded-md animate-pulse opacity-100'
            : '',
          isOff ? 'opacity-35' : 'opacity-100',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
    );
  };

  const box = 'rounded-sm bg-white/15';

  const body = (() => {
    switch (screen) {
      case 'remote':
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className="h-full py-2" style={{ width: '30%', minWidth: '84px' }}>
              <div className="h-full w-full rounded-2xl border border-white/20 bg-slate-800/70 flex flex-col items-center justify-center">
                <div className="h-2 w-8 rounded-full bg-white/20 mb-3" />
                {R(
                  'dpad',
                  'relative rounded-full border border-white/25 bg-slate-700/70',
                  <>
                    <div className="absolute left-1/2 top-1 w-0 h-0 -translate-x-1/2 border-x-4 border-x-transparent border-b-[6px] border-b-white/50" />
                    <div className="absolute left-1/2 bottom-1 w-0 h-0 -translate-x-1/2 border-x-4 border-x-transparent border-t-[6px] border-t-white/50" />
                    <div className="absolute top-1/2 left-1 h-0 w-0 -translate-y-1/2 border-y-4 border-y-transparent border-r-[6px] border-r-white/50" />
                    <div className="absolute top-1/2 right-1 h-0 w-0 -translate-y-1/2 border-y-4 border-y-transparent border-l-[6px] border-l-white/50" />
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                      {R('ok', 'w-6 h-6 rounded-full bg-brand-gold/80')}
                    </div>
                  </>,
                  { width: '64px', height: '64px', borderRadius: '9999px' }
                )}
                <div className="mt-4">{R('back', 'w-10 h-3 rounded-full bg-white/25')}</div>
              </div>
            </div>
          </div>
        );

      case 'home':
        return (
          <div className="w-full h-full flex flex-col justify-between p-3">
            {R(
              'header',
              'flex items-center justify-between',
              <>
                <div className="w-6 h-6 rounded-md bg-brand-ice/40" />
                <div className="h-4 w-16 rounded-full bg-white/20" />
                <div className="flex items-center">
                  <div className="w-8 h-3 rounded-full bg-white/25 mr-1" />
                  <div className="w-5 h-3 rounded-full bg-white/25" />
                </div>
              </>
            )}
            <div className="mt-2">{R('ticker', 'h-2 w-full rounded-full bg-brand-gold/40')}</div>
            <div className="mt-2">
              {R(
                'contentbar',
                'rounded-lg bg-white/5 p-2',
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="rounded-sm bg-white/20" style={{ height: '34px' }} />
                  ))}
                </div>
              )}
            </div>
            <div className="mt-2">
              {R(
                'cards',
                'grid grid-cols-4 gap-2',
                <>
                  <div className="rounded-lg bg-blue-600/50" style={{ height: '44px' }} />
                  <div className="rounded-lg bg-brand-gold/40" style={{ height: '44px' }} />
                  <div className="rounded-lg bg-purple-600/50" style={{ height: '44px' }} />
                  {R('player-card', 'rounded-lg bg-slate-600/60', undefined, { height: '44px' })}
                </>
              )}
            </div>
          </div>
        );

      case 'livetv':
        return (
          <div className="w-full h-full grid grid-cols-[28%_1fr] gap-2 p-3">
            {R(
              'sidebar',
              'rounded-lg bg-white/5 p-2',
              <div className="grid grid-cols-1 gap-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={`h-4 rounded-full ${i === 1 ? 'bg-brand-gold/50' : 'bg-white/15'}`} />
                ))}
              </div>
            )}
            <div className="grid grid-rows-[34%_1fr] gap-2 min-w-0">
              <div className="flex justify-end">
                {R('preview', 'rounded-md bg-slate-700/80 border border-white/10', undefined, {
                  width: '46%',
                  height: '100%',
                })}
              </div>
              {R(
                'list',
                'rounded-lg bg-white/5 p-2',
                <div className="grid grid-cols-1 gap-1.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="grid grid-cols-[1.25rem_1fr] gap-2 items-center">
                      <div className="w-5 h-5 rounded-sm bg-brand-ice/40" />
                      <div className="h-2.5 rounded-full bg-white/20" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case 'controls':
        return (
          <div className="w-full h-full relative bg-black/50 rounded-xl overflow-hidden">
            <div className="absolute left-0 right-0 top-0 bottom-0 flex items-end justify-center p-3">
              <div className="w-full">
                <div className="flex items-end justify-center mb-2" style={{ minHeight: '76px' }}>
                  {R(
                    'subs-menu',
                    'rounded-lg bg-slate-800/90 border border-white/15 p-2 mr-3',
                    <div className="grid grid-cols-1 gap-1">
                      <div className="h-2.5 w-20 rounded-full bg-white/20" />
                      <div className="h-2.5 w-20 rounded-full bg-white/20" />
                      <div className="h-2.5 w-20 rounded-full bg-brand-gold/70" />
                    </div>
                  )}
                  {R(
                    'audio-menu',
                    'rounded-lg bg-slate-800/90 border border-white/15 p-2',
                    <div className="grid grid-cols-1 gap-1">
                      <div className="h-2.5 w-20 rounded-full bg-white/20" />
                      <div className="h-2.5 w-20 rounded-full bg-white/20" />
                      <div className="h-2.5 w-20 rounded-full bg-brand-gold/70 flex items-center justify-center">
                        <VolumeX className="w-2.5 h-2.5 text-slate-900" />
                      </div>
                    </div>
                  )}
                </div>
                {R(
                  'bar',
                  'rounded-full bg-slate-900/80 border border-white/10 px-3 py-2 grid grid-cols-8 gap-2',
                  <>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className={`rounded-full ${i === 3 ? 'bg-brand-gold/70' : 'bg-white/25'}`}
                        style={{ height: '14px' }}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        );

      case 'guide':
        return (
          <div className="w-full h-full p-3">
            {R(
              'grid',
              'relative w-full h-full rounded-lg bg-white/5 p-2',
              <>
                <div className="grid grid-cols-[22%_1fr] gap-2 h-full">
                  <div className="grid grid-cols-1 gap-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="rounded-sm bg-brand-ice/30" />
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 min-w-0">
                    {[
                      [3, 5, 4],
                      [5, 3, 4],
                      [2, 6, 4],
                      [4, 4, 4],
                      [6, 3, 3],
                    ].map((row, ri) => (
                      <div key={ri} className="grid grid-cols-12 gap-1.5">
                        {row.map((w, ci) => (
                          <div
                            key={ci}
                            className={box}
                            style={{ gridColumn: `span ${w} / span ${w}` }}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  className="absolute top-2 bottom-2 w-0.5 bg-brand-gold"
                  style={{ left: '52%' }}
                />
              </>
            )}
          </div>
        );

      case 'multiscreen':
        return (
          <div className="w-full h-full p-3">
            {R(
              'tiles',
              'grid grid-cols-2 grid-rows-2 gap-2 w-full h-full',
              <>
                <div className="rounded-md bg-slate-700/80 ring-2 ring-brand-gold" />
                <div className="rounded-md bg-slate-700/60" />
                <div className="rounded-md bg-slate-700/60" />
                <div className="rounded-md bg-slate-700/60" />
              </>
            )}
          </div>
        );

      case 'chooser':
        return (
          <div className="w-full h-full p-4 grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-blue-600/40 border border-white/10 flex items-center justify-center">
              <div className="rounded-md border-2 border-white/50" style={{ width: '38px', height: '26px' }} />
            </div>
            {R(
              'movies-card',
              'rounded-xl bg-purple-600/40 border border-white/10 flex items-center justify-center',
              <div className="grid grid-cols-1 gap-1">
                <div className="h-1.5 w-10 rounded-full bg-white/60" />
                <div className="h-4 w-10 rounded-sm bg-white/40" />
                <div className="h-1.5 w-10 rounded-full bg-white/60" />
              </div>
            )}
          </div>
        );

      case 'plex-code':
        return (
          <div className="w-full h-full flex items-center justify-center p-4">
            <div className="rounded-xl bg-white/5 border border-white/10 px-5 py-4 flex flex-col items-center">
              {R(
                'code',
                'grid grid-cols-4 gap-2',
                <>
                  {['A', 'B', '4', 'F'].map((c) => (
                    <div
                      key={c}
                      className="rounded-md bg-slate-800 border border-white/20 flex items-center justify-center text-brand-gold font-mono"
                      style={{ width: '30px', height: '38px', fontSize: '15px' }}
                    >
                      {c}
                    </div>
                  ))}
                </>
              )}
              <div className="h-2 w-40 rounded-full bg-white/20 mt-4" />
            </div>
          </div>
        );

      case 'plex-grid':
        return (
          <div className="w-full h-full p-3">
            {R(
              'tabs',
              'flex items-center mb-2',
              <>
                {['a', 'b', 'c', 'd'].map((k) => (
                  <div key={k} className="h-4 w-12 rounded-full bg-white/20 mr-2" />
                ))}
                {R(
                  'settings-tab',
                  'h-4 w-8 rounded-full bg-white/25 flex items-center justify-center',
                  <div className="w-2 h-2 rounded-full border-2 border-brand-gold" />
                )}
              </>
            )}
            {R(
              'grid',
              'grid grid-cols-4 grid-rows-2 gap-2',
              <>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-md bg-white/20" style={{ height: '52px' }} />
                ))}
              </>
            )}
          </div>
        );

      case 'apps':
        return (
          <div className="w-full h-full relative p-3">
            {R(
              'grid',
              'grid grid-cols-3 grid-rows-3 gap-2 w-full h-full',
              <>
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="relative rounded-lg bg-white/15">
                    {i === 2 && (
                      <div className="absolute right-1 top-1">
                        {R('pin', 'w-2.5 h-2.5 rounded-full bg-brand-gold')}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            <div className="absolute left-0 right-0 top-0 bottom-0 flex items-center justify-center pointer-events-none">
              {R(
                'popup',
                'rounded-xl bg-slate-900/95 border border-white/20 p-3 grid grid-cols-1 gap-2 pointer-events-auto',
                <>
                  <div className="h-8 w-32 rounded-md bg-white/15" />
                  <div className="h-3 w-32 rounded-full bg-blue-500/60" />
                  <div className="h-3 w-32 rounded-full bg-emerald-500/60" />
                </>
              )}
            </div>
          </div>
        );

      case 'support':
        return (
          <div className="w-full h-full p-3">
            <div className="flex items-center justify-center mb-2">
              <div className="h-4 w-14 rounded-full bg-white/20 mr-2" />
              {R('ai-tab', 'h-4 w-14 rounded-full bg-white/25 mr-2')}
              <div className="h-4 w-14 rounded-full bg-white/20" />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {R('howto', 'rounded-lg bg-emerald-600/50', undefined, { height: '20px' })}
              {R('speedtest', 'rounded-lg bg-cyan-600/50', undefined, { height: '20px' })}
              {R('guide-card', 'rounded-lg bg-purple-600/50', undefined, { height: '20px' })}
              {R('videos', 'rounded-lg bg-blue-600/50', undefined, { height: '20px' })}
              {R('tickets', 'rounded-lg bg-orange-600/50', undefined, { height: '20px' })}
            </div>
          </div>
        );

      case 'store':
        return (
          <div className="w-full h-full p-3">
            {R(
              'grid',
              'grid grid-cols-3 grid-rows-2 gap-2 w-full h-full',
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-lg bg-white/10 border border-white/10 p-1.5 flex flex-col justify-end">
                    <div className="h-2 w-8 rounded-full bg-brand-gold/70" />
                  </div>
                ))}
              </>
            )}
          </div>
        );

      case 'settings':
        return (
          <div className="w-full h-full flex items-center justify-center p-4">
            <div className="w-2/3 grid grid-cols-1 gap-2">
              <div className="rounded-lg bg-white/15" style={{ height: '22px' }} />
              {R('accounts', 'rounded-lg bg-white/15', undefined, { height: '22px' })}
              {R('appearance', 'rounded-lg bg-white/15', undefined, { height: '22px' })}
              <div className="rounded-lg bg-white/15" style={{ height: '22px' }} />
            </div>
          </div>
        );

      default:
        return null;
    }
  })();

  return (
    <div
      className="w-full max-w-xl mx-auto h-[220px] rounded-2xl border border-white/15 bg-[#0b1220] overflow-hidden"
      style={ART_HEIGHT}
      aria-hidden="true"
    >
      {body}
    </div>
  );
}
