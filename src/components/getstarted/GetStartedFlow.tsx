import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Loader2, Tv, Smartphone, ArrowLeft, Sparkles, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTVFocus } from '@/hooks/useTVFocus';
import type { XtreamCreds } from '@/lib/xtream';
import { billingConfigured } from '@/hooks/useBillingEnabled';
import { loadSignupLinks, toOffers, type SignupLink, type SignupOffers } from '@/lib/signupLinks';
import { BTN, CARD, SCREEN } from '@/components/billing/shared';
import { focusAttrs, scaleIf, useFocusRecovery } from '@/components/billing/shared';
import WaitScreen from '@/components/billing/WaitScreen';
import { readPending, clearPending, type VibezPending } from './pending';
import { trackEvent, startTimer, stopTimer } from '@/lib/analytics';
import { forgetAccountSignup } from '@/lib/billing';
import VibezPlanGrid from './VibezPlanGrid';
import VibezHandoff from './VibezHandoff';
import VibezSignInScreen from './VibezSignInScreen';

// Reused whole: TrialFlow already contains create-account -> trial -> plans ->
// pay -> wait for the line -> credentials sheet -> sign the player in, and it
// takes exactly the contract this flow needs.
const TrialFlow = lazy(() => import('@/components/billing/TrialFlow'));

interface Props {
  /** Whether the Vibez hand-off is switched on (feature flag, read by the parent). */
  vibezEnabled: boolean;
  onDone: (creds: XtreamCreds) => void;
  onCancel: () => void;
}

type Step = 'resolve' | 'choose' | 'ds-choose' | 'dreamstreams' | 'plans' | 'handoff' | 'signin' | 'unavailable';

const fallback = (
  <div className="min-h-screen flex items-center justify-center text-white bg-black/70">
    <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
  </div>
);

/**
 * "Get started" for someone with no streaming account yet.
 *
 * Two services, honestly different. DreamStreams runs entirely on the TV: the
 * trial provisions a real line in seconds and signs the player in. Vibez has no
 * API — the customer pays on the panel's Stripe page and is emailed a login —
 * so the most this can do is hand them off and take the login when they return.
 * The chooser says which is which rather than pretending they are the same.
 *
 * The first step is a resolve, not a render. useBillingEnabled reports false on
 * its very first render even on a good device, so branching on it directly
 * would skip a working DreamStreams offer. Availability is settled once into a
 * ref and the step set never reshapes underneath the viewer's thumb.
 *
 * This owns no hardware-Back listener on purpose: LiveTV and AccountChooser
 * already register one each, and Capacitor calls every listener, so a third
 * would turn one remote press into two Backs.
 */
