import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Users, Sparkles, Smartphone } from 'lucide-react';
import { useTVFocus, type TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { BackButton } from '@/components/ui/BackButton';
import { BODY, HEADER, SCREEN } from '@/components/billing/shared';
import { focusAttrs, scaleIf, useFocusRecovery } from '@/components/billing/shared';
import { formatMoney } from '@/lib/billing';
import type { SignupLink, SignupOffers } from '@/lib/signupLinks';
import { connectionsLabel, termLabel } from './tierText';
import i18n from '@/i18n';

interface Props {
  offers: SignupOffers;
  onPick: (link: SignupLink) => void;
  onBack: () => void;
}

/** A price of 0 is an offer, not an amount — say so rather than printing $0.00. */
const priceText = (l: SignupLink): string | null => {
  if (l.price === null) return null;
  return l.price === 0 ? i18n.t('getStarted.plans.free') : formatMoney(l.price, l.currency);
};

/**
 * The Vibez tiers, flat and in the panel's own order.
 *
 * Deliberately not grouped by term: the panel currently sells one option per
 * term, so headings would be one card each. Rows come from
 * public.signup_links, which is also where prices live — and an unset price
 * shows the tier without one rather than a number the TV might have wrong,
 * since the hosted page is what actually charges.
 */
const VibezPlanGrid = memo(({ offers, onPick, onBack }: Props) => {
  const { t } = useTranslation();
  // The trial sits in its own full-width card ABOVE the plan grid, so pure
  // spatial navigation could walk down out of it and never find a way back —
  // the card is wider than any grid cell, so nothing below scores it as the
  // best target upward. These few explicit links fix that; everything else
  // still falls through to spatial search.
  // Every tier currently points at the same packages page, because the
  // panel's per-package links redirect to the site root. A picker whose four
  // choices all land in the same place is worse than one honest button, so
  // when the destinations collapse, so does the screen — and it expands again
  // by itself the moment those URLs differ, with no code change.
  const shared = useMemo(() => {
    const all = [...(offers.trial ? [offers.trial] : []), ...offers.plans];
    const urls = new Set(all.map((l) => l.url));
    return all.length > 1 && urls.size === 1 ? all[0] : null;
  }, [offers]);

  const navigation = useMemo<TVFocusNavigationMap>(() => {
    const map: TVFocusNavigationMap = {};
    if (shared) {
      map['vp-go'] = { up: 'back' };
      map.back = { down: 'vp-go' };
      return map;
    }
    const firstRow = offers.plans.slice(0, 3).map((p) => `vp-${p.id}`);
    const trialId = offers.trial ? 'vp-trial' : null;
    if (trialId) map[trialId] = { up: 'back', down: firstRow[0] };
    for (const id of firstRow) map[id] = { up: trialId ?? 'back' };
    map.back = { down: trialId ?? firstRow[0] };
    return map;
  }, [offers, shared]);

  const { containerRef, currentFocusId, focusById } = useTVFocus({
    navigation,
    initialFocusId: 'back',
    onBack,
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'back');

  // Land on the first real offer rather than the Back button.
  useEffect(() => {
    const first = shared ? 'vp-go' : offers.trial ? 'vp-trial' : offers.plans[0] ? `vp-${offers.plans[0].id}` : null;
    if (!first) return;
    const t = window.setTimeout(() => focusById(first), 40);
    return () => window.clearTimeout(t);
  }, [offers, shared, focusById]);

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className={HEADER}>
        <div className="flex items-center gap-3">
          <BackButton onClick={onBack} label={t('common.back')} data-player-header-btn="" focused={currentFocusId === 'back'} data-tv-focus-id="back" />
          <div>
            <h1 className="text-2xl font-quicksand font-bold text-white leading-tight">{t('getStarted.plans.title')}</h1>
            <p className="text-xs text-brand-ice/70 font-nunito flex items-center gap-1">
              <Smartphone className="w-3 h-3" /> {t('getStarted.plans.subtitle')}
            </p>
          </div>
        </div>
      </div>

      <div className={BODY}>
        <div className="w-full max-w-5xl space-y-6 pb-10">
          {shared ? (
            <>
              <Card
                onClick={() => onPick({ ...shared, label: 'Vibez' })}
                className={`tv-ring cursor-pointer rounded-2xl p-6 min-h-[7rem] bg-slate-900/70 border border-brand-gold/50 transition-transform duration-150 ease-out ${scaleIf(currentFocusId, 'vp-go')}`}
                {...focusAttrs(currentFocusId, 'vp-go')}
              >
                <div className="flex items-center gap-3">
                  <Smartphone className="w-7 h-7 text-brand-gold shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xl font-quicksand font-bold text-white leading-tight">{t('getStarted.plans.seePlans')}</div>
                    <div className="text-brand-ice/80 font-nunito text-sm">
                      {t('getStarted.plans.seePlansDesc')}
                    </div>
                  </div>
                </div>
              </Card>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="text-xs uppercase tracking-wide text-white/60 mb-3">{t('getStarted.plans.whatOffers')}</div>
                <ul className="space-y-2">
                  {[...(offers.trial ? [offers.trial] : []), ...offers.plans].map((l) => (
                    <li key={l.id} className="flex items-baseline justify-between gap-4 text-white font-nunito">
                      <span className="min-w-0">
                        {l.kind === 'trial' ? t('getStarted.plans.trial') : (l.label ?? (termLabel(l.termMonths) || t('getStarted.plans.plan')))}
                        {l.connections ? <span className="text-brand-ice/60"> · {connectionsLabel(l.connections)}</span> : null}
                        {l.kind === 'trial' && l.label ? <span className="text-brand-ice/60"> · {l.label}</span> : null}
                      </span>
                      <span className="shrink-0 font-quicksand font-bold text-brand-gold">{priceText(l) ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          {!shared && offers.trial && (
            <Card
              onClick={() => onPick(offers.trial!)}
              className={`tv-ring cursor-pointer rounded-2xl p-6 min-h-[7rem] bg-slate-900/70 border border-brand-gold/50 transition-transform duration-150 ease-out ${scaleIf(currentFocusId, 'vp-trial')}`}
              {...focusAttrs(currentFocusId, 'vp-trial')}
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <Sparkles className="w-7 h-7 text-brand-gold shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xl font-quicksand font-bold text-white leading-tight">{t('getStarted.plans.trial')}</div>
                    <div className="text-brand-ice/80 font-nunito text-sm">
                      {offers.trial.label ? t('getStarted.plans.trialSubLabel', { label: offers.trial.label }) : t('getStarted.plans.noCard')}
                      {offers.trial.connections ? ` · ${connectionsLabel(offers.trial.connections)}` : ''}
                    </div>
                  </div>
                </div>
                <div className="text-2xl font-quicksand font-bold text-brand-gold shrink-0">
                  {priceText(offers.trial) ?? t('getStarted.plans.free')}
                </div>
              </div>
            </Card>
          )}

          {!shared && offers.plans.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {offers.plans.map((p) => {
                const id = `vp-${p.id}`;
                const price = priceText(p);
                return (
                  <Card
                    key={p.id}
                    onClick={() => onPick(p)}
                    className={`tv-ring cursor-pointer rounded-2xl p-5 min-h-[8rem] bg-slate-900/70 border border-white/10 transition-transform duration-150 ease-out ${scaleIf(currentFocusId, id)}`}
                    {...focusAttrs(currentFocusId, id)}
                  >
                    <div className="text-xl font-quicksand font-bold text-white leading-tight">
                      {p.label ?? (termLabel(p.termMonths) || t('getStarted.plans.plan'))}
                    </div>
                    <div className="flex items-center gap-2 text-brand-ice/80 font-nunito text-sm mt-1">
                      <Users className="w-4 h-4" />
                      {connectionsLabel(p.connections) || t('getStarted.plans.streamingPlan')}
                    </div>
                    <div className="mt-4">
                      {price ? (
                        <span className="text-3xl font-quicksand font-bold text-brand-gold">{price}</span>
                      ) : (
                        <span className="text-sm text-brand-ice/60 font-nunito">{t('getStarted.plans.priceNext')}</span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

VibezPlanGrid.displayName = 'VibezPlanGrid';
export default VibezPlanGrid;
