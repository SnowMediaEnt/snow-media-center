// "Getting ready…" while the native player holds a film's start to fill its
// buffer (up to 10 s; see preBuffer.ts). Its own component so the progress
// ticks re-render only this, never the whole Plex section.
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import SnowLoader from '@/components/SnowLoader';
import { usePreBuffer } from '@/lib/preBuffer';

const PreBufferIndicator = memo(() => {
  const { t } = useTranslation();
  const { active, progress } = usePreBuffer();
  if (!active) return null;
  const pct = Math.round(progress * 100);
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" role="status" aria-live="polite">
      <div className="w-full max-w-md px-4">
        <SnowLoader size="lg" label={t('live.preBuffer.title')} />
        <div className="mx-auto mt-3 h-1.5 w-48 rounded-full bg-white/15 overflow-hidden">
          <div className="h-full rounded-full bg-brand-gold transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-center text-xs text-brand-ice/70 font-nunito">{t('live.preBuffer.body')}</p>
      </div>
    </div>
  );
});
PreBufferIndicator.displayName = 'PreBufferIndicator';
export default PreBufferIndicator;
