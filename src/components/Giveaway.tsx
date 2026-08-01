// Giveaway — in-app entry point for the SMC giveaway system (Phase 1 UI).
//
// Data sources (all real, no placeholders):
//   - Public prize/winners: giveaway-bridge edge function, action 'summary'
//     (public by design — the same payload the marketing website renders).
//   - Signed-in entry counts: giveaway_my_summary RPC (auth-scoped).
//   - Facebook claim: giveaway_claim_facebook RPC (auth + giveaway active,
//     deduped server-side, lands as 'pending' for admin review).
//
// Demo mode (?demo=1 / forced demo hosts): renders nothing — the section is
// unreachable in the embedded website demo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Gift,
  Trophy,
  Ticket,
  Facebook,
  Loader2,
  LogIn,
  CheckCircle2,
  Clock,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { isDemo } from '@/lib/demoMode';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';

interface GiveawayInfo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  prize_description: string | null;
  prize_image_url: string | null;
  winner_count: number;
  included_service_description: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string;
  rules_md: string | null;
  announcement_md: string | null;
}

interface MyEntry {
  entry_type: string;
  entry_count: number;
  status: string;
  source_reference: string | null;
  created_at: string;
}

interface PublicWinner {
  position: number;
  public_display_name: string;
  drawn_at: string;
}

interface MySummary {
  giveaway: unknown;
  my_total_valid?: number;
  my_entries?: MyEntry[];
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  account_creation: 'New account bonus',
  renewal: 'Service renewal',
  device_purchase: 'Device purchase',
  facebook_review: 'Facebook review',
};

const entryTypeLabel = (t: string) => ENTRY_TYPE_LABELS[t] ?? t.replace(/_/g, ' ');

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  try {
    return format(new Date(iso), 'MMM d, yyyy');
  } catch {
    return null;
  }
};

