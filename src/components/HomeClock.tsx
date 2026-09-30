import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { getAppLanguage } from '@/i18n';
import { useUpdateCheck } from '@/hooks/useUpdateCheck';
import { setPausableInterval } from '@/utils/pausableInterval';

/**
 * The clock shows the weekday and the seconds, which src/i18n/format.ts does not
 * offer, so it keeps its own formatters: one pair per language (creating one is slow
 * on weak boxes and this ticks every second), a 12-hour clock, and Arabic with 0-9.
 */
const clockFormats = new Map<string, { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat }>();
const clockFormatFor = (lang: string) => {
  let f = clockFormats.get(lang);
  if (!f) {
    const locale = lang === 'ar' ? 'ar-u-nu-latn' : lang;
    f = {
      date: new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
    };
    clockFormats.set(lang, f);
  }
  return f;
};

interface HomeClockProps {
  version: string;
  onUpdateClick?: () => void;
}

/**
 * Isolated clock component — re-renders every second WITHOUT
 * re-rendering the rest of the home tree. Shaves significant work
 * on low-power STB/FireTV devices. Home's top row (HomeTopBar in
 * Index.tsx) places it, between the renewal banner and the header.
 */
const HomeClock = memo(({ version, onUpdateClick }: HomeClockProps) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const format = clockFormatFor(getAppLanguage());
  const { updateAvailable, latestVersion } = useUpdateCheck(version);

  useEffect(() => {
    // 1s clock — pause while app is backgrounded so we don't re-render
    // every second on devices that aren't even visible.
    return setPausableInterval(() => setNow(new Date()), 1000);
  }, []);

  return (
    <div
      data-home-clock
      data-howto="home.clock"
      style={{ maxWidth: 'min(80vw, 32rem)' }}
    >
      <div className="bg-black/80 rounded-full border border-white/20 shadow-lg flex items-center gap-3 px-4 py-2 sm:gap-4 sm:px-5 md:gap-5 md:px-6 md:py-2.5 whitespace-nowrap overflow-hidden">
        <div
          className="font-bold font-quicksand text-shadow-soft text-white"
          style={{ fontSize: 'clamp(0.65rem, 0.95vw, 1rem)' }}
        >
          {format.date.format(now)}
        </div>
        <div className="w-px h-4 bg-white/40 flex-shrink-0" />
        <div
          className="opacity-90 font-nunito text-shadow-soft text-white"
          style={{ fontSize: 'clamp(0.65rem, 0.95vw, 1rem)' }}
        >
          {format.time.format(now)}
        </div>
        <div className="w-px h-4 bg-white/40 flex-shrink-0" />
        <div
          className="font-nunito text-shadow-soft flex items-center gap-1.5"
          style={{ color: '#FFD700', fontSize: 'clamp(0.65rem, 0.95vw, 1rem)' }}
        >
          v{version}
          {updateAvailable && (
            <button
              type="button"
              onClick={onUpdateClick}
              title={latestVersion ? t('home.clock.updateTitle', { version: latestVersion }) : t('home.clock.updateTitleShort')}
              aria-label={t('home.clock.updateAria')}
              className="flex items-center justify-center rounded-full p-0.5 hover:bg-white/10 transition-colors animate-pulse"
            >
              <AlertTriangle
                className="text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]"
                style={{ width: 'clamp(14px, 1.1vw, 20px)', height: 'clamp(14px, 1.1vw, 20px)' }}
                fill="currentColor"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

HomeClock.displayName = 'HomeClock';

export default HomeClock;
