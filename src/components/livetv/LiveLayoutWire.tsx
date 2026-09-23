// A miniature of each Live TV layout, drawn with boxes so it reads from the
// couch. Used by the first-open chooser and by Settings → Appearance.
//
// Chromium 66 (older Android TV WebViews) has no aspect-ratio and no flex
// gap: the 16:9 frame is a padding box, rows are spaced with justify-between
// and margins, and the channel wall is a CSS grid (grid gap works there).
import type { LiveLayout } from '@/lib/liveLayout';

const bar = 'rounded-[2px] bg-white/25';
const hot = 'rounded-[2px] bg-brand-gold';

const Categories = ({ width, count, active }: { width: string; count: number; active: number }) => (
  <div className="h-full flex flex-col justify-between mr-[3%]" style={{ width }}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className={i === active ? hot : bar} style={{ height: `${Math.floor(70 / count)}%` }} />
    ))}
  </div>
);

const LiveLayoutWire = ({ id }: { id: LiveLayout }) => {
  let inner: JSX.Element;
  if (id === 'classic') {
    inner = (
      <>
        <Categories width="24%" count={6} active={1} />
        <div className="flex-1 h-full flex flex-col">
          <div className="rounded-[3px] bg-brand-ice/40 mb-[4%]" style={{ height: '38%' }} />
          <div className="flex-1 flex flex-col justify-between">
            {[0, 1, 2, 3].map((i) => <div key={i} className={i === 0 ? hot : bar} style={{ height: '18%' }} />)}
          </div>
        </div>
      </>
    );
  } else if (id === 'grid') {
    inner = (
      <>
        <Categories width="24%" count={6} active={1} />
        <div
          className="flex-1 h-full"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: 4 }}
        >
          {Array.from({ length: 12 }).map((_, i) => <div key={i} className={i === 0 ? hot : 'rounded-[2px] bg-white/20'} />)}
        </div>
      </>
    );
  } else {
    inner = (
      <>
        <Categories width="42%" count={8} active={2} />
        <div className="flex-1 h-full flex flex-col">
          <div className="flex-1 rounded-[3px] bg-brand-ice/40 mb-[4%]" />
          <div className={`${bar} mb-[3%]`} style={{ height: '7%' }} />
          <div className="rounded-[2px] bg-white/15" style={{ height: '7%' }} />
        </div>
      </>
    );
  }
  return (
    <div className="relative w-full rounded-lg bg-[#0b1020]" style={{ height: 0, paddingBottom: '56.25%' }}>
      <div className="absolute inset-0 p-[4%] flex">{inner}</div>
    </div>
  );
};

export default LiveLayoutWire;