const Giveaway = ({ onBack }: { onBack: () => void }) => {
  const demo = isDemo();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [giveaway, setGiveaway] = useState<GiveawayInfo | null>(null);
  const [winners, setWinners] = useState<PublicWinner[]>([]);
  const [myTotal, setMyTotal] = useState(0);
  const [myEntries, setMyEntries] = useState<MyEntry[]>([]);

  const [fbName, setFbName] = useState('');
  const [reviewUrl, setReviewUrl] = useState('');
  const [claiming, setClaiming] = useState(false);

  const [focusIndex, setFocusIndex] = useState(0);
  const fbNameRef = useRef<HTMLInputElement>(null);
  const reviewUrlRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.functions.invoke('giveaway-bridge', {
        body: { action: 'summary' },
      });
      if (error) throw error;
      setGiveaway((data?.giveaway as GiveawayInfo | null) ?? null);
      setWinners((data?.winners as PublicWinner[] | null) ?? []);

      if (user) {
        const { data: mine, error: myErr } = await supabase.rpc('giveaway_my_summary');
        if (!myErr && mine) {
          const summary = mine as MySummary;
          setMyTotal(Number(summary.my_total_valid) || 0);
          setMyEntries(Array.isArray(summary.my_entries) ? summary.my_entries : []);
        }
      } else {
        setMyTotal(0);
        setMyEntries([]);
      }
    } catch (e) {
      console.warn('[Giveaway] load failed:', e);
      setLoadError('Could not load the giveaway right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!demo) void load();
  }, [demo, load]);

  const alreadyClaimed = useMemo(
    () => myEntries.some((e) => e.entry_type === 'facebook_review'),
    [myEntries],
  );
  const isActive = giveaway?.status === 'active';

  // Focus chain: 0 = back. Signed-out with a giveaway: 1 = sign-in CTA.
  // Signed-in + active + not yet claimed: 1 = FB name, 2 = review URL, 3 = submit.
  const claimOpen = !!user && isActive && !alreadyClaimed;
  const signInSlot = !user && !!giveaway;
  const totalFocusable = 1 + (claimOpen ? 3 : signInSlot ? 1 : 0);

  const submitClaim = useCallback(async () => {
    if (!giveaway || claiming) return;
    if (!fbName.trim()) {
      toast({
        title: 'Facebook name needed',
        description: 'Enter the Facebook name you left the review with.',
        variant: 'destructive',
      });
      return;
    }
    setClaiming(true);
    try {
      const { data, error } = await supabase.rpc('giveaway_claim_facebook', {
        p_giveaway_id: giveaway.id,
        p_fb_name: fbName.trim(),
        p_review_url: reviewUrl.trim(),
      });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string } | null;
      if (res?.ok) {
        toast({
          title: 'Entry submitted',
          description: 'Your Facebook review is pending review — entries are added once approved.',
        });
        setFbName('');
        setReviewUrl('');
        void load();
      } else if (res?.error === 'already_claimed') {
        toast({ title: 'Already claimed', description: 'You already submitted a Facebook review for this giveaway.' });
      } else if (res?.error === 'giveaway_not_active') {
        toast({ title: 'Giveaway closed', description: 'This giveaway is no longer accepting entries.', variant: 'destructive' });
      } else {
        toast({ title: 'Could not submit', description: 'Please try again in a moment.', variant: 'destructive' });
      }
    } catch (e) {
      console.warn('[Giveaway] claim failed:', e);
      toast({ title: 'Could not submit', description: 'Please try again in a moment.', variant: 'destructive' });
    } finally {
      setClaiming(false);
    }
  }, [giveaway, claiming, fbName, reviewUrl, toast, load]);

  // D-pad navigation (Games.tsx index pattern; Back is owned by Index.tsx).
  useEffect(() => {
    if (demo) return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if (typing) {
        // TV remote leaves the on-screen keyboard: arrows move focus back to
        // the form chain (blur on Down per D-pad input flow convention).
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          void hideKeyboardForDpad(target as HTMLInputElement);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          void hideKeyboardForDpad(target as HTMLInputElement);
        }
        return;
      }

      if (e.key === 'Enter' || e.key === ' ') {
        if (focusIndex === 0) {
          onBack();
        } else if (claimOpen && focusIndex === 1) {
          void focusTextInputForDpad(fbNameRef.current);
        } else if (claimOpen && focusIndex === 2) {
          void focusTextInputForDpad(reviewUrlRef.current);
        } else if (claimOpen && focusIndex === 3) {
          void submitClaim();
        } else if (signInSlot && focusIndex === 1) {
          navigate('/auth');
        }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        setFocusIndex((i) => Math.min(totalFocusable - 1, i + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        setFocusIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [demo, focusIndex, claimOpen, signInSlot, totalFocusable, onBack, navigate, submitClaim]);

  // Keep the focused control inside the visible area (nearest — never 'center').
  useEffect(() => {
    if (demo) return;
    const el = document.querySelector<HTMLElement>(`[data-giveaway-focus="${focusIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [demo, focusIndex]);

  if (demo) return null;

  const focusCls = (idx: number) =>
    focusIndex === idx ? 'ring-4 ring-white/60 scale-[1.03]' : '';

  const statusChip = (() => {
    if (!giveaway) return null;
    switch (giveaway.status) {
      case 'active':
        return <span className="rounded-full bg-emerald-500/20 border border-emerald-400/50 px-3 py-1 text-emerald-200 text-sm font-semibold">Active now</span>;
      case 'paused':
        return <span className="rounded-full bg-amber-500/20 border border-amber-400/50 px-3 py-1 text-amber-200 text-sm font-semibold">Paused</span>;
      case 'ended':
        return <span className="rounded-full bg-slate-500/20 border border-slate-400/50 px-3 py-1 text-slate-200 text-sm font-semibold">Ended — drawing soon</span>;
      case 'drawn':
      case 'announced':
        return <span className="rounded-full bg-yellow-500/20 border border-yellow-400/50 px-3 py-1 text-yellow-200 text-sm font-semibold">Winners drawn</span>;
      default:
        return null;
    }
  })();

  const startLabel = fmtDate(giveaway?.start_at);
  const endLabel = fmtDate(giveaway?.end_at);

  return (
    <div className="tv-scroll-container tv-safe bg-neutral-900 text-white h-dvh overflow-y-auto overscroll-contain">
      <div className="max-w-4xl mx-auto pb-24">
        {/* Header */}
        <div className="flex items-center mb-6">
          <Button
            onClick={onBack}
            variant="gold"
            size="lg"
            data-giveaway-focus={0}
            className={`transition-all duration-200 ${focusCls(0)}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-10 h-10 animate-spin text-amber-300" />
          </div>
        ) : loadError ? (
          <Card className="bg-slate-800/60 border-slate-600 p-8 text-center">
            <p className="text-lg text-slate-200 mb-4">{loadError}</p>
            <Button onClick={() => void load()} variant="outline" className="bg-blue-600/20 border-blue-500/50 text-white hover:bg-blue-600/30">
              Retry
            </Button>
          </Card>
        ) : !giveaway ? (
          <Card className="bg-slate-800/60 border-slate-600 p-8 text-center">
            <Gift className="w-12 h-12 mx-auto mb-4 text-slate-400" />
            <h2 className="text-2xl font-bold mb-2">No giveaway right now</h2>
            <p className="text-slate-300">Check back soon — new giveaways are announced on the home screen.</p>
          </Card>
        ) : (
          <>
            {/* Prize hero */}
            <Card className="bg-gradient-to-br from-amber-600/30 to-yellow-900/30 border-amber-500/40 p-6 mb-6">
              <div className="flex flex-col md:flex-row gap-6 items-center">
                {giveaway.prize_image_url && (
                  <img
                    src={giveaway.prize_image_url}
                    alt={giveaway.prize_description || giveaway.name}
                    loading="lazy"
                    className="w-40 h-40 object-contain rounded-xl bg-black/30 flex-shrink-0"
                    draggable={false}
                  />
                )}
                <div className="flex-1 text-center md:text-left">
                  <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                    <Gift className="w-7 h-7 text-amber-300" />
                    <h1 className="text-3xl font-bold">{giveaway.name}</h1>
                  </div>
                  <div className="mb-3">{statusChip}</div>
                  {giveaway.prize_description && (
                    <p className="text-xl text-amber-100 font-semibold mb-1">{giveaway.prize_description}</p>
                  )}
                  {giveaway.included_service_description && (
                    <p className="text-amber-200/90 mb-2">{giveaway.included_service_description}</p>
                  )}
                  {(startLabel || endLabel) && (
                    <p className="text-slate-300 text-sm">
                      {startLabel && `Starts ${startLabel}`}
                      {startLabel && endLabel && ' · '}
                      {endLabel && `Ends ${endLabel}`}
                      {giveaway.winner_count > 0 && ` · ${giveaway.winner_count} winner${giveaway.winner_count === 1 ? '' : 's'}`}
                    </p>
                  )}
                </div>
              </div>
            </Card>

            {/* My entries (signed in) */}
            {user && (
              <Card className="bg-slate-800/60 border-slate-600 p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Ticket className="w-6 h-6 text-blue-300" />
                  <h2 className="text-2xl font-bold">Your entries</h2>
                  <span className="ml-auto text-3xl font-bold text-amber-300">{myTotal}</span>
                </div>
                {myEntries.length === 0 ? (
                  <p className="text-slate-300">
                    No entries yet. Renew a service, buy a device, or claim the Facebook review bonus below.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {myEntries.map((e, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-lg bg-black/20 border border-white/5 px-4 py-2">
                        {e.status === 'valid' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                        ) : e.status === 'pending' ? (
                          <Clock className="w-5 h-5 text-amber-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                        )}
                        <span className="font-medium">{entryTypeLabel(e.entry_type)}</span>
                        {e.source_reference && (
                          <span className="text-slate-400 text-sm truncate">{e.source_reference}</span>
                        )}
                        <span className="ml-auto font-bold">
                          {e.status === 'pending' ? 'Pending' : e.status === 'valid' ? `+${e.entry_count}` : 'Void'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {/* Facebook review claim */}
            {claimOpen && (
              <Card className="bg-slate-800/60 border-slate-600 p-6 mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <Facebook className="w-6 h-6 text-blue-400" />
                  <h2 className="text-2xl font-bold">Facebook review bonus</h2>
                </div>
                <p className="text-slate-300 mb-4">
                  Left us a review on Facebook? Claim your bonus entry — it appears once an admin approves it.
                </p>
                <div className="space-y-3">
                  <Input
                    ref={fbNameRef}
                    value={fbName}
                    onChange={(ev) => setFbName(ev.target.value)}
                    placeholder="Your Facebook name"
                    data-giveaway-focus={1}
                    className={`bg-black/30 border-white/20 text-white text-lg transition-all duration-200 ${focusCls(1)}`}
                  />
                  <Input
                    ref={reviewUrlRef}
                    value={reviewUrl}
                    onChange={(ev) => setReviewUrl(ev.target.value)}
                    placeholder="Link to your review (optional)"
                    data-giveaway-focus={2}
                    className={`bg-black/30 border-white/20 text-lg transition-all duration-200 ${focusCls(2)}`}
                  />
                  <Button
                    onClick={() => void submitClaim()}
                    disabled={claiming}
                    size="lg"
                    data-giveaway-focus={3}
                    className={`bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white transition-all duration-200 ${focusCls(3)}`}
                  >
                    {claiming ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Facebook className="w-5 h-5 mr-2" />}
                    Claim bonus entry
                  </Button>
                </div>
              </Card>
            )}

            {/* Signed-out CTA */}
            {signInSlot && (
              <Card className="bg-slate-800/60 border-slate-600 p-6 mb-6 text-center">
                <p className="text-lg text-slate-200 mb-4">Sign in to see your entries and claim bonuses.</p>
                <Button
                  onClick={() => navigate('/auth')}
                  size="lg"
                  data-giveaway-focus={1}
                  className={`bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 ${focusCls(1)}`}
                >
                  <LogIn className="w-5 h-5 mr-2" />
                  Sign In
                </Button>
              </Card>
            )}

            {/* Winners */}
            {winners.length > 0 && (
              <Card className="bg-gradient-to-br from-yellow-600/20 to-amber-900/20 border-yellow-500/40 p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <Trophy className="w-6 h-6 text-yellow-300" />
                  <h2 className="text-2xl font-bold">Winners</h2>
                </div>
                <ul className="space-y-2">
                  {winners.map((w) => (
                    <li key={w.position} className="flex items-center gap-3 rounded-lg bg-black/20 border border-yellow-500/20 px-4 py-2">
                      <span className="text-2xl">{w.position === 1 ? '🥇' : w.position === 2 ? '🥈' : w.position === 3 ? '🥉' : '🏅'}</span>
                      <span className="font-semibold text-lg">{w.public_display_name}</span>
                    </li>
                  ))}
                </ul>
                {giveaway.announcement_md && (
                  <p className="mt-4 text-yellow-100/90 whitespace-pre-line">{giveaway.announcement_md}</p>
                )}
              </Card>
            )}

            {/* Rules */}
            {giveaway.rules_md && (
              <Card className="bg-slate-800/40 border-slate-700 p-6">
                <h3 className="text-lg font-semibold mb-2 text-slate-200">How to enter</h3>
                <p className="text-slate-300 text-sm whitespace-pre-line">{giveaway.rules_md}</p>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Giveaway;
