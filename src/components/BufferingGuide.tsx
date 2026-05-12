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
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import SpeedTest from '@/components/SpeedTest';

interface BufferingGuideProps {
  onClose: () => void;
}

type AppType = 'dreamstreams' | 'vibeztv' | 'plex' | 'other' | null;
type Step1Choice = 'one_only' | 'all_buffer' | null;
type YesNo = boolean | null;
type VpnTest = 'fixed' | 'still_buffering' | null;

interface State {
  appType: AppType;
  step1Choice: Step1Choice;
  didRestartAndCache: YesNo;
  speedMbps: number | null;
  speedMethod: 'speedtest_app' | 'in_app' | 'unknown' | null;
  vpnSpeedOk: YesNo;
  vpnTest: VpnTest;
}

const SUPPORT_EMAIL = 'support@snowmediaent.com';

const STEPS = ['intro', 'step1', 'step2', 'step3', 'step4', 'summary'] as const;
type StepKey = typeof STEPS[number];

const HINTS: Record<StepKey, string> = {
  intro: 'Choose your app type to start.',
  step1: 'If only one channel/title, report it so we can fix it fast.',
  step2: 'Restart + clear cache fixes a lot of issues.',
  step3: 'Run a speed test on this device (15+ Mbps).',
  step4: 'VPN test checks for ISP throttling.',
  summary: 'You\'re done — copy or email results if needed.',
};

