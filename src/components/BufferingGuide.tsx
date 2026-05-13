import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Mail,
  Copy,
  RotateCw,
  Wifi,
  Gauge,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  Settings as SettingsIcon,
  Download as DownloadIcon,
  Play,
  ExternalLink,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useToast } from '@/hooks/use-toast';
import SpeedTest from '@/components/SpeedTest';
import { AppManager, isWebUnsupportedError } from '@/capacitor/AppManager';
import type { AppData } from '@/hooks/useAppData';
import { useAuth } from '@/hooks/useAuth';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { MessageSquare } from 'lucide-react';

interface BufferingGuideProps {
  onClose: () => void;
  apps: AppData[];
  appStatuses: Map<string, { installed: boolean }>;
  onLaunch: (app: AppData) => void | Promise<void>;
  onDownload: (app: AppData) => void;
  onOpenAppSettings?: (app: AppData) => void | Promise<void>;
}

type AppType = 'dreamstreams' | 'vibeztv' | 'plex' | 'other' | null;
type Step1Choice = 'one_only' | 'all_buffer' | null;
type YesNo = boolean | null;
type VpnTest = 'fixed' | 'still_buffering' | null;
type VpnChoice = 'ipvanish' | 'surfshark' | null;

interface State {
  appType: AppType;
  step1Choice: Step1Choice;
  didRestartAndCache: YesNo;
  speedMbps: number | null;
  speedMethod: 'speedtest_app' | 'in_app' | 'unknown' | null;
  vpnChoice: VpnChoice;
  vpnSpeedOk: YesNo;
  vpnTest: VpnTest;
}

const SUPPORT_EMAIL = 'support@snowmediaent.com';

const STEPS = ['intro', 'step1', 'step2', 'step3', 'step4', 'summary'] as const;
type StepKey = typeof STEPS[number];

const HINTS: Record<StepKey, string> = {
  intro: 'Choose your app type to start.',
  step1: 'If only one channel/title, report it so we can fix it fast.',
  step2: 'Open the app settings, Force Stop + Clear Cache, then press Back.',
  step3: 'Run a speed test on this device (15+ Mbps).',
  step4: 'Pick a VPN, install/sign in, then re-run speed.',
  summary: 'You\'re done — copy or email results if needed.',
};

const APP_LABELS: Record<Exclude<AppType, null>, string> = {
  dreamstreams: 'Dreamstreams',
  vibeztv: 'VibezTV',
  plex: 'Plex',
  other: 'your app',
};

// Known package names for the streaming apps in step1
const STREAMING_PKG: Record<Exclude<AppType, null>, string | null> = {
  dreamstreams: 'com.dreamstreams.app',
  vibeztv: 'com.vibeztv.app',
  plex: 'com.plexapp.android',
  other: null,
};

const VPN_INFO = {
  ipvanish: {
    label: 'IPVanish',
    pkg: 'com.ixonn.ipvanish',
    downloaderCode: '805133',
    signupUrl: 'https://ssqt.co/mzS1auK',
    matchKeys: ['ipvanish'],
  },
  surfshark: {
    label: 'Surfshark',
    pkg: 'com.surfshark.vpnclient.android',
    downloaderCode: '3829522',
    signupUrl: 'https://surfshark.com',
    matchKeys: ['surfshark'],
  },
} as const;

