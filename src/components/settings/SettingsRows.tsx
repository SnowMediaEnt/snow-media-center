// The pieces every Settings page is built from: a slim row (icon, title, a
// short line under it, its control on the right), the quiet panel that holds a
// run of rows, and a row of choice chips. Shared so the pages look like one
// screen, and like Live TV › Settings beside them.
import type { ComponentType, HTMLAttributes, ReactNode } from 'react';
import { Check } from 'lucide-react';

/** What a page needs from Settings to draw the remote's highlight. */
export interface PageFocus {
  /** The data attributes of an item: its id (Settings' keys look it up) and whether the remote is on it. */
  attrs: (id: string) => { 'data-settings-focus': string; 'data-focused': 'true' | 'false' };
  /** The remote is on this item. */
  is: (id: string) => boolean;
  /** A tap or air-mouse click on an item: the remote goes there. */
  pick: (id: string) => void;
}

/**
 * One setting: icon, title, a short line under it, and its control on the
 * right. The remote's highlight is the tv-ring plus a faint fill; no zoom,
 * which a row inside a panel would only clip. py-2 keeps a one-line row
 * about 40px (owner: slim controls, no bulky UI).
 */
export const SettingRow = ({ focused, icon: Icon, title, description, control, children, className = '', ...rest }: {
  focused: boolean;
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) => (
  <div
    tabIndex={-1}
    role="button"
    {...rest}
    className={`tv-ring flex items-start rounded-xl px-3.5 py-2 cursor-pointer transition-colors duration-150 ${focused ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'} ${className}`}
  >
    {/* Beside the title, not the middle of a two-line row; the control stays centered. */}
    <Icon className="w-5 h-5 text-brand-gold shrink-0 mr-3.5 mt-0.5" />
    <div className="min-w-0 flex-1">
      <div className="text-base font-semibold text-white leading-snug">{title}</div>
      {description ? <div className="text-sm text-white/65 leading-snug mt-0.5">{description}</div> : null}
      {children}
    </div>
    {control ? <div className="shrink-0 ml-4 self-center">{control}</div> : null}
  </div>
);

/** A quiet panel that holds a run of related rows. (space-y, not flex gap: old box WebViews.) */
export const SettingsGroup = ({ children, ...rest }: { children: ReactNode } & HTMLAttributes<HTMLElement>) => (
  <section {...rest} className="rounded-2xl bg-slate-800/55 border border-white/10 p-1.5 space-y-0.5">
    {children}
  </section>
);

/**
 * The choices of a row (OK steps through them; a tap picks one). The one in
 * use has a gold outline and a check, never a fill: only the remote's
 * highlight may look highlighted (owner, 2026-10-29: one focus look).
 */
export function ChoiceChips<T extends string>({ choices, value, label, onPick }: {
  choices: readonly T[];
  value: T;
  label: (c: T) => string;
  onPick: (c: T) => void;
}) {
  return (
    <div className="flex flex-wrap mt-1.5 -ml-1">
      {choices.map((c) => (
        <button
          key={c}
          type="button"
          tabIndex={-1}
          data-choice={c}
          aria-pressed={value === c}
          onClick={(e) => { e.stopPropagation(); onPick(c); }}
          className={`ml-1 mt-1 inline-flex items-center rounded-lg border px-3 py-1 text-sm font-semibold bg-slate-900/60 ${value === c ? 'border-brand-gold text-white' : 'border-white/15 text-slate-300'}`}
        >
          {value === c && <Check className="w-3.5 h-3.5 mr-1.5 text-brand-gold shrink-0" />}
          {label(c)}
        </button>
      ))}
    </div>
  );
}

/** What a page with nothing to pick says instead. */
export const PageNote = ({ text }: { text: string }) => (
  <div className="rounded-2xl bg-slate-800/55 border border-white/10 px-5 py-4 text-brand-ice/85 font-nunito text-base">{text}</div>
);