const BufferingGuide = ({ onClose }: BufferingGuideProps) => {
  const { toast } = useToast();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<State>({
    appType: null,
    step1Choice: null,
    didRestartAndCache: null,
    speedMbps: null,
    speedMethod: null,
    vpnSpeedOk: null,
    vpnTest: null,
  });
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  const [speedInput, setSpeedInput] = useState<string>('');
  const contentRef = useRef<HTMLDivElement>(null);

  const step: StepKey = STEPS[stepIndex];

  const canNext = (() => {
    switch (step) {
      case 'intro': return !!state.appType;
      case 'step1': return state.step1Choice === 'all_buffer';
      case 'step2': return state.didRestartAndCache === false; // true short-circuits to summary
      case 'step3': return typeof state.speedMbps === 'number' && state.speedMbps >= 15;
      case 'step4': return state.vpnSpeedOk !== null && state.vpnTest === 'still_buffering';
      default: return false;
    }
  })();

  // Handle ESC / Back to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
      vpnSpeedOk: null,
      vpnTest: null,
    });
    setSpeedInput('');
    setStepIndex(0);
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

  const emailSupport = () => {
    const subject = encodeURIComponent('Buffering Walkthrough Results');
    const body = encodeURIComponent(supportScript);
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/10 bg-gradient-to-b from-blue-950/60 to-transparent">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <Button
            onClick={onClose}
            variant="outline"
            size="sm"
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
              onUnknown={() => {
                setState((s) => ({ ...s, speedMbps: 15, speedMethod: 'unknown' }));
              }}
            />
          )}

          {step === 'step4' && (
            <Step4
              vpnSpeedOk={state.vpnSpeedOk}
              vpnTest={state.vpnTest}
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
            />
          )}

          {step === 'summary' && (
            <Summary
              diagnosis={diagnosis}
              supportScript={supportScript}
              onCopy={copyScript}
              onEmail={emailSupport}
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
            className="bg-white/5 border-white/20 text-white hover:bg-white/10 disabled:opacity-40"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-xs text-white/60 hover:text-white truncate hidden sm:block"
          >
            Need help? {SUPPORT_EMAIL}
          </a>
          <Button
            onClick={goNext}
            disabled={!canNext || stepIndex === STEPS.length - 1}
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
            // After in-app speed test, prompt user to enter the result they saw
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
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <Button
    onClick={onClick}
    variant="outline"
    className={`w-full justify-start text-left h-auto py-3 px-4 transition-all duration-200 ${
      active
        ? 'bg-cyan-600/30 border-cyan-400 text-white shadow-[0_0_20px_hsl(var(--primary)/0.3)]'
        : 'bg-white/5 border-white/20 text-white hover:bg-white/10'
    }`}
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

const Step2 = ({ value, onSelect }: { value: YesNo; onSelect: (v: boolean) => void }) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-white">Restart device + clear app cache</h2>
      <p className="text-sm text-white/70 mt-1">
        Force-stop the app, clear its cache (use the Clear Cache button on the app's tile), then fully restart your device.
        Open the streaming app again and try a few channels/titles.
      </p>
    </div>
    <div className="space-y-2">
      <ChoiceButton active={value === true} onClick={() => onSelect(true)}>
        <CheckCircle2 className="w-4 h-4 mr-2 text-green-400" />
        Yes — that fixed it
      </ChoiceButton>
      <ChoiceButton active={value === false} onClick={() => onSelect(false)}>
        Still buffering
      </ChoiceButton>
    </div>
  </Card>
);

const Step3 = ({
  speedMbps,
  speedInput,
  setSpeedInput,
  onRunInApp,
  onSaveTyped,
  onUnknown,
}: {
  speedMbps: number | null;
  speedInput: string;
  setSpeedInput: (v: string) => void;
  onRunInApp: () => void;
  onSaveTyped: () => void;
  onUnknown: () => void;
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
      <Button onClick={onSaveTyped} variant="outline" className="bg-white/5 border-white/20 text-white hover:bg-white/10">
        Save
      </Button>
    </div>

    <button
      onClick={onUnknown}
      className="text-xs text-white/50 hover:text-white/80 underline"
    >
      I can't run a speed test — skip this step
    </button>

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
  vpnSpeedOk,
  vpnTest,
  onVpnSpeedOk,
  onVpnTest,
}: {
  vpnSpeedOk: YesNo;
  vpnTest: VpnTest;
  onVpnSpeedOk: (ok: boolean) => void;
  onVpnTest: (v: VpnTest) => void;
}) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-5">
    <div>
      <h2 className="text-xl font-semibold text-white flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-cyan-300" /> VPN test (ISP throttling check)
      </h2>
      <p className="text-sm text-white/70 mt-1">
        Connect a premium VPN, then check the questions below.
      </p>
    </div>

    <div className="bg-black/30 border border-white/10 rounded-md p-3 text-sm text-white/80 space-y-1">
      <p className="font-medium text-white">Recommended VPNs (premium)</p>
      <p>Download with Downloader app:</p>
      <p>• IPVanish code: <span className="text-cyan-300 font-mono">805133</span></p>
      <p>• Surfshark code: <span className="text-cyan-300 font-mono">3829522</span></p>
      <p className="text-white/60 text-xs pt-1">We don't recommend free VPNs.</p>
    </div>

    <div>
      <p className="text-sm text-white mb-2">After connecting VPN: is your speed still 15+ Mbps?</p>
      <div className="space-y-2">
        <ChoiceButton active={vpnSpeedOk === true} onClick={() => onVpnSpeedOk(true)}>
          Yes — 15+ Mbps with VPN
        </ChoiceButton>
        <ChoiceButton active={vpnSpeedOk === false} onClick={() => onVpnSpeedOk(false)}>
          No — speed dropped below 15
        </ChoiceButton>
      </div>
    </div>

    <div>
      <p className="text-sm text-white mb-2">Now test the stream with VPN ON</p>
      <div className="space-y-2">
        <ChoiceButton active={vpnTest === 'fixed'} onClick={() => onVpnTest('fixed')}>
          <CheckCircle2 className="w-4 h-4 mr-2 text-green-400" /> VPN fixed it
        </ChoiceButton>
        <ChoiceButton active={vpnTest === 'still_buffering'} onClick={() => onVpnTest('still_buffering')}>
          Still buffering
        </ChoiceButton>
      </div>
    </div>
  </Card>
);

const Summary = ({
  diagnosis,
  supportScript,
  onCopy,
  onEmail,
  onRestart,
}: {
  diagnosis: { title: string; bullets: string[] };
  supportScript: string;
  onCopy: () => void;
  onEmail: () => void;
  onRestart: () => void;
}) => (
  <Card className="bg-white/5 border-white/10 p-5 space-y-4">
    <div>
      <h2 className="text-xl font-semibold text-white">Your results</h2>
      <p className="text-sm text-white/70 mt-1">Most likely cause and what to do next.</p>
    </div>

    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-md p-4">
      <p className="font-medium text-cyan-200">{diagnosis.title}</p>
      <ul className="mt-2 space-y-1 text-sm text-white/80 list-disc list-inside">
        {diagnosis.bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>

    <div>
      <p className="text-sm text-white mb-2">Copy/paste for support:</p>
      <textarea
        readOnly
        value={supportScript}
        className="w-full h-40 p-3 rounded-md bg-black/40 border border-white/20 text-white/90 text-xs font-mono focus:outline-none focus:border-cyan-400"
      />
    </div>

    <div className="flex flex-wrap gap-2">
      <Button onClick={onCopy} className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white">
        <Copy className="w-4 h-4 mr-2" /> Copy
      </Button>
      <Button onClick={onEmail} variant="outline" className="bg-white/5 border-white/20 text-white hover:bg-white/10">
        <Mail className="w-4 h-4 mr-2" /> Email Support
      </Button>
      <Button onClick={onRestart} variant="outline" className="bg-white/5 border-white/20 text-white hover:bg-white/10">
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
        'If it happens again, repeat the restart + clear cache step first.',
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
    `• Restart + clear cache fixed it: ${
      state.didRestartAndCache === null ? 'N/A' : state.didRestartAndCache ? 'Yes' : 'No'
    }`
  );
  lines.push(`• Speed test (Mbps): ${state.speedMbps ?? 'N/A'} (goal 15+)`);
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
