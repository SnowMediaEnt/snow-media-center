import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, Star, StarOff, Flag, X, RefreshCw, CheckCircle2, Circle, Ban, ArrowUpDown, ArrowUp, ArrowDown, ArrowDownAZ, ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { withAppInfo } from '@/lib/appInfo';
import { isDemo, demoDialogMsg } from '@/lib/demoMode';
import { isOutsideLine } from '@/lib/outsideSource';
import type { XtreamCreds } from '@/lib/xtream';
import type { HealthContext } from '@/lib/deviceHealth';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { CheckView, useDeviceCheck } from './DeviceHealthParts';

/** What the menu is for: a Live TV channel (the default), or a title held
 *  in the line's Movies / Series or in Plex (the title's options: Report a
 *  problem, with reasons that fit a film). */
export type ReportKind = 'channel' | 'movie' | 'series' | 'plex';

interface Props {
  /** The channel's name, or the title's. */
  channelName: string;
  kind?: ReportKind;
  channelId?: number | string;
  categoryName?: string;
  isFavorite?: boolean;
  /** Left out where a channel can't be a favourite from here (Game Day): the row is not shown. */
  onToggleFavorite?: () => void;
  /**
   * Live TV, where recording is offered: a "Record…" row. The caller closes
   * this menu and opens the recording options (RecordDialog).
   */
  onRecord?: () => void;
  /** The channel is recording now: the row says so, and the options offer Stop. */
  recording?: boolean;
  /** The service the channel is on ("Vibez"), when the box has more than one: goes into the ticket. */
  serviceLabel?: string;
  /** The line the channel is on: its username, service and connections go
   *  into the ticket (lib/lineInfo; never its password). Left out: the line in use. */
  line?: XtreamCreds;
  /**
   * Favourite only. Looks the channel up again on the service by name and
   * re-points the favourite at its current stream, for the case where the
   * provider swapped the link behind it. Resolves with what happened so the
   * dialog can say it.
   */
  onRefreshFavorite?: () => Promise<'fixed' | 'same' | 'missing' | 'failed'>;
  onOpenBufferingGuide?: () => void;
  /** Open past the menu with a reason picked (the assistant's report). */
  initialChoice?: Choice;
  initialNote?: string;
  /** "Channel down" was sent: the caller tells the other boxes (⚠️). */
  onReportedDown?: () => void;
  /** "Channel buffering" was sent (Submit a ticket): the caller tells the
   *  other boxes, who are then warned before it plays. */
  onReportedBuffering?: () => void;
  /** The channel shows ⚠️ right now (down, its category down, or buffering) … */
  isDown?: boolean;
  /** … and the viewer says it works: clear it for everyone. */
  onClearDown?: () => void;
  /** Game Day, on a channel found by search: a "Not this game" row. The
   *  caller takes the link off the list; the menu closes. Left out (Live TV,
   *  every other link) the row is not shown. */
  onWrongGame?: () => void;
  /** A Favorites list in the viewer's own order, on a TV: a "Move" row. The
   *  menu closes and the caller lifts the channel to carry it with ▲▼. */
  onMoveFavorite?: () => void;
  /** The same on a touch screen (no ▲▼ to carry it): "Move up" / "Move
   *  down", one place a tap. Each left out at that end of the list. */
  onMoveFavoriteUp?: () => void;
  onMoveFavoriteDown?: () => void;
  /** A Favorites list: how it is sorted now. The row offers the other way
   *  ("Sort A–Z" / "Sort my way"); left out, no row. */
  favoritesSort?: 'mine' | 'az';
  onToggleFavoritesSort?: () => void;
  onClose: () => void;
}

// The choices are values the ticket text and the logic use, so they stay English;
// the buttons show t(CHOICE_KEY[choice]).
type Choice = 'Channel down' | 'Channel buffering' | 'No audio' | 'Other'
  | "Won't play" | 'Buffering' | 'Wrong title or no subtitles';
