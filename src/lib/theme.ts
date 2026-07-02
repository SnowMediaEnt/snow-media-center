// Theming engine — plain module, no React. Called from main.tsx pre-mount.
// Colors are HSL TRIPLET strings (e.g. "39 31% 60%") consumed as hsl(var(--x)).

export type ThemeSettings = {
  fontScale: number;
  fontFamily: string;
  textColor: string;
  bgColor: string;
  accentColor: string;
};

export const THEME_KEY = 'snow-theme';
export const THEME_EVENT = 'snow-theme-changed';

export const DEFAULT_THEME: ThemeSettings = {
  fontScale: 1,
  fontFamily: 'nunito',
  textColor: '0 0% 20%',
  bgColor: '0 0% 100%',
  accentColor: '39 31% 60%',
};

export const FONT_SCALES = [
  { id: 'sm', label: 'Small', value: 0.85 },
  { id: 'md', label: 'Medium', value: 1 },
  { id: 'lg', label: 'Large', value: 1.15 },
  { id: 'xl', label: 'XL', value: 1.3 },
];

export const FONT_FAMILIES = [
  { id: 'nunito', label: 'Nunito (Default)', stack: "'Nunito',sans-serif" },
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat',sans-serif" },
  { id: 'system', label: 'System', stack: 'system-ui,-apple-system,Roboto,sans-serif' },
];

export const ACCENT_SWATCHES = [
  { id: 'gold', label: 'Gold', hsl: '39 31% 60%' },
  { id: 'ice', label: 'Ice', hsl: '189 37% 80%' },
  { id: 'purple', label: 'Purple', hsl: '265 80% 62%' },
  { id: 'emerald', label: 'Emerald', hsl: '152 60% 45%' },
  { id: 'crimson', label: 'Crimson', hsl: '0 72% 51%' },
  { id: 'amber', label: 'Amber', hsl: '43 96% 56%' },
];

export const BG_SWATCHES = [
  { id: 'white', label: 'White', hsl: '0 0% 100%' },
  { id: 'snow', label: 'Snow', hsl: '210 20% 96%' },
  { id: 'charcoal', label: 'Charcoal', hsl: '0 0% 12%' },
  { id: 'navy', label: 'Navy', hsl: '214 60% 14%' },
  { id: 'midnight', label: 'Midnight', hsl: '230 25% 10%' },
];

export const TEXT_SWATCHES = [
  { id: 'charcoal', label: 'Charcoal', hsl: '0 0% 20%' },
  { id: 'black', label: 'Black', hsl: '0 0% 8%' },
  { id: 'white', label: 'White', hsl: '0 0% 98%' },
  { id: 'ice', label: 'Ice', hsl: '189 37% 80%' },
];

const validScale = (v: unknown): number => {
  const n = typeof v === 'number' ? v : NaN;
  return FONT_SCALES.some(s => s.value === n) ? n : DEFAULT_THEME.fontScale;
};
const validFamily = (v: unknown): string =>
  FONT_FAMILIES.some(f => f.id === v) ? (v as string) : DEFAULT_THEME.fontFamily;
const validColor = (v: unknown, table: { hsl: string }[], fallback: string): string =>
  typeof v === 'string' && (v === fallback || table.some(s => s.hsl === v)) ? v : fallback;

export function readTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { ...DEFAULT_THEME };
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      fontScale: validScale(parsed.fontScale),
      fontFamily: validFamily(parsed.fontFamily),
      textColor: validColor(parsed.textColor, TEXT_SWATCHES, DEFAULT_THEME.textColor),
      bgColor: validColor(parsed.bgColor, BG_SWATCHES, DEFAULT_THEME.bgColor),
      accentColor: validColor(parsed.accentColor, ACCENT_SWATCHES, DEFAULT_THEME.accentColor),
    };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function applyTheme(t: ThemeSettings): void {
  try {
    const root = document.documentElement;
    const stack = (FONT_FAMILIES.find(f => f.id === t.fontFamily) ?? FONT_FAMILIES[0]).stack;
    root.style.setProperty('--user-font-scale', String(t.fontScale));
    root.style.setProperty('--user-font-family', stack);
    root.style.setProperty('--user-text', t.textColor);
    root.style.setProperty('--user-bg', t.bgColor);
    root.style.setProperty('--brand-gold', t.accentColor);
    root.dataset.userTheme = '1';
  } catch { /* ignore */ }
}

export function setTheme(patch: Partial<ThemeSettings>): ThemeSettings {
  const merged: ThemeSettings = { ...readTheme(), ...patch };
  try { localStorage.setItem(THEME_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  applyTheme(merged);
  try { window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: merged })); } catch { /* ignore */ }
  return merged;
}

export function resetTheme(): ThemeSettings {
  return setTheme(DEFAULT_THEME);
}