const GetStartedFlow = memo(({ vibezEnabled, onDone, onCancel }: Props) => {
  const [step, setStep] = useState<Step>('resolve');
  const [offers, setOffers] = useState<SignupOffers | null>(null);
  // Whether BOTH services were on offer. Decides where Back goes from a
  // service screen: to the chooser only if there was ever a choice, otherwise
  // straight out — a lone-service viewer must never land on a chooser
  // offering a service this device cannot actually complete.
  const [canChoose, setCanChoose] = useState(false);
  const [picked, setPicked] = useState<SignupLink | null>(null);
  // Trial or buy, for DreamStreams. Vibez shows both on one screen; this is
  // the same choice, asked before the account form rather than after it.
  const [dsMode, setDsMode] = useState<'trial' | 'plans'>('trial');
  const [resumed, setResumed] = useState<VibezPending | null>(null);
  const resolvedRef = useRef(false);

  // Sign-up funnel. Every step that a viewer can choose is recorded, so the
  // drop-off between "get started", trial or buy, and a line that actually
  // exists is readable without guessing.
  useEffect(() => {
    try {
      trackEvent('signup_open', 'signup', {});
      startTimer('signup', 'signup_dwell', 'signup', {});
    } catch { /* ignore */ }
    return () => {
      try { stopTimer('signup'); } catch { /* ignore */ }
      // Nothing the member typed outlives the screen they typed it on.
      forgetAccountSignup();
    };
  }, []);

  const finish = useCallback((creds: XtreamCreds) => {
    try {
      trackEvent('signup_complete', 'signup', {
        service: creds.serverLabel ?? null,
        host: creds.host ?? null,
      });
    } catch { /* ignore */ }
    onDone(creds);
  }, [onDone]);

  useEffect(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    let cancelled = false;
    (async () => {
      const pending = readPending();
      const [ds, links] = await Promise.all([
        billingConfigured().catch(() => false),
        vibezEnabled ? loadSignupLinks().catch(() => []) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      const vz = toOffers(links);
      const haveVibez = vibezEnabled && (!!vz.trial || vz.plans.length > 0);
      setOffers(vz);
      setCanChoose(ds && haveVibez);

      // Someone who was already sent off to pay comes straight back to the
      // step that finishes the job.
      try {
        trackEvent('signup_offers', 'signup', {
          dreamstreams: ds, vibez: haveVibez, resumed: !!pending,
        });
      } catch { /* ignore */ }
      if (pending && haveVibez) { setResumed(pending); setStep('signin'); return; }
      if (ds && haveVibez) { setStep('choose'); return; }
      if (ds) { setStep('ds-choose'); return; }
      if (haveVibez) { setStep('plans'); return; }
      setStep('unavailable');
    })();
    return () => { cancelled = true; };
  }, [vibezEnabled]);

  const pickVibez = useCallback((link: SignupLink) => {
    try { trackEvent('signup_vibez_plan', 'signup', { plan: link.label ?? null }); } catch { /* ignore */ }
    setPicked(link); setStep('handoff');
  }, []);

  if (step === 'resolve') return <WaitScreen title="One moment…" onBack={onCancel} />;

  if (step === 'unavailable') {
    return (
      <WaitScreen
        error
        title="Sign-up is not available here"
        detail="New accounts cannot be created on this device right now. If you already have a username and password, press Back and sign in."
        onBack={onCancel}
        backLabel="Back to sign in"
      />
    );
  }

  if (step === 'ds-choose') {
    return (
      <DsChooser
        onTrial={() => {
          try { trackEvent('signup_trial_click', 'signup', { service: 'DreamStreams' }); } catch { /* ignore */ }
          setDsMode('trial'); setStep('dreamstreams');
        }}
        onBuy={() => {
          try { trackEvent('signup_paid_click', 'signup', { service: 'DreamStreams' }); } catch { /* ignore */ }
          setDsMode('plans'); setStep('dreamstreams');
        }}
        onBack={() => (canChoose ? setStep('choose') : onCancel())}
      />
    );
  }

  if (step === 'dreamstreams') {
    return (
      <Suspense fallback={fallback}>
        <TrialFlow startAt={dsMode} onDone={finish} onCancel={() => setStep('ds-choose')} />
      </Suspense>
    );
  }

  if (step === 'plans' && offers) {
    return (
      <VibezPlanGrid
        offers={offers}
        onPick={pickVibez}
        onBack={() => (canChoose ? setStep('choose') : onCancel())}
      />
    );
  }

  if (step === 'handoff' && picked) {
    return <VibezHandoff link={picked} onHaveLogin={() => setStep('signin')} onBack={() => setStep('plans')} />;
  }

  if (step === 'signin') {
    return (
      <VibezSignInScreen
        onDone={finish}
        onBack={() => {
          if (resumed) { setResumed(null); }
          if (picked) { setStep('handoff'); return; }
          setStep(offers && (offers.trial || offers.plans.length) ? 'plans' : 'choose');
        }}
        resumedLabel={resumed?.label ?? null}
      />
    );
  }

  return (
    <Chooser
      onDreamstreams={() => {
        try { trackEvent('signup_service', 'signup', { service: 'DreamStreams' }); } catch { /* ignore */ }
        setStep('ds-choose');
      }}
      onVibez={() => {
        try { trackEvent('signup_service', 'signup', { service: 'VibezTV' }); } catch { /* ignore */ }
        setStep('plans');
      }}
      onBack={onCancel}
    />
  );
});

GetStartedFlow.displayName = 'GetStartedFlow';
export default GetStartedFlow;

// ── trial or buy, for DreamStreams ──────────────────────────────────────────

const DsChooser = memo(({ onTrial, onBuy, onBack }: {
  onTrial: () => void; onBuy: () => void; onBack: () => void;
}) => {
  const { containerRef, currentFocusId, focusById } = useTVFocus({
    initialFocusId: 'ds-trial',
    onBack,
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'ds-trial');

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-quicksand font-bold text-white">DreamStreams</h1>
            <p className="text-brand-ice/80 font-nunito">Try it free first, or start a plan now.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card
              onClick={onTrial}
              className={`${CARD} tv-ring cursor-pointer p-6 min-h-[11rem] transition-transform duration-150 ease-out ${scaleIf(currentFocusId, 'ds-trial')}`}
              {...focusAttrs(currentFocusId, 'ds-trial')}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-xl bg-brand-gold/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-7 h-7 text-brand-gold" />
                </div>
                <div>
                  <h2 className="text-xl font-quicksand font-bold text-white leading-tight">Trial</h2>
                  <p className="text-brand-gold font-nunito text-sm">24 hours · no card needed</p>
                </div>
              </div>
              <p className="text-brand-ice/80 font-nunito text-sm leading-snug">
                We create your login and sign the Player in straight away.
              </p>
            </Card>

            <Card
              onClick={onBuy}
              className={`${CARD} tv-ring cursor-pointer p-6 min-h-[11rem] transition-transform duration-150 ease-out ${scaleIf(currentFocusId, 'ds-buy')}`}
              {...focusAttrs(currentFocusId, 'ds-buy')}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-xl bg-sky-500/20 flex items-center justify-center shrink-0">
                  <ShoppingCart className="w-7 h-7 text-sky-300" />
                </div>
                <div>
                  <h2 className="text-xl font-quicksand font-bold text-white leading-tight">Buy a plan</h2>
                  <p className="text-sky-300 font-nunito text-sm">Pick a length and pay now</p>
                </div>
              </div>
              <p className="text-brand-ice/80 font-nunito text-sm leading-snug">
                Pay on this TV or with your phone, then the Player signs in by itself.
              </p>
            </Card>
          </div>

          <div className="flex justify-center mt-6">
            <Button variant="white" onClick={onBack}
              className={`${BTN} ${scaleIf(currentFocusId, 'ds-back')}`} {...focusAttrs(currentFocusId, 'ds-back')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});
DsChooser.displayName = 'DreamstreamsChooser';

// ── the chooser ──────────────────────────────────────────────────────────────

const Chooser = memo(({ onDreamstreams, onVibez, onBack }: {
  onDreamstreams: () => void; onVibez: () => void; onBack: () => void;
}) => {
  const { containerRef, currentFocusId, focusById } = useTVFocus({
    initialFocusId: 'gs-ds',
    onBack,
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'gs-ds');

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-5xl">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-quicksand font-bold text-white">Get started</h1>
            <p className="text-brand-ice/80 font-nunito">Pick a service and we will set you up.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card
              onClick={onDreamstreams}
              className={`${CARD} tv-ring cursor-pointer p-6 min-h-[13rem] transition-transform duration-150 ease-out ${scaleIf(currentFocusId, 'gs-ds')}`}
              {...focusAttrs(currentFocusId, 'gs-ds')}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-xl bg-brand-gold/20 flex items-center justify-center shrink-0">
                  <Tv className="w-7 h-7 text-brand-gold" />
                </div>
                <div>
                  <h2 className="text-xl font-quicksand font-bold text-white leading-tight">DreamStreams</h2>
                  <p className="text-brand-gold font-nunito text-sm">Set up on this TV · about a minute</p>
                </div>
              </div>
              <p className="text-brand-ice/80 font-nunito text-sm leading-snug">
                Start a free 24-hour trial or buy a plan right here. Your login is created for you
                and the Player signs in on its own.
              </p>
            </Card>

            <Card
              onClick={onVibez}
              className={`${CARD} tv-ring cursor-pointer p-6 min-h-[13rem] transition-transform duration-150 ease-out ${scaleIf(currentFocusId, 'gs-vibez')}`}
              {...focusAttrs(currentFocusId, 'gs-vibez')}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-xl bg-sky-500/20 flex items-center justify-center shrink-0">
                  <Smartphone className="w-7 h-7 text-sky-300" />
                </div>
                <div>
                  <h2 className="text-xl font-quicksand font-bold text-white leading-tight">Vibez</h2>
                  <p className="text-sky-300 font-nunito text-sm">Finish on your phone · about 5 minutes</p>
                </div>
              </div>
              <p className="text-brand-ice/80 font-nunito text-sm leading-snug">
                Vibez sign-up happens on their website. Scan a code with your phone, pay there, and
                they email you a login — then type it in here.
              </p>
            </Card>
          </div>

          <div className="flex justify-center mt-6">
            <Button variant="white" onClick={onBack}
              className={`${BTN} ${scaleIf(currentFocusId, 'gs-back')}`} {...focusAttrs(currentFocusId, 'gs-back')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> I already have a login
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});
Chooser.displayName = 'GetStartedChooser';