const CHOICES: Choice[] = ['Channel down', 'Channel buffering', 'No audio', 'Other'];
// A film, a show or a Plex title: what goes wrong with one of those.
const TITLE_CHOICES: Choice[] = ["Won't play", 'Buffering', 'No audio', 'Wrong title or no subtitles', 'Other'];
const CHOICE_KEY: Record<Choice, string> = {
  'Channel down': 'live.report.choiceDown',
  'Channel buffering': 'live.report.choiceBuffering',
  'No audio': 'live.report.choiceNoAudio',
  'Other': 'live.report.choiceOther',
  "Won't play": 'live.report.vod.choiceWontPlay',
  'Buffering': 'live.report.vod.choiceBuffering',
  'Wrong title or no subtitles': 'live.report.vod.choiceWrongTitle',
};
// The ticket's words for each kind (English: the ticket is for the staff).
const KIND_WORD: Record<ReportKind, string> = { channel: 'Channel', movie: 'Movie', series: 'Series', plex: 'Plex' };

// Buffering is the one reason with two answers: most of the time the guide
// fixes it on the spot, and when it does not, the report still has to reach
// us. Both are offered; neither is assumed.
const BUFFERING_OPTIONS = ['live.report.openGuide', 'live.report.submitTicket'] as const;

type Step = 'menu' | 'reasons' | 'buffering' | 'other' | 'checking' | 'checkDone';

// Device Health: the report's 30-second check (lib/deviceCheck) is about this kind.
const CHECK_CONTEXT: Record<ReportKind, HealthContext> = { channel: 'live', movie: 'vod', series: 'series', plex: 'plex' };

/** The How-to guide's hooks on the menu rows (data-howto; literals, so its check finds them). */
const MENU_HOWTO: Record<string, string> = { report: 'menu.report', fav: 'menu.favorite', record: 'menu.record' };

/**
 * D-pad / focus-trapped dialog: Channel Options → Report → reason → submit.
 * Owns its own keyboard while mounted.
 */
