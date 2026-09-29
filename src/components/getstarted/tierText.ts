// Words for a Vibez tier ("3 months", "9 connections", "3 months · 9 connections"),
// in the app's language. lib/signupLinks re-exports them under its older names; the
// operator's own label on a row (link.label) is shown as written.
import i18n from '@/i18n';
import type { SignupLink } from '@/lib/signupLinks';

export function termLabel(months: number | null): string {
  if (!months) return '';
  if (months === 12) return i18n.t('getStarted.tier.year');
  return i18n.t('getStarted.tier.month', { count: months });
}

export function connectionsLabel(n: number | null): string {
  if (!n) return '';
  return i18n.t('getStarted.tier.connections', { count: n });
}

/** A one-line name for a tier, e.g. "1 year · 9 connections". */
export function tierLabel(l: SignupLink): string {
  if (l.label) return l.label;
  return [termLabel(l.termMonths), connectionsLabel(l.connections)].filter(Boolean).join(' · ') || i18n.t('getStarted.tier.plan');
}