const BufferingGuide = ({
  onClose,
  apps,
  appStatuses,
  onLaunch,
  onDownload,
  onOpenAppSettings,
}: BufferingGuideProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { createTicket } = useSupportTickets(user);
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<State>({
    appType: null,
    step1Choice: null,
    didRestartAndCache: null,
    speedMbps: null,
    speedMethod: null,
    vpnChoice: null,
    vpnSpeedOk: null,
    vpnTest: null,
  });
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  const [speedInput, setSpeedInput] = useState<string>('');
  const contentRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const step: StepKey = STEPS[stepIndex];

  // Collect focusable buttons/links/inputs inside the modal
  const getFocusables = (): HTMLElement[] => {
    if (!rootRef.current) return [];
    const nodes = rootRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.from(nodes).filter((el) => {
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.getAttribute('data-no-dpad') === 'true') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  };

  // D-pad / Arrow key navigation between focusables
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showSpeedTest) return;
      const key = e.key;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
      const focusables = getFocusables();
      if (focusables.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const target = e.target as HTMLElement | null;
      // Allow text inputs/textareas to handle arrows themselves
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (key === 'ArrowDown') {
          (target as HTMLInputElement).blur();
        } else {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();

      // Spatial 2D navigation based on bounding rects
      const docActive = document.activeElement as HTMLElement | null;
      let activeEl: HTMLElement | null =
        docActive && focusables.includes(docActive) ? docActive : null;
      // If focus was lost (e.g. body), resume from the last focused element
      if (!activeEl && lastFocusedRef.current && focusables.includes(lastFocusedRef.current)) {
        activeEl = lastFocusedRef.current;
      }
      if (!activeEl) {
        focusables[0]?.focus();
        focusables[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }

      const focusNextButton = () => {
        const nextButton = rootRef.current?.querySelector<HTMLElement>('[data-guide-nav="next"]:not([disabled])');
        if (!nextButton) return false;
        nextButton.focus();
        lastFocusedRef.current = nextButton;
        nextButton.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
      };

      if (
        key === 'ArrowDown' &&
        activeEl.getAttribute('data-guide-choice') === 'true' &&
        activeEl.getAttribute('data-guide-choice-active') === 'true' &&
        focusNextButton()
      ) {
        return;
      }

      const cur = activeEl.getBoundingClientRect();
      const curCx = cur.left + cur.width / 2;
      const curCy = cur.top + cur.height / 2;

      const candidates = focusables
        .filter((el) => el !== activeEl)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        });

      const inDirection = candidates.filter(({ r, cx, cy }) => {
        const dx = cx - curCx;
        const dy = cy - curCy;
        if (key === 'ArrowDown') return r.top > cur.top + 4;
        if (key === 'ArrowUp') return r.bottom < cur.bottom - 4;
        if (key === 'ArrowRight') return r.left > cur.left + 4 && Math.abs(dy) < Math.max(cur.height, r.height);
        if (key === 'ArrowLeft') return r.right < cur.right - 4 && Math.abs(dy) < Math.max(cur.height, r.height);
        return false;
      });

      const scored = inDirection
        .map(({ el, cx, cy }) => {
          const dx = cx - curCx;
          const dy = cy - curCy;
          // Penalize off-axis distance more heavily for vertical/horizontal moves
          let score: number;
          if (key === 'ArrowDown' || key === 'ArrowUp') {
            score = Math.abs(dy) + Math.abs(dx) * 2;
          } else {
            score = Math.abs(dx) + Math.abs(dy) * 2;
          }
          return { el, score };
        })
        .sort((a, b) => a.score - b.score);

      const next = scored[0]?.el;
      if (next) {
        next.focus();
        lastFocusedRef.current = next;
        next.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showSpeedTest, stepIndex]);

  // Auto-focus the first focusable element when step changes
  useEffect(() => {
    if (showSpeedTest) return;
    const t = setTimeout(() => {
      const focusables = getFocusables();
      // Prefer first focusable inside the content area (skip header Close button)
      const contentFocusables = focusables.filter((el) => contentRef.current?.contains(el));
      const target = contentFocusables[0] || focusables[0];
      if (target) {
        target.focus();
        lastFocusedRef.current = target;
      }
    }, 80);
    return () => clearTimeout(t);
  }, [stepIndex, showSpeedTest]);

  // Track last-focused element inside the modal so D-pad can resume after focus loss
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && root.contains(t)) lastFocusedRef.current = t;
    };
    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, []);

  // Helpers to find the AppData entry for the chosen streaming app or VPN
  const findApp = (matchKeys: string[], pkg?: string | null): AppData | undefined =>
    apps.find((a) => {
      const name = (a.name || '').toLowerCase();
      const id = (a.id || '').toLowerCase();
      const apkPkg = (a.packageName || '').toLowerCase();
      if (pkg && apkPkg === pkg.toLowerCase()) return true;
      return matchKeys.some((k) => name.includes(k) || id.includes(k));
    });

  const chosenApp: AppData | undefined = useMemo(() => {
    if (!state.appType || state.appType === 'other') return undefined;
    return findApp([state.appType], STREAMING_PKG[state.appType]);
  }, [state.appType, apps]);

  const chosenAppInstalled = chosenApp ? !!appStatuses.get(chosenApp.id)?.installed : false;

  const vpnApp: AppData | undefined = useMemo(() => {
    if (!state.vpnChoice) return undefined;
    const info = VPN_INFO[state.vpnChoice];
    return findApp([...info.matchKeys], info.pkg);
  }, [state.vpnChoice, apps]);

  const vpnInstalled = vpnApp ? !!appStatuses.get(vpnApp.id)?.installed : false;

  const canNext = (() => {
    switch (step) {
      case 'intro': return !!state.appType;
      case 'step1': return state.step1Choice === 'all_buffer';
      case 'step2': return state.didRestartAndCache === false; // true short-circuits to summary
      case 'step3': return typeof state.speedMbps === 'number' && state.speedMbps >= 15;
      case 'step4': return !!state.vpnChoice && state.vpnSpeedOk !== null && state.vpnTest === 'still_buffering';
      default: return false;
    }
  })();

  // Handle ESC / Back to close, and OK/Enter/DPAD_CENTER to activate focused button
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // OK / Enter / DPAD_CENTER / Space → click the focused element
      const isSelectKey =
        e.key === 'Enter' ||
        e.key === ' ' ||
        e.key === 'Spacebar' ||
        e.keyCode === 13 ||
        e.keyCode === 23 || // KEYCODE_DPAD_CENTER
        e.keyCode === 32 || // Space
        e.keyCode === 66;   // KEYCODE_ENTER (Android)
      if (isSelectKey && !showSpeedTest) {
        const target = e.target as HTMLElement | null;
        // Don't hijack typing in inputs/textareas
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        const active = document.activeElement as HTMLElement | null;
        if (
          active &&
          rootRef.current?.contains(active) &&
          (active.tagName === 'BUTTON' || active.tagName === 'A' || active.getAttribute('role') === 'button')
        ) {
          e.preventDefault();
          e.stopPropagation();
          active.click();
          return;
        }
      }
      if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (showSpeedTest) return; // SpeedTest handles its own
        if (stepIndex > 0) setStepIndex((i) => i - 1);
        else onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [stepIndex, onClose, showSpeedTest]);

  // Scroll content to top on step change
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stepIndex]);

  const goNext = () => {
    if (canNext && stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
  };
  const goBack = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  const jumpToSummary = () => setStepIndex(STEPS.length - 1);

  const restart = () => {
    setState({
      appType: null,
      step1Choice: null,
      didRestartAndCache: null,
      speedMbps: null,
      speedMethod: null,
      vpnChoice: null,
      vpnSpeedOk: null,
      vpnTest: null,
    });
    setSpeedInput('');
    setStepIndex(0);
  };

  const openAppSettings = async (packageName: string) => {
    try {
      await AppManager.openAppSettings({ packageName });
      toast({
        title: 'Opened app settings',
        description: 'Tap Force Stop, then Storage → Clear Cache. Press Back when done.',
      });
    } catch (err) {
      if (isWebUnsupportedError(err)) {
        toast({
          title: 'Open in the installed app',
          description: 'This action only works inside the installed Snow Media Center app.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Could not open settings', description: String(err), variant: 'destructive' });
      }
    }
  };

  const launchPackage = async (packageName: string) => {
    try {
      await AppManager.launch({ packageName });
    } catch (err) {
      if (isWebUnsupportedError(err)) {
        toast({
          title: 'Open in the installed app',
          description: 'This action only works inside the installed Snow Media Center app.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Could not launch app', description: String(err), variant: 'destructive' });
      }
    }
  };

  const diagnosis = useMemo(() => getDiagnosis(state), [state]);
  const supportScript = useMemo(() => buildSupportScript(state, diagnosis), [state, diagnosis]);

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(supportScript);
      toast({ title: 'Copied!', description: 'Results copied to clipboard.' });
    } catch {
      toast({ title: 'Copy failed', description: 'Select the text manually.', variant: 'destructive' });
    }
  };

  const submitAsTicket = async () => {
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in via Chat & Community to submit a ticket.',
        variant: 'destructive',
      });
      return;
    }
    try {
      setSubmittingTicket(true);
      await createTicket('Buffering Walkthrough Results', supportScript);
      toast({
        title: 'Ticket submitted',
        description: 'Find it in Chat & Community → My Tickets.',
      });
      onClose();
    } catch (err) {
      // toast already handled inside hook
    } finally {
      setSubmittingTicket(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col [&_button:focus]:outline-none [&_button:focus-visible]:outline-none [&_button:focus]:ring-0 [&_button:focus]:scale-[1.04] [&_button:focus]:shadow-[0_0_28px_6px_hsl(45_93%_58%/0.55)] [&_button:focus]:border-yellow-300 [&_button:focus]:z-10 [&_button]:transition-all [&_button]:duration-150 [&_a:focus]:outline-none [&_a:focus]:ring-2 [&_a:focus]:ring-yellow-300 [&_a:focus]:rounded">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/10 bg-gradient-to-b from-blue-950/60 to-transparent">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <Button
            onClick={onClose}
            variant="outline"
            size="sm"
            tabIndex={-1}
            data-no-dpad="true"
            className="bg-white/5 border-white/20 text-white hover:bg-white/10"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Close
          </Button>
          <div className="text-center flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-white truncate">Buffering Walkthrough</h1>
            <p className="text-xs text-white/60">Step {Math.min(stepIndex + 1, STEPS.length)} of {STEPS.length}</p>
          </div>
          <Badge variant="outline" className="bg-cyan-600/20 border-cyan-500/40 text-cyan-100 hidden sm:inline-flex">
            <HelpCircle className="w-3 h-3 mr-1" />
            Snow Media
          </Badge>
        </div>
        {/* Progress */}
        <div className="max-w-3xl mx-auto mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
            style={{ width: `${(stepIndex / (STEPS.length - 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <p className="text-xs uppercase tracking-wider text-cyan-300/80">{HINTS[step]}</p>

          {step === 'intro' && (
            <IntroStep
              value={state.appType}
              onSelect={(t) => setState((s) => ({ ...s, appType: t }))}
            />
          )}

          {step === 'step1' && (
            <Step1
              value={state.step1Choice}
              onSelect={(choice) => {
                setState((s) => ({ ...s, step1Choice: choice }));
                if (choice === 'one_only') {
                  toast({
                    title: 'Report the channel/title',
                    description: 'Email the exact channel/title name to support — we\'ll fix it fast.',
                  });
                  jumpToSummary();
                }
              }}
            />
          )}

          {step === 'step2' && (
            <Step2
              value={state.didRestartAndCache}
              appLabel={state.appType ? APP_LABELS[state.appType] : 'your app'}
              chosenApp={chosenApp}
              chosenAppInstalled={chosenAppInstalled}
              onOpenSettings={() => {
                // Prefer the exact same handler Main Apps uses
                if (chosenApp && onOpenAppSettings) {
                  onOpenAppSettings(chosenApp);
                  return;
                }
                const pkg = chosenApp?.packageName || (state.appType ? STREAMING_PKG[state.appType] : null);
                if (!pkg) {
                  toast({
                    title: 'Open Android Settings → Apps',
                    description: 'Find the app, then tap Force Stop and Clear Cache.',
                  });
                  return;
                }
                openAppSettings(pkg);
              }}
              onSelect={(v) => {
                setState((s) => ({ ...s, didRestartAndCache: v }));
                if (v === true) {
                  toast({ title: 'Great!', description: 'Glad we got it sorted.' });
                  jumpToSummary();
                }
              }}
            />
          )}

          {step === 'step3' && (
            <Step3
              speedMbps={state.speedMbps}
              speedInput={speedInput}
              setSpeedInput={setSpeedInput}
              onRunInApp={() => setShowSpeedTest(true)}
              onSaveTyped={() => {
                const raw = speedInput.trim().replace(',', '.');
                const n = Number(raw);
                if (!raw || Number.isNaN(n) || n < 0) {
                  toast({ title: 'Invalid speed', description: 'Enter a number like 25.', variant: 'destructive' });
                  return;
                }
                setState((s) => ({ ...s, speedMbps: n, speedMethod: 'speedtest_app' }));
                if (n < 15) {
                  toast({
                    title: 'Speed is too low',
                    description: 'Below 15 Mbps will cause buffering. Try 5GHz Wi-Fi, move closer, or use Ethernet.',
                    variant: 'destructive',
                  });
                }
              }}
            />
          )}

          {step === 'step4' && (
            <Step4
              vpnChoice={state.vpnChoice}
              vpnSpeedOk={state.vpnSpeedOk}
              vpnTest={state.vpnTest}
              vpnApp={vpnApp}
              vpnInstalled={vpnInstalled}
              onChooseVpn={(c) => setState((s) => ({ ...s, vpnChoice: c, vpnSpeedOk: null, vpnTest: null }))}
              onDownloadVpn={() => {
                if (vpnApp) onDownload(vpnApp);
                else toast({ title: 'VPN not in store', description: 'Use the Downloader code instead.', variant: 'destructive' });
              }}
              onLaunchVpn={() => {
                const pkg = vpnApp?.packageName || (state.vpnChoice ? VPN_INFO[state.vpnChoice].pkg : null);
                if (pkg) launchPackage(pkg);
              }}
              onRunSpeedTest={() => setShowSpeedTest(true)}
              onVpnSpeedOk={(ok) => {
                setState((s) => ({ ...s, vpnSpeedOk: ok }));
                if (!ok) {
                  toast({
                    title: 'Switch VPN server',
                    description: 'Pick the closest city/server, then re-test for 15+ Mbps.',
                  });
                }
              }}
              onVpnTest={(v) => {
                if (state.vpnSpeedOk === false) {
                  toast({ title: 'Get speed to 15+ first', description: 'Switch VPN city/server, then re-test speed.' });
                  return;
                }
                setState((s) => ({ ...s, vpnTest: v }));
                if (v === 'fixed') {
                  toast({ title: 'Awesome!', description: 'Likely ISP throttling — keep VPN on while streaming.' });
                  jumpToSummary();
                }
              }}
              onTestStreamingApp={() => {
                if (chosenApp) onLaunch(chosenApp);
                else toast({ title: 'Open the streaming app manually.' });
              }}
              chosenAppLabel={state.appType ? APP_LABELS[state.appType] : null}
              chosenAppAvailable={!!chosenApp && chosenAppInstalled}
            />
          )}

          {step === 'summary' && (
            <Summary
              diagnosis={diagnosis}
              supportScript={supportScript}
              chosenApp={chosenApp}
              chosenAppLabel={state.appType ? APP_LABELS[state.appType] : null}
              chosenAppInstalled={chosenAppInstalled}
              onLaunchApp={() => chosenApp && onLaunch(chosenApp)}
              onCopy={copyScript}
              onSubmitTicket={submitAsTicket}
              submittingTicket={submittingTicket}
              onRestart={restart}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-white/10 bg-black/60">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <Button
            onClick={goBack}
            disabled={stepIndex === 0}
            variant="outline"
            tabIndex={-1}
            data-no-dpad="true"
            className="bg-white/5 border-white/20 text-white hover:bg-white/10 disabled:opacity-40"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <span className="text-xs text-white/70 truncate hidden sm:block select-none pointer-events-none">
            Submit a Ticket in Chat &amp; Community
          </span>
          <Button
            onClick={goNext}
            disabled={!canNext || stepIndex === STEPS.length - 1}
            data-guide-nav="next"
            className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white disabled:opacity-40"
          >
            Next <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>

      {showSpeedTest && (
        <SpeedTest
          onClose={() => {
            setShowSpeedTest(false);
            toast({
              title: 'Enter your download speed',
              description: 'Type the Mbps you saw above, then continue.',
            });
          }}
        />
      )}
    </div>
  );
};

/* ---------------- Sub-components ---------------- */

const ChoiceButton = ({
  active,
  onClick,
  children,
  className = '',
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) => (
  <Button
    onClick={(e) => {
      onClick();
      // Ensure the clicked button keeps focus so D-pad nav has an anchor
      (e.currentTarget as HTMLElement).focus();
    }}
    onMouseDown={(e) => {
      // Prevent some browsers from blurring the button on mouse interaction
      (e.currentTarget as HTMLElement).focus();
    }}
    data-guide-choice="true"
    data-guide-choice-active={active ? 'true' : 'false'}
    variant="outline"
    className={`w-full justify-start text-left h-auto py-3 px-4 font-medium transition-all duration-200 ${
      active
        ? 'bg-cyan-600/40 border-cyan-300 text-white shadow-[0_0_20px_hsl(var(--primary)/0.3)]'
        : 'bg-white/10 border-white/30 text-white hover:bg-white/15'
    } ${className}`}
  >
    {children}
  </Button>
);

const IntroStep = ({ value, onSelect }: { value: AppType; onSelect: (t: AppType) => void }) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-white">Which app is buffering?</h2>
      <p className="text-sm text-white/70 mt-1">
        This walkthrough is for alternative streaming apps. Mainstream apps (Netflix/Disney+/Hulu) buffering may be a different issue.
      </p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {([
        ['dreamstreams', 'Dreamstreams'],
        ['vibeztv', 'VibezTV'],
        ['plex', 'Plex'],
        ['other', 'Other / Not sure'],
      ] as [AppType, string][]).map(([k, label]) => (
        <ChoiceButton key={k} active={value === k} onClick={() => onSelect(k)}>
          {label}
        </ChoiceButton>
      ))}
    </div>
  </Card>
);

const Step1 = ({ value, onSelect }: { value: Step1Choice; onSelect: (c: Step1Choice) => void }) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-white">Is it only one channel/title, or everything?</h2>
      <p className="text-sm text-white/70 mt-1">
        If only one channel or title is failing, it's usually a source problem we can fix on our end.
      </p>
    </div>
    <div className="space-y-2">
      <ChoiceButton active={value === 'one_only'} onClick={() => onSelect('one_only')}>
        <AlertTriangle className="w-4 h-4 mr-2 text-amber-300" />
        Only one channel/title
      </ChoiceButton>
      <ChoiceButton active={value === 'all_buffer'} onClick={() => onSelect('all_buffer')}>
        <Wifi className="w-4 h-4 mr-2 text-cyan-300" />
        Everything is buffering
      </ChoiceButton>
    </div>
  </Card>
);

const Step2 = ({
  value,
  appLabel,
  chosenApp,
  chosenAppInstalled,
  onOpenSettings,
  onSelect,
}: {
  value: YesNo;
  appLabel: string;
  chosenApp: AppData | undefined;
  chosenAppInstalled: boolean;
  onOpenSettings: () => void;
  onSelect: (v: boolean) => void;
}) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-white">Force Stop + Clear Cache for {appLabel}</h2>
      <p className="text-sm text-white/70 mt-1">
        We'll open Android's settings page for {appLabel}. Tap <strong>Force Stop</strong>,
        then <strong>Storage → Clear Cache</strong> (don't tap Clear Data).
        When you're done, press the <strong>Back</strong> button to return here.
      </p>
    </div>

    <Button
      onClick={onOpenSettings}
      className="w-full bg-gradient-to-r from-purple-500 to-blue-600 text-white"
    >
      <SettingsIcon className="w-4 h-4 mr-2" />
      Open {appLabel} Settings
    </Button>

    {chosenApp && !chosenAppInstalled && (
      <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-md p-2">
        {appLabel} doesn't appear to be installed on this device. Install it from Main Apps first.
      </p>
    )}

    <div className="pt-2">
      <p className="text-sm text-white mb-2">Did that fix the buffering?</p>
      <div className="space-y-2">
        <ChoiceButton active={value === true} onClick={() => onSelect(true)}>
          <CheckCircle2 className="w-4 h-4 mr-2 text-green-400" />
          Yes — that fixed it
        </ChoiceButton>
        <ChoiceButton active={value === false} onClick={() => onSelect(false)}>
          Still buffering
        </ChoiceButton>
      </div>
    </div>
  </Card>
);

const Step3 = ({
  speedMbps,
  speedInput,
  setSpeedInput,
  onRunInApp,
  onSaveTyped,
}: {
  speedMbps: number | null;
  speedInput: string;
  setSpeedInput: (v: string) => void;
  onRunInApp: () => void;
  onSaveTyped: () => void;
}) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-white">Test your internet speed</h2>
      <p className="text-sm text-white/70 mt-1">
        We need 15+ Mbps download on this device for smooth streaming. Run the in-app Speedtest, or enter a result from another tool.
      </p>
    </div>

    <Button
      onClick={onRunInApp}
      className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
    >
      <Gauge className="w-4 h-4 mr-2" /> Run In-App Speedtest
    </Button>

    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        value={speedInput}
        onChange={(e) => setSpeedInput(e.target.value)}
        placeholder="Download speed (Mbps)"
        className="flex-1 px-3 py-2 rounded-md bg-black/40 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-400"
      />
      <Button onClick={onSaveTyped} variant="outline" className="bg-white/10 border-white/30 text-white hover:bg-white/15">
        Save
      </Button>
    </div>

    {typeof speedMbps === 'number' && (
      <div
        className={`p-3 rounded-md border text-sm ${
          speedMbps >= 15
            ? 'bg-green-500/10 border-green-500/40 text-green-200'
            : 'bg-red-500/10 border-red-500/40 text-red-200'
        }`}
      >
        Recorded: <strong>{speedMbps} Mbps</strong>{' '}
        {speedMbps >= 15 ? '— good for streaming. Tap Next.' : '— too low. Improve Wi-Fi/Ethernet and re-test.'}
      </div>
    )}
  </Card>
);

const Step4 = ({
  vpnChoice,
  vpnSpeedOk,
  vpnTest,
  vpnApp,
  vpnInstalled,
  onChooseVpn,
  onDownloadVpn,
  onLaunchVpn,
  onRunSpeedTest,
  onVpnSpeedOk,
  onVpnTest,
  onTestStreamingApp,
  chosenAppLabel,
  chosenAppAvailable,
}: {
  vpnChoice: VpnChoice;
  vpnSpeedOk: YesNo;
  vpnTest: VpnTest;
  vpnApp: AppData | undefined;
  vpnInstalled: boolean;
  onChooseVpn: (c: VpnChoice) => void;
  onDownloadVpn: () => void;
  onLaunchVpn: () => void;
  onRunSpeedTest: () => void;
  onVpnSpeedOk: (ok: boolean) => void;
  onVpnTest: (v: VpnTest) => void;
  onTestStreamingApp: () => void;
  chosenAppLabel: string | null;
  chosenAppAvailable: boolean;
}) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-5">
    <div>
      <h2 className="text-xl font-semibold text-white flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-cyan-300" /> VPN test (ISP throttling check)
      </h2>
      <p className="text-sm text-white/70 mt-1">
        A premium VPN bypasses ISP throttling. Pick one below — we'll install it, help you sign in, and re-test.
      </p>
    </div>

    {/* VPN choice */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <ChoiceButton active={vpnChoice === 'ipvanish'} onClick={() => onChooseVpn('ipvanish')}>
        <ShieldCheck className="w-4 h-4 mr-2 text-cyan-300" /> IPVanish
      </ChoiceButton>
      <ChoiceButton active={vpnChoice === 'surfshark'} onClick={() => onChooseVpn('surfshark')}>
        <ShieldCheck className="w-4 h-4 mr-2 text-cyan-300" /> Surfshark
      </ChoiceButton>
    </div>

    {vpnChoice && (
      <VpnSection
        choice={vpnChoice}
        vpnApp={vpnApp}
        vpnInstalled={vpnInstalled}
        onDownloadVpn={onDownloadVpn}
        onLaunchVpn={onLaunchVpn}
      />
    )}

    {vpnChoice && vpnInstalled && (
      <>
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm text-white mb-2">After connecting the VPN, re-test your speed:</p>
          <Button
            onClick={onRunSpeedTest}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
          >
            <Gauge className="w-4 h-4 mr-2" /> Run Speedtest with VPN On
          </Button>
        </div>

        <div>
          <p className="text-sm text-white mb-2">Is your speed still 15+ Mbps?</p>
          <div className="space-y-2">
            <ChoiceButton active={vpnSpeedOk === true} onClick={() => onVpnSpeedOk(true)}>
              Yes — 15+ Mbps with VPN
            </ChoiceButton>
            <ChoiceButton active={vpnSpeedOk === false} onClick={() => onVpnSpeedOk(false)}>
              No — speed dropped below 15 (switch to a closer VPN city/server)
            </ChoiceButton>
          </div>
        </div>

        <div>
          <p className="text-sm text-white mb-2">
            Now test your stream{chosenAppLabel ? ` in ${chosenAppLabel}` : ''}:
          </p>
          {chosenAppAvailable && (
            <Button
              onClick={onTestStreamingApp}
              variant="outline"
              className="w-full mb-2 bg-white/5 border-white/20 text-white hover:bg-white/10"
            >
              <Play className="w-4 h-4 mr-2" /> Launch {chosenAppLabel}
            </Button>
          )}
          <div className="space-y-2">
            <ChoiceButton active={vpnTest === 'fixed'} onClick={() => onVpnTest('fixed')}>
              <CheckCircle2 className="w-4 h-4 mr-2 text-green-400" /> VPN fixed it
            </ChoiceButton>
            <ChoiceButton active={vpnTest === 'still_buffering'} onClick={() => onVpnTest('still_buffering')}>
              Still buffering
            </ChoiceButton>
          </div>
        </div>
      </>
    )}
  </Card>
);

const VpnSection = ({
  choice,
  vpnApp,
  vpnInstalled,
  onDownloadVpn,
  onLaunchVpn,
}: {
  choice: 'ipvanish' | 'surfshark';
  vpnApp: AppData | undefined;
  vpnInstalled: boolean;
  onDownloadVpn: () => void;
  onLaunchVpn: () => void;
}) => {
  const info = VPN_INFO[choice];
  return (
    <div className="bg-black/30 border border-white/10 rounded-md p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-white">{info.label}</p>
          <p className="text-xs text-white/60 mt-0.5">
            {vpnInstalled ? 'Installed on this device' : 'Not installed yet'}
          </p>
        </div>
        {vpnInstalled ? (
          <Button onClick={onLaunchVpn} className="bg-green-600/80 hover:bg-green-600 text-white">
            <Play className="w-4 h-4 mr-2" /> Open
          </Button>
        ) : (
          <Button onClick={onDownloadVpn} className="bg-cyan-600/80 hover:bg-cyan-600 text-white">
            <DownloadIcon className="w-4 h-4 mr-2" /> Install
          </Button>
        )}
      </div>

      {!vpnInstalled && (
        <p className="text-xs text-white/70">
          Or install via the <span className="text-white">Downloader</span> app using code{' '}
          <span className="text-cyan-300 font-mono">{info.downloaderCode}</span>.
        </p>
      )}

      <div className="border-t border-white/10 pt-3 space-y-3">
        <p className="text-sm text-white">Need an account?</p>
        <p className="text-xs text-white/70">
          Reach out to your reseller for sign-in details, or sign up yourself by scanning the QR code below.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <QrBlock value={info.signupUrl} />
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="text-xs text-white/60 mb-1">Sign up link:</p>
            <a
              href={info.signupUrl}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 text-sm break-all hover:underline inline-flex items-center gap-1"
            >
              {info.signupUrl}
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

const QrBlock = ({ value }: { value: string }) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: 180, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <div className="bg-white p-2 rounded-md flex-shrink-0">
      {dataUrl ? (
        <img src={dataUrl} alt="QR code" className="w-[160px] h-[160px]" />
      ) : (
        <div className="w-[160px] h-[160px] flex items-center justify-center text-slate-500 text-xs">Loading…</div>
      )}
    </div>
  );
};

const Summary = ({
  diagnosis,
  supportScript,
  chosenApp,
  chosenAppLabel,
  chosenAppInstalled,
  onLaunchApp,
  onCopy,
  onSubmitTicket,
  submittingTicket,
  onRestart,
}: {
  diagnosis: { title: string; bullets: string[] };
  supportScript: string;
  chosenApp: AppData | undefined;
  chosenAppLabel: string | null;
  chosenAppInstalled: boolean;
  onLaunchApp: () => void;
  onCopy: () => void;
  onSubmitTicket: () => void;
  submittingTicket: boolean;
  onRestart: () => void;
}) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-white">Your results</h2>
      <p className="text-sm text-white/70 mt-1">Most likely cause and what to do next.</p>
    </div>

    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-md p-4">
      <p className="font-medium text-cyan-200">{diagnosis.title}</p>
      <ul className="mt-2 space-y-1 text-sm text-white/90 list-disc list-inside">
        {diagnosis.bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>

    {chosenApp && chosenAppInstalled && chosenAppLabel && (
      <Button
        onClick={onLaunchApp}
        className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white"
      >
        <Play className="w-4 h-4 mr-2" /> Launch {chosenAppLabel} to Test
      </Button>
    )}

    <Button
      onClick={onSubmitTicket}
      disabled={submittingTicket}
      className="w-full bg-gradient-to-r from-purple-500 to-blue-600 text-white"
    >
      <MessageSquare className="w-4 h-4 mr-2" />
      {submittingTicket ? 'Submitting…' : 'Submit Ticket to Chat & Community'}
    </Button>

    <div>
      <p className="text-sm text-white mb-2">Copy/paste for support:</p>
      <textarea
        readOnly
        value={supportScript}
        className="w-full h-40 p-3 rounded-md bg-black/40 border border-white/20 text-white/90 text-xs font-mono focus:outline-none focus:border-cyan-400"
      />
    </div>

    <div className="flex flex-wrap gap-2">
      <Button onClick={onCopy} variant="outline" className="bg-white/10 border-white/30 text-white hover:bg-white/15">
        <Copy className="w-4 h-4 mr-2" /> Copy
      </Button>
      <Button onClick={onRestart} variant="outline" className="bg-white/10 border-white/30 text-white hover:bg-white/15">
        <RotateCw className="w-4 h-4 mr-2" /> Start Over
      </Button>
    </div>
  </Card>
);

/* ---------------- Logic ---------------- */

function getDiagnosis(state: State): { title: string; bullets: string[] } {
  if (state.step1Choice === 'one_only') {
    return {
      title: 'Likely cause: single channel/title source issue',
      bullets: [
        'If only one channel/title is failing, your internet is usually fine.',
        'Email the exact channel/title name to support so we can fix it fast.',
      ],
    };
  }
  if (state.didRestartAndCache === true) {
    return {
      title: 'Resolved: app/device glitch (cache) fixed it',
      bullets: [
        'Clearing cache + restarting refreshes the app and connection.',
        'If it happens again, repeat the Force Stop + Clear Cache step first.',
      ],
    };
  }
  if (typeof state.speedMbps === 'number' && state.speedMbps < 15) {
    return {
      title: 'Most likely cause: internet speed/quality on this device',
      bullets: [
        `Speed on the streaming device is under 15 Mbps (${state.speedMbps} Mbps).`,
        'Switch to 5GHz Wi-Fi, move closer, or try Ethernet.',
        'Restart modem/router and re-test speed.',
      ],
    };
  }
  if (state.vpnTest === 'fixed') {
    return {
      title: 'Most likely cause: ISP throttling (VPN confirmed it)',
      bullets: [
        'VPN working means your ISP likely slowed streaming traffic (especially during peak hours).',
        'Keep VPN on while streaming and use a nearby/fast server.',
        'If speed drops with VPN, choose the closest VPN city/server and re-test (15+ Mbps).',
      ],
    };
  }
  return {
    title: 'Still buffering: likely source/app + network combination',
    bullets: [
      'Re-check speed test closer to the router (15+ Mbps).',
      'Try VPN with a different nearby city/server and re-test speed (15+ Mbps).',
      `Email ${SUPPORT_EMAIL} with the results below so we can help quickly.`,
    ],
  };
}

function buildSupportScript(state: State, d: { title: string; bullets: string[] }): string {
  const lines: string[] = [];
  lines.push('Snow Media Buffering Walkthrough Results:');
  lines.push(`• App type: ${state.appType ?? 'N/A'}`);
  lines.push(`• Step 1 choice: ${state.step1Choice ?? 'N/A'} (one_only / all_buffer)`);
  lines.push(
    `• Force Stop + Clear Cache fixed it: ${
      state.didRestartAndCache === null ? 'N/A' : state.didRestartAndCache ? 'Yes' : 'No'
    }`
  );
  lines.push(`• Speed test (Mbps): ${state.speedMbps ?? 'N/A'} (goal 15+)`);
  lines.push(`• VPN chosen: ${state.vpnChoice ?? 'N/A'}`);
  lines.push(
    `• VPN speed 15+ with VPN: ${
      state.vpnSpeedOk === null ? 'N/A' : state.vpnSpeedOk ? 'Yes' : 'No'
    }`
  );
  lines.push(`• VPN test: ${state.vpnTest ?? 'N/A'}`);
  lines.push('');
  lines.push(`Likely cause: ${d.title}`);
  lines.push('');
  lines.push('Extra details (optional):');
  lines.push('- Device type (Fire TV / X96 / other Android box):');
  lines.push('- App name that is buffering:');
  lines.push('- Channel/title name (if applicable):');
  lines.push('- Time of day it happens most:');
  return lines.join('\n');
}

export default BufferingGuide;
