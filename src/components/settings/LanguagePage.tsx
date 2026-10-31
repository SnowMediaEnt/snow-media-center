// Settings › Language: one tile per language, in its own name. For everyone:
// admin or not, Kids profile or not, the website demo too.
import { useTranslation } from 'react-i18next';
import { Check, Languages } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import type { PageFocus } from './SettingsRows';

interface Props {
  f: PageFocus;
  current: string;
  onPick: (code: string) => void;
}

const LanguagePage = ({ f, current, onPick }: Props) => {
  const { t } = useTranslation();
  return (
    // px-5 lines its icon and title up with the rows of the other pages (panel p-1.5 + row px-3.5).
    <section className="rounded-2xl bg-slate-800/55 border border-white/10 px-5 py-3.5" data-howto="set.language">
      <div className="flex items-center mb-3">
        <Languages className="w-5 h-5 text-brand-gold mr-3.5 shrink-0" />
        <p className="text-sm text-white/65 leading-snug">{t('settings.language.description')}</p>
      </div>
      {/* Grid gap (not flex gap) is fine on the oldest box WebViews. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => {
          const id = `ui-language-${lang.code}`;
          const selected = current.startsWith(lang.code);
          return (
            <button
              key={lang.code}
              type="button"
              tabIndex={-1}
              {...f.attrs(id)}
              aria-pressed={selected}
              onClick={() => { f.pick(id); onPick(lang.code); }}
              // The language in use: a gold outline and a check, no fill (one focus look).
              className={`tv-ring flex items-center justify-between h-10 px-3.5 rounded-lg border text-sm lg:text-base transition-colors duration-150 ${
                selected ? 'border-brand-gold text-white' : 'border-white/15 text-slate-100'
              } ${f.is(id) ? 'bg-white/[0.08]' : 'bg-slate-900/60'}`}
            >
              <span dir="auto" className="font-medium min-w-0 truncate">{lang.nativeName}</span>
              {selected && <Check className="w-4 h-4 text-brand-gold shrink-0 ml-2" />}
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default LanguagePage;
