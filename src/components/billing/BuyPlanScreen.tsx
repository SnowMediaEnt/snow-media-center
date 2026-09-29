import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { ShoppingCart, Loader2, Users } from 'lucide-react';
import { useTVFocus } from '@/hooks/useTVFocus';
import { useToast } from '@/hooks/use-toast';
import { BackButton } from '@/components/ui/BackButton';
import { SmcBilling, type BillingOrderResult, type BillingPlan } from '@/capacitor/SmcBilling';
import { formatMoney, groupPlans, connectionsLabel, termLabel, toBillingError, type PlanGroup } from '@/lib/billing';
import { BODY, HEADER, SCREEN, focusAttrs, scaleIf, useRateLimit, useBillingErrorHandler, useFocusRecovery } from './shared';
import { Spinner, RateLimitNote } from './SharedUi';

interface Props {
  onBack: () => void;
  /** The order was placed; the caller takes it from here (pay, then wait for the line). */
  onOrdered: (order: BillingOrderResult, plan: BillingPlan) => void;
  onAuthLost: () => void;
}

/**
 * GET /plans → orderable plans grouped by term. Selecting one POSTs /orders.
 * An order for a plan the viewer already started comes back `reused: true`
 * and is treated exactly like a new one — the caller opens its invoice.
 */
const BuyPlanScreen = memo(({ onBack, onOrdered, onAuthLost }: Props) => {
  const [groups, setGroups] = useState<PlanGroup[] | null>(null);
  // Why the list is empty matters: "the server sent none" and "it sent some
  // but none can be ordered" are different problems with different fixes, and
  // a bare "no plans available" hides both.
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<number | null>(null);
  const { t } = useTranslation();
  const { toast } = useToast();
  const { blocked, secondsLeft, block } = useRateLimit();
  const handleError = useBillingErrorHandler({ onAuthLost, block });

  const { containerRef, currentFocusId, focusById } = useTVFocus({
    initialFocusId: 'back',
    onBack: () => { if (ordering === null) onBack(); },
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'back');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await SmcBilling.plans();
      const all = r.plans ?? [];
      const g = groupPlans(all);
      const shown = g.reduce((n, grp) => n + grp.plans.length, 0);
      if (shown === 0) {
        const blocked = all.filter((p) => !p.trial && !p.orderable).length;
        setDiagnosis(
          all.length === 0
            ? t('billing.buy.diagnosisNone')
            : blocked > 0
              ? (blocked === 1
                ? t('billing.buy.diagnosisOne', { count: all.length })
                : t('billing.buy.diagnosisMany', { total: all.length }))
              : t('billing.buy.diagnosisTrialsOnly'),
        );
      } else {
        setDiagnosis(null);
      }
      setGroups(g);
      return g;
    } catch (e) {
      const err = handleError(e, t('billing.buy.loadFailedTitle'));
      if (!err.isAuthError) setLoadError(t('billing.buy.loadError'));
      setGroups([]);
      return [];
    }
  }, [handleError, t]);

  useEffect(() => { void load(); }, [load]);

  // Land on the first plan once the list is in.
  useEffect(() => {
    if (!groups || !groups.length) return;
    const first = groups[0].plans[0];
    if (first) window.setTimeout(() => focusById(`plan-${first.id}`), 30);
  }, [groups, focusById]);

  const choose = async (plan: BillingPlan) => {
    if (ordering !== null || blocked) return;
    setOrdering(plan.id);
    try {
      const order = await SmcBilling.order({ planId: plan.id });
      if (order.reused) {
        toast({ title: t('billing.buy.continuingTitle'), description: t('billing.buy.continuingDesc', { plan: plan.name }) });
      }
      onOrdered(order, plan);
    } catch (e) {
      const err = toBillingError(e);
      if (err.code === 'plan_unavailable') {
        handleError(e, t('billing.buy.planUnavailableTitle'));
        void load();
      } else {
        handleError(e, t('billing.buy.orderFailedTitle'));
      }
    } finally {
      setOrdering(null);
    }
  };

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className={HEADER}>
        <div className="flex items-center gap-3">
          <BackButton onClick={onBack} label={t('common.back')} data-player-header-btn="" focused={currentFocusId === 'back'} data-tv-focus-id="back" />
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold text-white">{t('billing.buy.title')}</h1>
          </div>
        </div>
        <RateLimitNote secondsLeft={secondsLeft} />
      </div>

      <div className={BODY}>
        <div className="w-full max-w-5xl space-y-8">
          {groups === null && <Spinner label={t('billing.buy.loading')} />}
          {loadError && <p className="text-red-200 font-nunito">{loadError}</p>}
          {groups && groups.length === 0 && !loadError && (
            <div className="space-y-2">
              <p className="text-brand-ice/90 font-nunito">{t('billing.buy.noPlans')}</p>
              {diagnosis && <p className="text-brand-ice/60 font-nunito text-sm">{diagnosis}</p>}
            </div>
          )}
          {groups?.map((g) => (
            <section key={g.term}>
              <h2 className="text-lg font-quicksand font-semibold text-brand-ice mb-3">{termLabel(g.term)}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {g.plans.map((p) => {
                  const id = `plan-${p.id}`;
                  const busy = ordering === p.id;
                  return (
                    <Card
                      key={p.id}
                      onClick={() => { void choose(p); }}
                      aria-disabled={ordering !== null || blocked}
                      className={`tv-ring cursor-pointer rounded-2xl p-5 bg-slate-900/70 border border-white/10 transition-transform duration-150 ease-out ${scaleIf(currentFocusId, id)} ${ordering !== null && !busy ? 'opacity-60' : ''}`}
                      {...focusAttrs(currentFocusId, id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xl font-quicksand font-bold text-white leading-tight">{p.name}</div>
                          <div className="flex items-center gap-2 text-brand-ice/80 font-nunito text-sm mt-1">
                            <Users className="w-4 h-4" />
                            {connectionsLabel(p.connections)}
                          </div>
                        </div>
                        {busy ? (
                          <Loader2 className="w-6 h-6 animate-spin text-brand-gold shrink-0" />
                        ) : (
                          <div className="text-right shrink-0">
                            <div className="text-2xl font-quicksand font-bold text-brand-gold">{formatMoney(p.price, p.currency)}</div>
                            <div className="text-xs text-brand-ice/60 font-nunito">{t('billing.buy.perTerm', { term: termLabel(g.term) })}</div>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
});

BuyPlanScreen.displayName = 'BuyPlanScreen';
export default BuyPlanScreen;