const ReportChannelDialog = memo(({
  channelName,
  kind = 'channel',
  channelId,
  categoryName,
  isFavorite,
  onToggleFavorite,
  onRecord,
  recording = false,
  serviceLabel,
  line,
  onRefreshFavorite,
  onOpenBufferingGuide,
  initialChoice,
  initialNote,
  onReportedDown,
  onReportedBuffering,
  isDown = false,
  onClearDown,
  onWrongGame,
  onMoveFavorite,
  onMoveFavoriteUp,
  onMoveFavoriteDown,
  favoritesSort,
  onToggleFavoritesSort,
  onClose,
}: Props) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isTitle = kind !== 'channel';
  const choices = isTitle ? TITLE_CHOICES : CHOICES;
  // A channel on a service added from elsewhere (lib/outsideSource): not ours
  // to fix, and nothing about it goes to our servers. No report, no "It's
  // working now"; a line says who to ask instead.
  const outside = isOutsideLine(line);
  const [refreshing, setRefreshing] = useState(false);
  const canRefresh = !!isFavorite && !!onRefreshFavorite;
  const refreshNow = useCallback(async () => {
    if (!onRefreshFavorite || refreshing) return;
    setRefreshing(true);
    try {
      const r = await onRefreshFavorite();
      toast(r === 'fixed'
        ? { title: t('live.report.refreshedTitle'), description: t('live.report.refreshedDesc') }
        : r === 'same'
          ? { title: t('live.report.alreadyCurrentTitle'), description: t('live.report.alreadyCurrentDesc') }
          : r === 'missing'
            ? { title: t('live.report.missingTitle'), description: t('live.report.missingDesc') }
            : { title: t('live.report.refreshFailedTitle'), description: t('live.report.refreshFailedDesc') });
    } finally {
      setRefreshing(false);
      onClose();
    }
  }, [onRefreshFavorite, refreshing, toast, onClose, t]);
  const { user } = useAuth();
  const { account } = usePlayerAccount();
  const { createTicket } = useSupportTickets(user);

  const [step, setStep] = useState<Step>(outside ? 'menu' : initialChoice === 'Other' ? 'other' : initialChoice ? 'reasons' : 'menu');
  const openedOnReasons = !outside && !!initialChoice && initialChoice !== 'Other';
  const atStep = (s: Step) => step === s;
  // Focus index:
  //   menu:   the row in menuItems, top to bottom
  //   reasons: 0..3 = CHOICES, 4 = Cancel
  //   other:  0 = textarea, 1 = Submit, 2 = Cancel
  const [focusIdx, setFocusIdx] = useState(outside ? 0 : initialChoice && initialChoice !== 'Other' ? Math.max(0, choices.indexOf(initialChoice)) : initialChoice === 'Other' ? 1 : 0);
  const [note, setNote] = useState(initialNote ?? '');
  const [submitting, setSubmitting] = useState(false);
  // "Run a 30-second check and send it with your report" (Device Health):
  // on by default, a row on the reasons to switch it off. Never for an
  // outside service's channel or in the demo.
  // Only where the native player is (the check reads it).
  const checkOffered = !outside && !isDemo() && hasNativePlayer();
  const [withCheck, setWithCheck] = useState(true);
  const check = useDeviceCheck();
  const checkRef = useRef(check);
  checkRef.current = check;

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const submittedRef = useRef(false);
  // Guard the opening long-press: ignore Enter/Space from key-repeat, and
  // don't accept any activation until the user RELEASES the button once.
  const armedRef = useRef(false);

  // The ticket text below is for the support staff, so it stays in English.
  const buildMessage = useCallback(
    (choice: Choice, otherNote: string, checkId: string | null = null) => {
      const trimmedNote = otherNote.trim();
      const issue = choice === 'Other'
        ? (trimmedNote || 'Other')
        : (trimmedNote ? `${choice} — ${trimmedNote}` : choice);
      const word = KIND_WORD[kind];
      const lines = [
        ...(isTitle ? [`Type: ${word}`] : []),
        `Category: ${categoryName || 'Unknown'}`,
        isTitle ? `Title: ${channelName}` : `Channel Name: ${channelName}`,
        `Issue: ${issue}`,
        '',
      ];
      if (serviceLabel) lines.push(`Service: ${serviceLabel}`);
      if (channelId != null && String(channelId).length) lines.push(`${isTitle ? `${word} ID` : 'Channel ID'}: ${channelId}`);
      if (account) {
        lines.push(`Player account: ${account.username}${account.serverLabel ? ' @ ' + account.serverLabel : ''}`);
      }
      lines.push('Reported from the player.');
      // Device Health: support opens the box's 30-second check by this id.
      if (checkId) lines.push(`Device check: ${checkId}`);
      return lines.join('\n');
    },
    [channelId, channelName, categoryName, account, serviceLabel, kind, isTitle],
  );

  // The Channel Options rows. "It's working now" leads when the channel
  // showed ⚠️ as the dialog opened: anyone watching it can clear it for
  // everyone. Taken once: the live flag changes under the open dialog (a
  // refresh, a box that played it fine), and a row appearing or vanishing
  // would move the highlight onto a different row than the viewer picked.
  const [downAtOpen] = useState(isDown);
  const menuItems: Array<{ id: string; label: string; icon: typeof Flag; run: () => void }> = [
    ...(downAtOpen && onClearDown && !outside ? [{
      id: 'clear',
      label: t('live.report.clearWarning'),
      icon: CheckCircle2,
      run: () => {
        onClearDown();
        try { trackEvent('report_clear', 'player', { target: 'channel', channel: channelName }); } catch { void 0; }
        toast({ title: t('live.report.thanksTitle'), description: t('live.report.thanksDesc') });
        onClose();
      },
    }] : []),
    ...(outside ? [] : [{ id: 'report', label: isTitle ? t('live.report.vod.reportProblem') : t('live.report.reportChannel'), icon: Flag, run: () => { setStep('reasons'); setFocusIdx(0); } }]),
    ...(onWrongGame ? [{ id: 'wrong', label: t('live.report.wrongGame'), icon: Ban, run: () => { onWrongGame(); onClose(); } }] : []),
    ...(onToggleFavorite ? [{ id: 'fav', label: isFavorite ? t('live.report.removeFavorite') : t('live.report.addFavorite'), icon: isFavorite ? StarOff : Star, run: () => { onToggleFavorite(); onClose(); } }] : []),
    // A Favorites list: put the channel somewhere else in it, or sort it.
    ...(onMoveFavorite ? [{ id: 'move', label: t('live.report.moveFavorite'), icon: ArrowUpDown, run: () => { onMoveFavorite(); onClose(); } }] : []),
    ...(onMoveFavoriteUp ? [{ id: 'moveUp', label: t('live.report.moveFavoriteUp'), icon: ArrowUp, run: () => { onMoveFavoriteUp(); onClose(); } }] : []),
    ...(onMoveFavoriteDown ? [{ id: 'moveDown', label: t('live.report.moveFavoriteDown'), icon: ArrowDown, run: () => { onMoveFavoriteDown(); onClose(); } }] : []),
    ...(favoritesSort && onToggleFavoritesSort ? [{
      id: 'sort',
      label: favoritesSort === 'az' ? t('live.report.sortMine') : t('live.report.sortAz'),
      icon: favoritesSort === 'az' ? ListOrdered : ArrowDownAZ,
      run: () => { onToggleFavoritesSort(); onClose(); },
    }] : []),
    ...(onRecord ? [{ id: 'record', label: recording ? t('live.report.stopRecording') : t('live.report.recordChannel'), icon: Circle, run: () => { onRecord(); } }] : []),
    ...(canRefresh ? [{ id: 'refresh', label: refreshing ? t('live.report.refreshing') : t('live.report.refreshLink'), icon: RefreshCw, run: () => { void refreshNow(); } }] : []),
    { id: 'cancel', label: t('common.cancel'), icon: X, run: onClose },
  ];
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;
  // A long menu (a favourite with Move and Sort, a channel showing ⚠️, Record
  // and Refresh) is drawn tighter and without the footer, so every row still
  // fits the 540px TV screen.
  // Slim rows on a long menu, and on a film's or Plex title's short one (no bulky cards).
  const dense = menuItems.length > 6 || isTitle;

  const submit = useCallback(
    async (choice: Choice, otherNote = '') => {
      if (submittedRef.current || submitting) return;
      // Never for an outside service's channel (the menu offers no report).
      if (outside) { onClose(); return; }
      submittedRef.current = true;
      setSubmitting(true);
      try {
        // Demo mode: acknowledge, but never file a real report/ticket.
        if (isDemo()) {
          toast({ title: t('live.toast.liveDemoTitle'), description: demoDialogMsg() });
          onClose();
          return;
        }
        // The 30-second check first, when it is on: its id goes in the ticket.
        // Back during it stops it and the report goes without.
        let checkId: string | null = null;
        let checked = false;
        if (checkOffered && withCheck) {
          setStep('checking');
          const res = await checkRef.current.start({
            channel: kind === 'channel' && channelId != null ? { line: line ?? null, streamId: channelId, name: channelName } : null,
            context: CHECK_CONTEXT[kind],
            title: channelName,
          });
          checked = !!res;
          checkId = res?.id ?? null;
        }
        if (choice === 'Channel down') { try { onReportedDown?.(); } catch { /* ignore */ } }
        if (choice === 'Channel buffering') { try { onReportedBuffering?.(); } catch { /* ignore */ } }
        if (choice === 'Channel down' || choice === 'Channel buffering') {
          try { trackEvent('channel_report', 'player', { reason: choice === 'Channel down' ? 'down' : 'buffering', channel: channelName, service: serviceLabel ?? null }); } catch { void 0; }
        }
        const subject = `${KIND_WORD[kind]} issue: ${channelName}`;
        // App version, build and device lead the message; the report's own fields follow as they were.
        const message = await withAppInfo(buildMessage(choice, otherNote, checkId), line ? { lines: [line] } : {});
        if (user) {
          await createTicket(subject, message, { discordKind: 'channel_report' });
        } else {
          const { error } = await supabase.functions.invoke('report-channel', {
            body: {
              subject: `[Channel Report] ${subject}`,
              message,
            },
          });
          if (error) throw error;
        }
        try { trackEvent('ticket_create', 'support', { source: 'player_report', has_user: !!user }); } catch { void 0; }
        toast({ title: t('live.report.sentTitle') });
        // The check's verdict stays up until OK.
        if (checked) { setStep('checkDone'); setFocusIdx(0); setSubmitting(false); return; }
        onClose();
      } catch (e) {
        submittedRef.current = false;
        setSubmitting(false);
        setStep((st) => (st === 'checking' || st === 'checkDone' ? 'reasons' : st));
        toast({
          title: t('live.report.failedTitle'),
          description: (e as Error)?.message || t('live.report.failedDesc'),
          variant: 'destructive',
        });
      }
    },
    [createTicket, buildMessage, channelName, channelId, kind, line, onClose, onReportedDown, onReportedBuffering, outside, serviceLabel, submitting, toast, user, t, checkOffered, withCheck],
  );

  const onPick = useCallback(
    (choice: Choice) => {
      if (choice === 'Channel buffering' && !isTitle) {
        setStep('buffering');
        setFocusIdx(0);
        return;
      }
      if (choice === 'Other') {
        setStep('other');
        setFocusIdx(0);
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      void submit(choice);
    },
    [submit, isTitle],
  );

  // Owns the keyboard while open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      // The check under way: Back stops it (the report goes on without it).
      if (step === 'checking') {
        e.preventDefault(); e.stopPropagation();
        if (isBack) checkRef.current.cancel();
        return;
      }
      if (step === 'checkDone') {
        e.preventDefault(); e.stopPropagation();
        if (isBack || ((e.key === 'Enter' || e.key === ' ') && !e.repeat)) onClose();
        return;
      }
      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        if (step === 'other' && !submitting) {
          setStep('reasons');
          setFocusIdx(choices.length); // land on Cancel of reasons
          setNote('');
          return;
        }
        if (step === 'buffering' && !submitting) {
          setStep('reasons');
          setFocusIdx(CHOICES.indexOf('Channel buffering'));
          return;
        }
        // Opened straight on the reasons (a preset: Plex's hold menu, Live
        // TV's "Report it"): the menu was never seen, so Back closes.
        if (step === 'reasons' && !submitting && !openedOnReasons) {
          // Back to the row this came from.
          setStep('menu');
          setFocusIdx(Math.max(0, menuItemsRef.current.findIndex((m) => m.id === 'report')));
          return;
        }
        onClose();
        return;
      }

      // Ignore Enter/Space from the opening hold (repeat) or before first release.
      if ((e.key === 'Enter' || e.key === ' ') && (e.repeat || !armedRef.current)) {
        e.preventDefault(); e.stopPropagation();
        return;
      }


      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // MENU (menuItemsRef: the rows on screen, top to bottom)
      if (step === 'menu') {
        const items = menuItemsRef.current;
        const count = items.length;
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i + 1) % count);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i - 1 + count) % count);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          items[focusIdx]?.run();
          return;
        }
        e.stopPropagation();
        return;
      }

      // BUFFERING: guide, ticket, or back to the reasons
      if (step === 'buffering') {
        const count = BUFFERING_OPTIONS.length + 1;
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i + 1) % count);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i - 1 + count) % count);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          if (focusIdx === 0) onOpenBufferingGuide?.();
          else if (focusIdx === 1) void submit('Channel buffering');
          else { setStep('reasons'); setFocusIdx(CHOICES.indexOf('Channel buffering')); }
          return;
        }
        e.stopPropagation();
        return;
      }

      // REASONS
      if (step === 'reasons') {
        // The choices, the check row (when offered), Cancel.
        const checkIdx = checkOffered ? choices.length : -1;
        const count = choices.length + (checkOffered ? 2 : 1);
        if (e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i + 1) % count);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          setFocusIdx(i => (i - 1 + count) % count);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          if (focusIdx < choices.length) onPick(choices[focusIdx]);
          else if (focusIdx === checkIdx) setWithCheck((v) => !v);
          else onClose();
          return;
        }
        e.stopPropagation();
        return;
      }

      // OTHER (free text)
      if (e.key === 'ArrowDown' && !typing) {
        e.preventDefault(); e.stopPropagation();
        setFocusIdx(i => Math.min(2, i + 1));
        return;
      }
      if (e.key === 'ArrowUp' && !typing) {
        e.preventDefault(); e.stopPropagation();
        setFocusIdx(i => Math.max(0, i - 1));
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && !typing) {
        e.preventDefault(); e.stopPropagation();
        if (focusIdx === 0) {
          inputRef.current?.focus();
        } else if (focusIdx === 1) {
          void submit('Other', note);
        } else if (focusIdx === 2) {
          onClose();
        }
        return;
      }
      if (typing) e.stopPropagation();
    };
    const onKeyUp = () => { armedRef.current = true; };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [step, focusIdx, note, onPick, onClose, submit, submitting, onToggleFavorite, onOpenBufferingGuide, canRefresh, refreshNow, choices, checkOffered]);

  // Auto-blur textarea so D-pad navigation works again
  useEffect(() => {
    if (step === 'other' && focusIdx !== 0) inputRef.current?.blur();
  }, [step, focusIdx]);

  const title =
    step === 'menu' ? (isTitle ? t('live.report.vod.menuTitle') : t('live.report.menuTitle'))
    : step === 'reasons' ? t('live.report.reasonsTitle')
    : step === 'buffering' ? t('live.report.bufferingTitle')
    : step === 'checking' || step === 'checkDone' ? t('deviceHealth.check.title')
    : t('live.report.otherTitle');

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-[92vw] max-w-[520px] rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] ${isTitle ? 'p-4' : 'p-6'} text-white`}
      >
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-6 h-6 text-brand-gold flex-shrink-0" />
          <h2 className="font-quicksand font-bold text-xl truncate">
            {title} — <span className="text-brand-gold">{channelName}</span>
          </h2>
        </div>

        {atStep('menu') && (
          <div className="space-y-2">
            {outside && (
              <p data-outside-note="" className="text-sm text-brand-ice/80 font-nunito mb-1">{t('liveAccount.outside.reportNote')}</p>
            )}
            {menuItems.map((item, i, all) => {
              const focused = focusIdx === i;
              const Icon = item.icon;
              const isCancel = i === all.length - 1;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-focused={focused ? 'true' : 'false'}
                  data-howto={MENU_HOWTO[item.id]}
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => item.run()}
                  className={`tv-ring w-full text-left px-4 ${dense ? 'py-2' : 'py-3'} rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center gap-3 ${
                    focused
                      ? (isCancel
                          ? 'bg-white/15 scale-[1.02] z-10'
                          : 'bg-brand-gold/25 scale-[1.02] z-10')
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-5 h-5 text-brand-gold flex-shrink-0" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {atStep('reasons') && (
          <div className="space-y-2" data-howto="report.reasons">
            {choices.map((c, i) => {
              const focused = focusIdx === i;
              return (
                <button
                  key={c}
                  type="button"
                  data-focused={focused ? 'true' : 'false'}
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => onPick(c)}
                  disabled={submitting}
                  className={`tv-ring w-full text-left px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out ${
                    focused
                      ? 'bg-brand-gold/25 scale-[1.02] z-10'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {t(CHOICE_KEY[c])}
                </button>
              );
            })}

            {checkOffered && (
              <button
                type="button"
                data-check-toggle={withCheck ? 'on' : 'off'}
                data-focused={focusIdx === choices.length ? 'true' : 'false'}
                onMouseEnter={() => setFocusIdx(choices.length)}
                onClick={() => setWithCheck((v) => !v)}
                disabled={submitting}
                className={`tv-ring w-full text-left px-4 h-10 rounded-xl border border-white/10 font-nunito text-sm transition-transform duration-150 ease-out flex items-center ${
                  focusIdx === choices.length ? 'bg-brand-gold/25 scale-[1.02] z-10' : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {withCheck ? <CheckCircle2 className="w-4 h-4 mr-2 text-brand-gold flex-shrink-0" /> : <Circle className="w-4 h-4 mr-2 text-brand-ice/60 flex-shrink-0" />}
                <span className="min-w-0 truncate">{t('deviceHealth.check.withReport')}</span>
              </button>
            )}

            <button
              type="button"
              data-focused={focusIdx === choices.length + (checkOffered ? 1 : 0) ? 'true' : 'false'}
              onMouseEnter={() => setFocusIdx(choices.length + (checkOffered ? 1 : 0))}
              onClick={onClose}
              disabled={submitting}
              className={`tv-ring w-full px-4 py-3 rounded-xl border border-white/10 font-nunito transition-transform duration-150 ease-out ${
                focusIdx === choices.length + (checkOffered ? 1 : 0)
                  ? 'bg-white/15 scale-[1.02] z-10'
                  : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {atStep('buffering') && (
          <div className="space-y-2">
            <p className="text-sm text-brand-ice/80 font-nunito mb-3">
              {t('live.report.bufferingBody')}
              {onReportedBuffering && <> {t('live.report.bufferingWarnNote')}</>}
            </p>
            {BUFFERING_OPTIONS.map((labelKey, i) => {
              const focused = focusIdx === i;
              return (
                <button
                  key={labelKey}
                  type="button"
                  data-focused={focused ? 'true' : 'false'}
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => { if (i === 0) onOpenBufferingGuide?.(); else void submit('Channel buffering'); }}
                  disabled={submitting}
                  className={`tv-ring w-full text-left px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center gap-2 ${
                    focused
                      ? 'bg-brand-gold/25 scale-[1.02] z-10'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {i === 1 && submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t(labelKey)}
                </button>
              );
            })}
            <button
              type="button"
              data-focused={focusIdx === BUFFERING_OPTIONS.length ? 'true' : 'false'}
              onMouseEnter={() => setFocusIdx(BUFFERING_OPTIONS.length)}
              onClick={() => { setStep('reasons'); setFocusIdx(CHOICES.indexOf('Channel buffering')); }}
              disabled={submitting}
              className={`tv-ring w-full px-4 py-3 rounded-xl border border-white/10 font-nunito transition-transform duration-150 ease-out ${
                focusIdx === BUFFERING_OPTIONS.length
                  ? 'bg-white/15 scale-[1.02] z-10'
                  : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              {t('common.back')}
            </button>
          </div>
        )}

        {atStep('other') && (
          <div className="space-y-3">
            <label className="block text-sm text-brand-ice/80 font-nunito">
              {t('live.report.describeLabel')}
            </label>
            <textarea
              ref={inputRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t('live.report.placeholder')}
              data-focused={focusIdx === 0 ? 'true' : 'false'}
              onFocus={() => setFocusIdx(0)}
              className="tv-ring w-full rounded-xl bg-black/40 text-white border border-white/20 px-3 py-2 font-nunito text-sm resize-none focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-focused={focusIdx === 1 ? 'true' : 'false'}
                onMouseEnter={() => setFocusIdx(1)}
                onClick={() => void submit('Other', note)}
                disabled={submitting}
                className={`tv-ring tv-ring-contrast flex-1 px-4 py-3 rounded-xl border border-brand-gold/40 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center justify-center gap-2 ${
                  focusIdx === 1
                    ? 'bg-brand-gold/30 scale-[1.02] z-10'
                    : 'bg-brand-gold/15'
                }`}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('live.report.sendBtn')}
              </button>
              <button
                type="button"
                data-focused={focusIdx === 2 ? 'true' : 'false'}
                onMouseEnter={() => setFocusIdx(2)}
                onClick={onClose}
                disabled={submitting}
                className={`tv-ring px-4 py-3 rounded-xl border border-white/10 font-nunito transition-transform duration-150 ease-out ${
                  focusIdx === 2
                    ? 'bg-white/15 scale-105 z-10'
                    : 'bg-white/5'
                }`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {(atStep('checking') || atStep('checkDone')) && (
          <div className="space-y-2" data-report-check="">
            <CheckView progress={check.progress} result={check.result} unavailable={check.unavailable} />
            {atStep('checking') && <p className="text-xs text-brand-ice/60 font-nunito">{t('deviceHealth.check.backToSkip')}</p>}
            {atStep('checkDone') && (
              <button
                type="button"
                data-focused="true"
                onClick={onClose}
                className="tv-ring w-full h-10 px-4 rounded-xl border border-brand-gold/40 bg-brand-gold/25 font-nunito font-semibold"
              >
                {t('common.ok')}
              </button>
            )}
          </div>
        )}

        {!(dense && atStep('menu')) && (
          <p className="mt-4 text-xs text-brand-ice/60 font-nunito">
            {isTitle ? t('live.report.vod.footer') : t('live.report.footer')}
          </p>
        )}
      </div>
    </div>
  );
});

ReportChannelDialog.displayName = 'ReportChannelDialog';
export default ReportChannelDialog;
