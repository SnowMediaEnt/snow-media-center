import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useDeviceInstalledApps } from '@/hooks/useDeviceInstalledApps';

import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { MessageSquare } from 'lucide-react';

interface BufferingGuideProps {
  onClose: () => void;
  apps: AppData[];
  appStatuses: Map<string, { installed: boolean }>;
  onLaunch: (app: AppData) => void | Promise<void>;
  onDownload: (app: AppData) => void;
  onOpenAppSettings?: (app: AppData) => void | Promise<void>;
  onNavigateToChat?: () => void;
  /** Where the guide was opened from — 'plex-movie' relabels Close to "Back to Player". */
  origin?: string | null;
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
    pkg: 'com.ixolit.ipvanish',
    pkgCandidates: ['com.ixolit.ipvanish', 'com.ixonn.ipvanish', 'com.ixolus.ipvanish', 'com.ipvanish.vpn', 'com.ipvanish.android'],
    downloaderCode: '805133',
    signupUrl: 'https://ssqt.co/mzS1auK',
    matchKeys: ['ipvanish'],
    icon: 'https://snowmediaapps.com/icons/ipvanish.png',
    fallbackDownloadUrl: 'https://snowmediaapps.com/guesswhat/download.php?file=IPVanishTV.apk&k=tJIso9tAokZ937fFcnpWT6YL0oJQ',
  },
  surfshark: {
    label: 'Surfshark',
    pkg: 'com.surfshark.vpnclient.android',
    pkgCandidates: ['com.surfshark.vpnclient.android', 'com.surfshark.android.tv'],
    downloaderCode: '3829522',
    signupUrl: 'https://surfshark.com',
    matchKeys: ['surfshark'],
    icon: 'https://snowmediaapps.com/icons/surfsharkvpn.png',
    fallbackDownloadUrl: 'https://snowmediaapps.com/apps/download.php?file=Surfshark.apk',
  },
} as const;


const BufferingGuide = ({
  onClose,
  apps,
  appStatuses,
  onLaunch,
  onDownload,
  onOpenAppSettings,
  onNavigateToChat,
  origin,
}: BufferingGuideProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
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
  const [reportTitle, setReportTitle] = useState('');
  const [reportDevice, setReportDevice] = useState<string | null>(null);
  const [showAnonConfirm, setShowAnonConfirm] = useState(false);
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [showVpnSkipConfirm, setShowVpnSkipConfirm] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Mark the guide as open globally so the app-wide Capacitor back-button
  // listener (in useNavigation) skips its goBack() — otherwise BACK pops
  // Support → Home in addition to closing the guide.
  useLayoutEffect(() => {
    (window as unknown as { __bufferingGuideOpen?: boolean }).__bufferingGuideOpen = true;
    try { trackEvent('buffering_guide_start', 'support'); } catch { void 0; }
    return () => {
      (window as unknown as { __bufferingGuideOpen?: boolean }).__bufferingGuideOpen = false;
    };
  }, []);

  useEffect(() => {
    if (STEPS[stepIndex] === 'summary') {
      try { trackEvent('buffering_guide_complete', 'support'); } catch { void 0; }
    }
  }, [stepIndex]);

  const rootRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  // When the user goes back (footer Back / remote Back), don't re-focus
  // content — keep focus on the Back button so they can press it again
  // to pop further without hunting back up.
  const justWentBackRef = useRef(false);

  const step: StepKey = STEPS[stepIndex];

  const anonConfirmRef = useRef<HTMLDivElement>(null);
  const vpnSkipConfirmRef = useRef<HTMLDivElement>(null);

  // Collect focusable buttons/links/inputs inside the modal
  const getFocusables = (): HTMLElement[] => {
    const scope: HTMLElement | null =
      (showVpnSkipConfirm && vpnSkipConfirmRef.current) ? vpnSkipConfirmRef.current :
      (showAnonConfirm && anonConfirmRef.current) ? anonConfirmRef.current :
      rootRef.current;
    if (!scope) return [];
    const nodes = scope.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.from(nodes).filter((el) => {
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.getAttribute('data-no-dpad') === 'true') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  };

  // Auto-focus the confirm dialog when it opens
  useEffect(() => {
    if (!showAnonConfirm) return;
    const t = setTimeout(() => {
      const btn = anonConfirmRef.current?.querySelector<HTMLButtonElement>(
        'button:not([disabled])'
      );
      btn?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [showAnonConfirm]);

  useEffect(() => {
    if (!showVpnSkipConfirm) return;
    const t = setTimeout(() => {
      const btn = vpnSkipConfirmRef.current?.querySelector<HTMLButtonElement>(
        '[data-vpn-skip-primary="true"]'
      ) || vpnSkipConfirmRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
      btn?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [showVpnSkipConfirm]);




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
      // Allow text inputs/textareas to handle arrows themselves,
      // EXCEPT ArrowDown / ArrowRight which should jump out of the field
      // (so D-pad lands on the Save button instead of moving the caret
      // through each digit).
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (key === 'ArrowDown' || key === 'ArrowRight') {
          (target as HTMLInputElement).blur();
        } else {
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();

      // On the summary step there's a long recap that users want to read.
      // If the content area can still scroll in the pressed direction,
      // scroll it FIRST instead of yanking focus up to the header Close.
      if (step === 'summary' && (key === 'ArrowUp' || key === 'ArrowDown')) {
        const scroller = contentRef.current;
        if (scroller) {
          const canScrollUp = scroller.scrollTop > 4;
          const canScrollDown =
            scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 4;
          if (key === 'ArrowUp' && canScrollUp) {
            scroller.scrollBy({ top: -Math.round(scroller.clientHeight * 0.7), behavior: 'smooth' });
            return;
          }
          if (key === 'ArrowDown' && canScrollDown) {
            scroller.scrollBy({ top: Math.round(scroller.clientHeight * 0.7), behavior: 'smooth' });
            return;
          }
        }
      }

      // Summary step: walk a deterministic ordered list (header Close →
      // Launch? → Submit → Start Over → footer Back) so spatial scoring
      // can't skip past the full-width "Submit Ticket" when adjacent
      // buttons (Start Over, footer Back) are left-aligned and narrow.
      if (step === 'summary' && (key === 'ArrowUp' || key === 'ArrowDown')) {
        const ordered = Array.from(
          rootRef.current?.querySelectorAll<HTMLElement>('[data-summary-order]') ?? []
        )
          .filter((el) => !(el as HTMLButtonElement).disabled && el.getBoundingClientRect().width > 0)
          .sort((a, b) => Number(a.dataset.summaryOrder) - Number(b.dataset.summaryOrder));
        if (ordered.length > 0) {
          const docActiveNow = document.activeElement as HTMLElement | null;
          const idx = docActiveNow ? ordered.indexOf(docActiveNow) : -1;
          const nextIdx = key === 'ArrowDown'
            ? Math.min(ordered.length - 1, idx < 0 ? 0 : idx + 1)
            : Math.max(0, idx < 0 ? ordered.length - 1 : idx - 1);
          const target = ordered[nextIdx];
          if (target && target !== docActiveNow) {
            target.focus();
            lastFocusedRef.current = target;
            target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          return;
        }
      }



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
        focusables[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }

      // Explicit override: ArrowDown from a VPN choice tab should always
      // land on the Install/Open button below it (regardless of spatial
      // scoring vs. QR link). ArrowUp from that button returns to the
      // currently active VPN tab.
      if (key === 'ArrowDown') {
        const vpnChoice = activeEl.getAttribute('data-vpn-choice');
        if (vpnChoice) {
          const btn = document.querySelector<HTMLElement>('[data-vpn-primary-action]');
          if (btn) {
            btn.focus();
            lastFocusedRef.current = btn;
            btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
          }
        }
      }
      if (key === 'ArrowUp' && activeEl.hasAttribute('data-vpn-primary-action')) {
        const activeTab = document.querySelector<HTMLElement>(
          '[data-vpn-choice][data-guide-choice-active="true"]'
        ) || document.querySelector<HTMLElement>('[data-vpn-choice]');
        if (activeTab) {
          activeTab.focus();
          lastFocusedRef.current = activeTab;
          activeTab.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
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
          // Footer bias: when descending WITHIN the footer row, prefer the
          // primary "Next" action over the secondary "Back" action. We only
          // apply this when the currently-focused element is itself in the
          // footer (i.e. already on Back/Next) — otherwise the bias would
          // make the footer Next button win over real content buttons like
          // the VPN Install button, which sit between the user and the footer.
          if (key === 'ArrowDown') {
            const activeIsFooter = !!activeEl?.getAttribute('data-guide-nav');
            const nav = el.getAttribute('data-guide-nav');
            if (activeIsFooter && nav === 'next' && !(el as HTMLButtonElement).disabled) {
              score -= 1000;
            } else if (activeIsFooter && nav === 'back') {
              score += 1000;
            } else if (nav === 'next' && !(el as HTMLButtonElement).disabled) {
              // From content, prefer the primary Next action over Back when
              // descending into the footer.
              score -= 500;
            } else if (nav === 'back') {
              score += 500;
            }
          }

          return { el, score };
        })
        .sort((a, b) => a.score - b.score);

      const next = scored[0]?.el;
      if (next) {
        next.focus();
        lastFocusedRef.current = next;
        // On step4 (VPN step) the QR code sits between focusables. Use a
        // gentler two-stage scroll so the QR isn't skipped over by a big
        // center-jump to the next button.
        if (step === 'step4') {
          const nextRect = next.getBoundingClientRect();
          const curRect = cur;
          const delta = nextRect.top - curRect.top;
          // If the jump is large, scroll halfway first so the QR stays visible,
          // then finish the scroll after a short pause.
          if (Math.abs(delta) > 220) {
            const scroller =
              contentRef.current?.closest('[data-guide-scroll]') as HTMLElement | null
              ?? contentRef.current
              ?? document.scrollingElement as HTMLElement | null;
            if (scroller) {
              scroller.scrollBy({ top: delta / 2, behavior: 'smooth' });
              window.setTimeout(() => {
                next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              }, 320);
            } else {
              next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          } else {
            next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else {
          next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showSpeedTest, stepIndex]);

  // Auto-focus the first focusable element when step (or step1 sub-view) changes
  useEffect(() => {
    if (showSpeedTest) return;
    // Snap content to top BEFORE focusing so focus() doesn't scroll us to a
    // button further down the page (Submit Ticket on the summary step).
    contentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    const t = setTimeout(() => {
      const focusables = getFocusables();
      // If we just came here via Back, keep focus on the footer Back button
      // so the user can hold Back to keep popping.
      if (justWentBackRef.current) {
        justWentBackRef.current = false;
        const back = rootRef.current?.querySelector<HTMLElement>('[data-guide-nav="back"]');
        if (back) {
          back.focus({ preventScroll: true });
          lastFocusedRef.current = back;
          contentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
          return;
        }
      }
      // Prefer first focusable inside the content area (skip header Close button)
      const contentFocusables = focusables.filter((el) => contentRef.current?.contains(el));
      // Prefer an explicit step-entry anchor if provided (e.g. ReportChannelStep input)
      const anchor = contentFocusables.find((el) => el.getAttribute('data-guide-entry') === 'true');
      const target = anchor || contentFocusables[0] || focusables[0];
      if (target) {
        target.focus({ preventScroll: true });
        lastFocusedRef.current = target;
      }
      // Re-assert scroll-to-top after focus in case anything tried to scroll.
      contentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    }, 80);
    return () => clearTimeout(t);
    // Only depend on a derived "sub-view key" so picking a Step1 answer
    // (null → 'all_buffer') doesn't yank focus back to the first option.
    // Re-fire only on real step changes or when entering/leaving the
    // 'one_only' report sub-view.
  }, [stepIndex, showSpeedTest, state.step1Choice === 'one_only']);


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

  const prevCanNextRef = useRef(false);


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

  const buildVpnApp = (key: 'ipvanish' | 'surfshark'): AppData => {
    const info = VPN_INFO[key];
    const found = findApp([...info.matchKeys], info.pkg);
    if (found) return found.packageName ? found : { ...found, packageName: info.pkg };
    console.warn(`[BufferingGuide] ${info.label} not in apps feed — using fallback download URL`);
    return {
      id: key,
      name: info.label,
      version: '1.0',
      size: '50MB',
      description: `${info.label} VPN`,
      icon: info.icon,
      apk: info.fallbackDownloadUrl,
      downloadUrl: info.fallbackDownloadUrl,
      packageName: info.pkg,
      featured: true,
      category: 'support',
    } as AppData;
  };
  const ipvanishApp = useMemo(() => buildVpnApp('ipvanish'), [apps]);
  const surfsharkApp = useMemo(() => buildVpnApp('surfshark'), [apps]);

  const [ipvanishLive, setIpvanishLive] = useState<boolean | null>(null);
  const [surfsharkLive, setSurfsharkLive] = useState<boolean | null>(null);

  const { isPackageInstalled, isAppNameInstalled, resolvePackageName, refresh: refreshInstalledApps } = useDeviceInstalledApps();


  useEffect(() => {
    let cancelled = false;
    const checkAny = (pkgs: readonly string[], setter: (b: boolean | null) => void) => {
      // Phase 6A: use the cached installed set — no per-package native call.
      if (cancelled) return;
      const found = pkgs.some((pkg) => isPackageInstalled(pkg));
      setter(found);
    };
    const recheck = () => {
      checkAny(VPN_INFO.ipvanish.pkgCandidates, setIpvanishLive);
      checkAny(VPN_INFO.surfshark.pkgCandidates, setSurfsharkLive);
      // Debounced refresh of the shared cache (no-op inside the debounce window).
      refreshInstalledApps();
    };
    recheck();
    const onFocus = () => recheck();
    const onVisibility = () => { if (document.visibilityState === 'visible') recheck(); };
    const onResume = () => recheck();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('app-resumed', onResume as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('app-resumed', onResume as EventListener);
    };
  }, [step, refreshInstalledApps, isPackageInstalled]);


  const ipvanishInstalled =
    !!appStatuses.get(ipvanishApp.id)?.installed ||
    ipvanishLive === true ||
    VPN_INFO.ipvanish.pkgCandidates.some((pkg) => isPackageInstalled(pkg)) ||
    isAppNameInstalled('IPVanish');
  const surfsharkInstalled =
    !!appStatuses.get(surfsharkApp.id)?.installed ||
    surfsharkLive === true ||
    VPN_INFO.surfshark.pkgCandidates.some((pkg) => isPackageInstalled(pkg)) ||
    isAppNameInstalled('Surfshark');




  // Backward-compatible single-choice values used by diagnosis/script
  const vpnApp: AppData | undefined =
    state.vpnChoice === 'surfshark' ? surfsharkApp :
    state.vpnChoice === 'ipvanish' ? ipvanishApp : undefined;
  const vpnInstalled =
    state.vpnChoice === 'surfshark' ? surfsharkInstalled :
    state.vpnChoice === 'ipvanish' ? ipvanishInstalled : false;

  // When entering step4, auto-select IPVanish so the Install/Open button is
  // immediately reachable (no need to click the VPN tab first).
  useEffect(() => {
    if (step === 'step4' && !state.vpnChoice) {
      setState((s) => ({ ...s, vpnChoice: 'ipvanish' }));
    }
  }, [step, state.vpnChoice]);

  // NOTE: We intentionally do NOT auto-focus the Install/Open VPN button on
  // step4 — that jumped focus past the step title/instructions and made
  // ArrowUp feel broken (it would leap to the header Close button). The
  // generic auto-focus effect above will focus the first content element,
  // keeping the page scrolled to the top so the user can read the step.


  const canNext = (() => {
    switch (step) {
      case 'intro': return !!state.appType;
      case 'step1': return state.step1Choice === 'all_buffer';
      case 'step2': return state.didRestartAndCache === false; // true short-circuits to summary
      case 'step3': return typeof state.speedMbps === 'number' && state.speedMbps >= 15;
      case 'step4': return state.vpnTest === 'still_buffering';
      default: return false;
    }
  })();

  // FOCUS-HIGHLIGHT SYNC: When the user picks an answer that enables the
  // primary "Next" action, also move the real D-pad focus to it. Otherwise
  // the Next button's `:focus` styles light up (it looks highlighted because
  // of color/contrast) while the real cursor is still on the option button,
  // and pressing OK does nothing until the user manually presses DOWN.
  useEffect(() => {
    const wasEnabled = prevCanNextRef.current;
    prevCanNextRef.current = canNext;
    if (showSpeedTest) return;
    if (!canNext || wasEnabled) return;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !rootRef.current?.contains(active)) return;
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return;
    if (active.getAttribute('data-guide-nav')) return;
    if (active.getAttribute('data-guide-choice') !== 'true') return;
    const t = window.setTimeout(() => {
      const next = rootRef.current?.querySelector<HTMLElement>(
        '[data-guide-nav="next"]:not([disabled])'
      );
      if (next) {
        next.focus({ preventScroll: true });
        lastFocusedRef.current = next;
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 40);
    return () => window.clearTimeout(t);
  }, [canNext, showSpeedTest, step]);


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
        if (document.querySelector('[data-download-progress="true"]')) return;
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
        if (document.querySelector('[data-download-progress="true"]')) return;
        // Don't hijack Backspace while typing in a text field — only
        // ESC and the Android remote BACK key (keyCode 4) should navigate.
        const tgt = e.target as HTMLElement | null;
        const inField = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
        if (e.key === 'Backspace' && inField) return;
        e.preventDefault();
        e.stopPropagation();
        (e as any).stopImmediatePropagation?.();
        if (showSpeedTest) return; // SpeedTest handles its own
        // Dismiss any transient confirm dialog first — don't step pages or exit.
        if (showAnonConfirm) { setShowAnonConfirm(false); return; }
        if (showVpnSkipConfirm) { setShowVpnSkipConfirm(false); return; }
        if (showSignInPrompt) { setShowSignInPrompt(false); return; }
        // If we're inside the "report broken channel" sub-view, pop back to
        // the Step 1 yes/no choice instead of jumping to the intro screen.
        if (step === 'step1' && state.step1Choice === 'one_only') {
          setReportTitle('');
          setReportDevice(null);
          setState((s) => ({ ...s, step1Choice: null }));
          justWentBackRef.current = true;
          return;
        }
        if (stepIndex > 0) {
          justWentBackRef.current = true;
          setStepIndex((i) => i - 1);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [stepIndex, onClose, showSpeedTest, step, state.step1Choice, showAnonConfirm, showVpnSkipConfirm, showSignInPrompt]);

  // Capacitor native back button — intercept so the global navigation
  // handler doesn't pop us all the way out to the Home Screen. Always
  // step back inside the guide first, and only close when on the intro.
  useLayoutEffect(() => {
    let handle: { remove?: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        handle = await App.addListener('backButton', () => {
          if (cancelled) return;
          // Mark the back press as handled so the global navigation
          // handler in useNavigation doesn't also pop Support → Home.
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          if (showSpeedTest) return;
          if (showAnonConfirm) { setShowAnonConfirm(false); return; }
          if (showVpnSkipConfirm) { setShowVpnSkipConfirm(false); return; }
          if (showSignInPrompt) { setShowSignInPrompt(false); return; }
          if (step === 'step1' && state.step1Choice === 'one_only') {
            setReportTitle('');
            setReportDevice(null);
            setState((s) => ({ ...s, step1Choice: null }));
            justWentBackRef.current = true;
            return;
          }
          if (stepIndex > 0) {
            justWentBackRef.current = true;
            setStepIndex((i) => i - 1);
          } else {
            onClose();
          }
        });

      } catch {
        // Web / non-Capacitor — keydown handler covers Escape/Backspace.
      }
    })();
    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [stepIndex, showSpeedTest, step, state.step1Choice, onClose, showAnonConfirm, showVpnSkipConfirm, showSignInPrompt]);

  // Scroll content to top on step change
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stepIndex]);


  const goNext = () => {
    // On the VPN step, allow advancing even if the VPN flow isn't complete,
    // but warn the user first with an info popup explaining ISP throttling.
    if (step === 'step4' && !canNext) {
      setShowVpnSkipConfirm(true);
      return;
    }
    if (canNext && stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
  };
  const goBack = () => {
    // Pop the report sub-view first, otherwise step back one.
    if (step === 'step1' && state.step1Choice === 'one_only') {
      setReportTitle('');
      setReportDevice(null);
      setState((s) => ({ ...s, step1Choice: null }));
      justWentBackRef.current = true;
      return;
    }
    if (stepIndex > 0) {
      justWentBackRef.current = true;
      setStepIndex((i) => i - 1);
    }
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

  const openAppSettings = async (packageName: string, appName?: string) => {
    try {
      await AppManager.openAppSettings({ packageName, appName });
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

  const submitAsTicket = async (overrideSubject?: string, overrideBody?: string) => {

    console.log('[BufferingGuide] Submit ticket clicked', { hasUser: !!user });
    if (!user) {
      setShowSignInPrompt(true);
      return;
    }
    try {
      setSubmittingTicket(true);
      const ts = new Date().toLocaleString();
      const subject = overrideSubject ?? `Buffering Walkthrough Results — ${ts}`;
      const body = overrideBody ?? `${supportScript}\n\nSaved: ${ts}`;
      await createTicket(subject, body);
      toast({
        title: 'Ticket submitted',
        description: 'Opening Support → Tickets.',
      });
      onClose();
      // Defer nav slightly so the modal unmounts cleanly first
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('support:open-tickets'));
        onNavigateToChat?.();
      }, 50);
    } catch (err) {
      console.error('[BufferingGuide] submitAsTicket failed', err);
      toast({
        title: 'Could not submit ticket',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmittingTicket(false);
    }
  };

  const buildChannelReport = () => {
    const title = reportTitle.trim();
    if (!title) {
      toast({ title: 'Enter a title', description: 'Type the channel or movie/show name first.', variant: 'destructive' });
      return null;
    }
    if (!reportDevice) {
      toast({ title: 'Pick a device', description: 'Tell us which device you are watching on.', variant: 'destructive' });
      return null;
    }
    const ts = new Date().toLocaleString();
    const appLabel = state.appType ? APP_LABELS[state.appType] : 'streaming app';
    const subject = `Broken channel/title in ${appLabel}: ${title}`;
    const body = [
      `App: ${appLabel}`,
      `Device: ${reportDevice}`,
      `Channel / Title: ${title}`,
      `Reported: ${ts}`,
    ].join('\n');
    return { subject, body };
  };

  const submitChannelReport = async () => {
    const report = buildChannelReport();
    if (!report) return;
    if (!user) {
      // Show in-guide confirmation (z-index above the guide)
      setShowAnonConfirm(true);
      return;
    }
    await submitAsTicket(report.subject, report.body);
  };

  const submitAnonymousChannelReport = async () => {
    const report = buildChannelReport();
    if (!report) return;
    try {
      setSubmittingTicket(true);
      const ts = new Date().toLocaleString();
      await supabase.functions.invoke('send-custom-email', {
        body: {
          to: 'support@snowmediaent.com',
          subject: `[Anonymous Report] ${report.subject}`,
          html: `
            <h3>Anonymous Channel/Title Report</h3>
            <p><em>Submitted from Buffering Guide by an unauthenticated user.</em></p>
            <div style="margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 5px; white-space: pre-wrap;">${report.body.replace(/\n/g, '<br>')}</div>
            <p style="margin-top: 16px; font-size: 12px; color: #666;">Received: ${ts}</p>
          `,
          fromName: 'Snow Media Anonymous Report',
        },
      });
      toast({
        title: 'Report sent',
        description: 'Thanks! Sign in next time to track it on your account.',
      });
      setShowAnonConfirm(false);
      onClose();
    } catch (err) {
      console.error('[BufferingGuide] anonymous report failed', err);
      toast({
        title: 'Could not send report',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmittingTicket(false);
    }
  };



  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col [&_button:focus]:outline-none [&_button:focus-visible]:outline-none [&_button:focus]:ring-0 [&_button:focus]:scale-[1.04] [&_button:focus]:shadow-[0_0_28px_6px_hsl(45_93%_58%/0.55)] [&_button:focus]:border-yellow-300 [&_button:focus]:z-10 [&_button]:transition-all [&_button]:duration-150 [&_a:focus]:outline-none [&_a:focus]:ring-2 [&_a:focus]:ring-yellow-300 [&_a:focus]:rounded">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-white/10 bg-gradient-to-b from-blue-950/60 to-transparent">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <Button
            onClick={onClose}
            variant="outline"
            size="sm"
            data-guide-nav="close"
            data-summary-order="0"
            className="bg-white/5 border-white/20 text-white hover:bg-white/10"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> {origin === 'plex-movie' ? 'Back to Player' : 'Close'}
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
        <div className="max-w-3xl mx-auto mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
            style={{ width: `${(stepIndex / (STEPS.length - 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="max-w-3xl mx-auto space-y-2">
          {HINTS[step] && step !== 'step4' && (
            <p className="text-xs uppercase tracking-wider text-cyan-300/80">{HINTS[step]}</p>
          )}

          {step === 'intro' && (
            <>
              <IntroStep
                value={state.appType}
                onSelect={(t) => setState((s) => ({ ...s, appType: t }))}
              />
              <div className="mt-4 flex justify-center">
                <Button
                  onClick={() => setStepIndex(STEPS.indexOf('step4'))}
                  variant="outline"
                  title="Already tried a VPN? Jump straight to the VPN step."
                  className="bg-blue-600/20 border-blue-400/50 text-white hover:bg-blue-600/30"
                >
                  Already did VPN → Skip to VPN step
                </Button>
              </div>
            </>
          )}


          {step === 'step1' && state.step1Choice !== 'one_only' && (
            <Step1
              value={state.step1Choice}
              onSelect={(choice) => {
                setState((s) => ({ ...s, step1Choice: choice }));
                // Stay on step1; the report form renders below when choice === 'one_only'
                contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}

          {step === 'step1' && state.step1Choice === 'one_only' && (
            <ReportChannelStep
              title={reportTitle}
              device={reportDevice}
              appLabel={state.appType ? APP_LABELS[state.appType] : 'your app'}
              submitting={submittingTicket}
              onTitleChange={setReportTitle}
              onDeviceChange={setReportDevice}
              onSubmit={submitChannelReport}
              onBack={() => {
                setReportTitle('');
                setReportDevice(null);
                setState((s) => ({ ...s, step1Choice: null }));
                contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
                const label = state.appType ? APP_LABELS[state.appType] : null;
                // Build a synthetic AppData so the parent's resolvePackageName
                // can match by display name against the actually-installed app.
                const synthetic: AppData | null = label
                  ? ({
                      ...(chosenApp || {}),
                      id: chosenApp?.id || `guide-${state.appType}`,
                      name: label,
                      packageName:
                        chosenApp?.packageName ||
                        (state.appType ? STREAMING_PKG[state.appType] : null) ||
                        undefined,
                    } as AppData)
                  : chosenApp || null;
                if (synthetic && onOpenAppSettings) {
                  onOpenAppSettings(synthetic);
                  return;
                }
                const pkg =
                  chosenApp?.packageName ||
                  (state.appType ? STREAMING_PKG[state.appType] : null);
                const fallbackLabel = label || chosenApp?.name || undefined;
                if (!pkg && !fallbackLabel) {
                  toast({
                    title: 'Open Android Settings → Apps',
                    description: 'Find the app, then tap Force Stop and Clear Cache.',
                  });
                  return;
                }
                openAppSettings(pkg || '', fallbackLabel);
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
              vpnSpeedOk={state.vpnSpeedOk}
              vpnTest={state.vpnTest}
              ipvanishApp={ipvanishApp}
              ipvanishInstalled={ipvanishInstalled}
              surfsharkApp={surfsharkApp}
              surfsharkInstalled={surfsharkInstalled}
              onDownloadVpn={(c) => {
                setState((s) => ({ ...s, vpnChoice: c, vpnSpeedOk: null, vpnTest: null }));
                const app = c === 'ipvanish' ? ipvanishApp : surfsharkApp;
                if (app) onDownload(app);
                else toast({ title: 'VPN not in store', description: 'Use the Downloader code instead.', variant: 'destructive' });
              }}
              onLaunchVpn={(c) => {
                setState((s) => ({ ...s, vpnChoice: c }));
                const app = c === 'ipvanish' ? ipvanishApp : surfsharkApp;
                const packageName = resolvePackageName(app?.name, VPN_INFO[c].pkg) || VPN_INFO[c].pkg;
                launchPackage(packageName);
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
              vpnChoice={state.vpnChoice}
              onChooseVpn={(c) => setState((s) => ({ ...s, vpnChoice: c, vpnSpeedOk: null, vpnTest: null }))}
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
      <div className="flex-shrink-0 px-4 py-2 border-t border-white/10 bg-black/60">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <Button
                onClick={goBack}
                variant="outline"
                data-guide-nav="back"
                data-summary-order="4"
                className="bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white focus:bg-white/10 focus:text-white focus-visible:bg-white/10 focus-visible:text-white active:bg-white/10 active:text-white"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
            ) : (
              <span className="w-[88px]" />
            )}
          </div>

          <span className="text-xs text-white/70 truncate hidden sm:block select-none pointer-events-none">
            Submit a Ticket in Chat &amp; Community
          </span>
          {step !== 'summary' ? (
            <Button
              onClick={goNext}
              disabled={!canNext && step !== 'step4'}
              data-guide-nav="next"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white disabled:opacity-40"
            >
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <span className="w-[88px]" />
          )}
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

      {showAnonConfirm && (
        <div ref={anonConfirmRef} className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-lg w-full p-6 shadow-[0_0_40px_8px_hsl(190_80%_50%/0.25)]">
            <h3 className="text-xl font-semibold text-white mb-3">Send report without signing in?</h3>
            <p className="text-sm text-white/80 leading-relaxed mb-4">
              Your report will be submitted to Snow Media support, but it will <strong>not</strong> be saved to your account.
            </p>
            <p className="text-sm text-cyan-200 leading-relaxed mb-6">
              Tip: Go back to the Home Screen and tap <strong>Sign In</strong> first so your ticket is saved on your account and you can track replies.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowAnonConfirm(false)}
                disabled={submittingTicket}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10"
              >
                Cancel
              </Button>
              <Button
                onClick={submitAnonymousChannelReport}
                disabled={submittingTicket}
                className="bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                {submittingTicket ? 'Sending…' : 'Send anyway'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showSignInPrompt && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-lg w-full p-6 shadow-[0_0_40px_8px_hsl(190_80%_50%/0.25)]">
            <h3 className="text-xl font-semibold text-white mb-3">Sign in to submit a ticket</h3>
            <p className="text-sm text-white/85 leading-relaxed mb-3">
              You need an account to submit a support ticket so our team can <strong>reply back to you</strong> and you can track the conversation.
            </p>
            <p className="text-sm text-cyan-200 leading-relaxed mb-6">
              Sign in or create a free account to submit your ticket and get replies back.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowSignInPrompt(false)}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowSignInPrompt(false);
                  onClose();
                  navigate('/auth');
                }}
                className="bg-cyan-600 hover:bg-cyan-500 text-white"
                autoFocus
              >
                Sign In
              </Button>
            </div>
          </div>
        </div>
      )}

      {showVpnSkipConfirm && (
        <div ref={vpnSkipConfirmRef} className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-lg w-full p-6 shadow-[0_0_40px_8px_hsl(190_80%_50%/0.25)]">
            <h3 className="text-xl font-semibold text-white mb-3">Skip the VPN step?</h3>
            <p className="text-sm text-white/85 leading-relaxed mb-3">
              Heads up: Your internet provider can slow you down during peak hours — or for no clear reason at all. In 2026, ISP throttling is the <strong>#1 cause of buffering</strong>.
            </p>
            <p className="text-sm text-cyan-200 leading-relaxed mb-6">
              If nothing has worked up to this point, installing and turning on a VPN will more than likely fix it. You can still continue if you'd rather skip for now.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowVpnSkipConfirm(false)}
                className="bg-white/5 border-white/20 text-white hover:bg-white/10"
              >
                Go back
              </Button>
              <Button
                data-vpn-skip-primary="true"
                onClick={() => {
                  setShowVpnSkipConfirm(false);
                  if (stepIndex < STEPS.length - 1) setStepIndex((i) => i + 1);
                }}
                className="bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
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
  dataVpnChoice,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  dataVpnChoice?: 'ipvanish' | 'surfshark';
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
    data-vpn-choice={dataVpnChoice}
    variant="outline"
    className={`w-full justify-start text-left h-auto py-3 px-4 font-semibold transition-all duration-200 !text-white whitespace-normal break-words ${
      active
        ? '!bg-cyan-600/60 !border-cyan-300 shadow-[0_0_20px_hsl(var(--primary)/0.3)]'
        : '!bg-white/15 !border-white/40 hover:!bg-white/25'
    } ${className}`}
  >
    {children}
  </Button>
);


const IntroStep = ({ value, onSelect }: { value: AppType; onSelect: (t: AppType) => void }) => (
  <Card className="bg-white/5 border-white/10 p-3 space-y-2">
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

const DEVICE_OPTIONS: string[] = [
  'Amazon Fire TV / Firestick',
  'Android TV / Google TV',
  'Android Phone or Tablet',
  'Set-Top Box (X96 / T95 / etc.)',
  'Other',
];

const ReportChannelStep = ({
  title,
  device,
  appLabel,
  submitting,
  onTitleChange,
  onDeviceChange,
  onSubmit,
  onBack,
}: {
  title: string;
  device: string | null;
  appLabel: string;
  submitting: boolean;
  onTitleChange: (v: string) => void;
  onDeviceChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) => (
  <Card className="bg-white/5 border-white/10 p-3 space-y-3">
    <div>
      <h2 className="text-xl font-semibold text-white">Report the broken channel/title</h2>
      <p className="text-sm text-white/70 mt-1">
        Tell us the exact channel or movie/show name in <strong>{appLabel}</strong> and which device you're using.
        We'll open a Support Ticket for you.
      </p>
    </div>

    <div className="space-y-2">
      <label className="text-sm text-white/80">Channel or movie/show name</label>
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder="e.g. ESPN HD, The Bear S03E01"
        data-guide-entry="true"
        className="w-full px-3 py-2 rounded-md bg-black/40 border border-white/20 text-white placeholder:text-white/40 focus:outline-none focus:border-cyan-400"
      />
    </div>

    <div className="space-y-2">
      <label className="text-sm text-white/80">Which device are you watching on?</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {DEVICE_OPTIONS.map((d) => (
          <ChoiceButton key={d} active={device === d} onClick={() => onDeviceChange(d)}>
            {d}
          </ChoiceButton>
        ))}
      </div>
    </div>

    <div className="flex flex-col sm:flex-row gap-2 pt-2">
      <Button
        onClick={onBack}
        variant="outline"
        className="bg-white/5 border-white/20 text-white hover:bg-white/10"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Change answer
      </Button>
      <Button
        onClick={onSubmit}
        disabled={submitting || !title.trim() || !device}
        className="bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-40 flex-1"
      >
        <MessageSquare className="w-4 h-4 mr-2" />
        {submitting ? 'Submitting…' : 'Submit Ticket'}
      </Button>
    </div>
  </Card>
);



const Step1 = ({ value, onSelect }: { value: Step1Choice; onSelect: (c: Step1Choice) => void }) => (
  <Card className="bg-white/5 border-white/10 p-3 space-y-2">
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
  <Card className="bg-white/5 border-white/10 p-3 space-y-2">
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
  <Card className="bg-white/5 border-white/10 p-3 space-y-2">
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
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
            onSaveTyped();
          }
        }}
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
  vpnSpeedOk,
  vpnTest,
  ipvanishApp,
  ipvanishInstalled,
  surfsharkApp,
  surfsharkInstalled,
  onDownloadVpn,
  onLaunchVpn,
  onRunSpeedTest,
  onVpnSpeedOk,
  onVpnTest,
  onTestStreamingApp,
  chosenAppLabel,
  chosenAppAvailable,
  vpnChoice,
  onChooseVpn,
}: {
  vpnSpeedOk: YesNo;
  vpnTest: VpnTest;
  ipvanishApp: AppData;
  ipvanishInstalled: boolean;
  surfsharkApp: AppData;
  surfsharkInstalled: boolean;
  onDownloadVpn: (c: 'ipvanish' | 'surfshark') => void;
  onLaunchVpn: (c: 'ipvanish' | 'surfshark') => void;
  onRunSpeedTest: () => void;
  onVpnSpeedOk: (ok: boolean) => void;
  onVpnTest: (v: VpnTest) => void;
  onTestStreamingApp: () => void;
  chosenAppLabel: string | null;
  chosenAppAvailable: boolean;
  vpnChoice: VpnChoice;
  onChooseVpn: (c: 'ipvanish' | 'surfshark') => void;
}) => {
  const activeChoice: 'ipvanish' | 'surfshark' = vpnChoice ?? 'ipvanish';
  const activeApp = activeChoice === 'ipvanish' ? ipvanishApp : surfsharkApp;
  const activeInstalled = activeChoice === 'ipvanish' ? ipvanishInstalled : surfsharkInstalled;
  const anyInstalled = ipvanishInstalled || surfsharkInstalled;
  return (
    <Card className="bg-white/5 border-white/10 p-3 space-y-3">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white flex items-center justify-center gap-2">
          <ShieldCheck className="w-5 h-5 text-cyan-300" /> VPN test (ISP throttling check)
        </h2>
        <p className="text-sm text-white/70 mt-1 max-w-xl mx-auto">
          A premium VPN bypasses ISP throttling — the #1 cause of buffering during peak hours.
          Pick whichever you prefer below, install it, sign in, and re-test.
        </p>
        <div className="mt-3 bg-amber-500/10 border border-amber-500/40 rounded-md p-3 text-xs text-amber-100 leading-relaxed text-left">
          <strong>Heads up — VPN is a paid service.</strong> Free VPNs don't deliver the speed or
          protection we need. Check with <strong>your reseller</strong> for sign-in details, or sign
          up yourself by scanning the QR code under either option below. Once installed, <strong>sign in</strong>,
          tap <strong>Quick Connect</strong>, then try your channel or movie/show again.
          <span className="block mt-1 text-amber-200/90">Note: VPN does <strong>not</strong> work with VibezTV.</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ChoiceButton dataVpnChoice="ipvanish" active={activeChoice === 'ipvanish'} onClick={() => onChooseVpn('ipvanish')}>
          <ShieldCheck className="w-4 h-4 mr-2 text-cyan-300" /> IPVanish
        </ChoiceButton>
        <ChoiceButton dataVpnChoice="surfshark" active={activeChoice === 'surfshark'} onClick={() => onChooseVpn('surfshark')}>
          <ShieldCheck className="w-4 h-4 mr-2 text-cyan-300" /> Surfshark
        </ChoiceButton>
      </div>


      <VpnSection
        choice={activeChoice}
        vpnApp={activeApp}
        vpnInstalled={activeInstalled}
        onDownloadVpn={() => onDownloadVpn(activeChoice)}
        onLaunchVpn={() => onLaunchVpn(activeChoice)}
      />


      {anyInstalled && (
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
};

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
      <div className="flex items-center gap-3">
        <img src={info.icon} alt="" className="w-10 h-10 rounded-md flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-white">{info.label}</p>
          <p className="text-xs text-white/60 mt-0.5">
            {vpnInstalled ? 'Installed on this device' : 'Not installed yet — tap Install below'}
          </p>
        </div>
      </div>

      {/* Primary action — full width so D-pad lands here first */}
      {vpnInstalled ? (
        <Button
          onClick={onLaunchVpn}
          data-vpn-primary-action={choice}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white"
        >
          <Play className="w-4 h-4 mr-2" /> Open {info.label}
        </Button>
      ) : (
        <Button
          onClick={onDownloadVpn}
          data-vpn-primary-action={choice}
          className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
        >
          <DownloadIcon className="w-4 h-4 mr-2" /> Install {info.label}
        </Button>
      )}

      {vpnInstalled && (
        <div className="bg-green-500/10 border border-green-500/40 rounded-md p-2 text-xs text-green-100 leading-snug">
          <strong>After tapping Open:</strong> sign in, tap <strong>Quick Connect</strong>, then retry your channel.
        </div>
      )}

      <div className="border-t border-white/10 pt-3 space-y-2">
        <p className="text-sm text-white">Need an account? Scan to sign up:</p>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <QrBlock value={info.signupUrl} />
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <a
              href={info.signupUrl}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 text-xs break-all hover:underline inline-flex items-center gap-1"
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
    <div className="bg-white p-1.5 rounded-md flex-shrink-0">
      {dataUrl ? (
        <img src={dataUrl} alt="QR code" className="w-[110px] h-[110px]" />
      ) : (
        <div className="w-[110px] h-[110px] flex items-center justify-center text-slate-500 text-xs">Loading…</div>
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
  <Card className="bg-white/5 border-white/10 p-3 space-y-2">
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

    {/* Full step-by-step recap of what we just walked through */}
    <div className="bg-black/30 border border-white/10 rounded-md p-4">
      <p className="text-sm font-medium text-white mb-2">Steps you completed</p>
      <pre className="text-xs text-white/80 whitespace-pre-wrap font-mono leading-relaxed">
{supportScript}
      </pre>
    </div>

    {chosenApp && chosenAppInstalled && chosenAppLabel && (
      <Button
        onClick={onLaunchApp}
        data-summary-order="1"
        className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white"
      >
        <Play className="w-4 h-4 mr-2" /> Launch {chosenAppLabel} to Test
      </Button>
    )}

    <Button
      onClick={onSubmitTicket}
      disabled={submittingTicket}
      data-summary-order="2"
      className="w-full bg-gradient-to-r from-purple-500 to-blue-600 text-white"
    >
      <MessageSquare className="w-4 h-4 mr-2" />
      {submittingTicket ? 'Submitting…' : 'Submit Ticket to Chat & Community'}
    </Button>

    <div className="flex flex-wrap gap-2">
      <Button onClick={onRestart} data-summary-order="3" variant="outline" className="bg-white/10 border-white/30 text-white hover:bg-white/15">
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
