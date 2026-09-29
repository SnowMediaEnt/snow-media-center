import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Copy, Eye, EyeOff, KeyRound, Calendar, Loader2, CheckCircle2, Mail } from 'lucide-react';
import { useTVFocus } from '@/hooks/useTVFocus';
import { useToast } from '@/hooks/use-toast';
import type { BillingService } from '@/capacitor/SmcBilling';
import { copyText, formatDateTime, serverLabelForHost } from '@/lib/billing';
import { emailLineCredentials, wasLineEmailed } from '@/lib/lineEmail';
import { BTN, BTN_GOLD, CARD, SCREEN, focusAttrs, scaleIf, useFocusRecovery } from './shared';
import { Spinner } from './SharedUi';

interface Props {
  title: string;
  subtitle?: string;
  note?: string | null;
  service: BillingService;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
  busyLabel?: string;
  /**
   * The billing account's email. When given, the login is mailed there once,
   * automatically — the billing API sends nothing itself, so without this the
   * password exists only on this screen.
   */
  emailTo?: string | null;
}

/**
 * The "here are your login details" sheet shown after a trial is created or a
 * bought line goes active: username, password, expiry, Copy buttons, and the
 * call to action that signs the player in.
 */
const CredentialsSheet = memo(({ title, subtitle, note, service, primaryLabel, onPrimary, secondaryLabel, onSecondary, busy, busyLabel, emailTo }: Props) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showPwd, setShowPwd] = useState(false);
  const c = service.credentials;

  // ── mail them a copy ───────────────────────────────────────────────────
  // Fire-and-forget on purpose: the details are already on screen and already
  // saved to the device, so a failed send must never stand between the viewer
  // and watching. It reports, it does not block.
  const [mail, setMail] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [mailNote, setMailNote] = useState<string | null>(null);
  const autoSentRef = useRef(false);

  const sendEmail = useCallback(async () => {
    if (!c || !emailTo) return;
    setMail('sending');
    setMailNote(null);
    const r = await emailLineCredentials({
      email: emailTo,
      creds: c,
      serverLabel: serverLabelForHost(c.host),
      planName: service.plan?.name ?? null,
      expiresAt: service.expires_at ?? null,
    });
    if (r.ok) { setMail('sent'); return; }
    setMail('failed');
    setMailNote(r.message ?? null);
  }, [c, emailTo, service.plan?.name, service.expires_at]);

  useEffect(() => {
    if (!c || !emailTo || autoSentRef.current) return;
    autoSentRef.current = true;
    if (wasLineEmailed(c)) { setMail('sent'); return; }
    void sendEmail();
  }, [c, emailTo, sendEmail]);

  const { containerRef, currentFocusId, focusById } = useTVFocus({
    initialFocusId: 'cs-primary',
    onBack: () => { if (busy) return; (onSecondary ?? onPrimary)(); },
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'cs-primary');

  const copy = async (kind: 'user' | 'pass', value: string) => {
    const ok = await copyText(value);
    toast(ok
      ? { title: t('billing.creds.copiedTitle'), description: t(kind === 'user' ? 'billing.creds.usernameCopied' : 'billing.creds.passwordCopied') }
      : { title: t('billing.creds.copyUnavailableTitle'), description: t('billing.creds.copyUnavailableDesc'), variant: 'destructive' });
  };

  const rows = c ? [
    { id: 'user' as const, label: t('billing.creds.username'), icon: KeyRound, value: c.username, copy: c.username },
    { id: 'pass' as const, label: t('billing.creds.password'), icon: KeyRound, value: showPwd ? c.password : '•'.repeat(Math.max(8, c.password.length)), copy: c.password },
    // The server address is deliberately NOT shown. The app has already
    // signed the Player in with it, so it is noise on a TV — nobody is going
    // to type it. It stays in the email, where it is what someone needs to
    // set the line up on another device.
  ] : [];

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className={`${CARD} w-full max-w-3xl p-8`}>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-9 h-9 text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-2xl font-quicksand font-bold text-white">{title}</h2>
              {subtitle && <p className="text-brand-ice/80 font-nunito">{subtitle}</p>}
            </div>
          </div>

          {note && (
            <p className="mt-4 rounded-xl bg-amber-500/15 border border-amber-400/40 px-4 py-3 text-amber-100 text-sm font-nunito">{note}</p>
          )}

          <div className="mt-6 space-y-3">
            {rows.map((r) => {
              const Icon = r.icon;
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-xl bg-black/30 border border-white/10 px-4 py-3">
                  <Icon className="w-5 h-5 text-brand-ice shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wide text-white/60">{r.label}</div>
                    <div className="text-lg text-white font-medium font-mono break-all">{r.value}</div>
                  </div>
                  {r.id === 'pass' ? (
                    <Button variant="white" size="sm" onClick={() => setShowPwd((v) => !v)}
                      className={`${BTN} h-10 ${scaleIf(currentFocusId, 'cs-show')}`} {...focusAttrs(currentFocusId, 'cs-show')}>
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  ) : null}
                  <Button variant="white" size="sm" onClick={() => { void copy(r.id, r.copy); }}
                    className={`${BTN} h-10 ${scaleIf(currentFocusId, `cs-copy-${r.id}`)}`} {...focusAttrs(currentFocusId, `cs-copy-${r.id}`)}>
                    <Copy className="w-4 h-4 mr-1" /> {t('billing.creds.copyBtn')}
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center gap-3 rounded-xl bg-black/30 border border-white/10 px-4 py-3">
              <Calendar className="w-5 h-5 text-brand-ice shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wide text-white/60">{t('billing.creds.expires')}</div>
                <div className="text-lg text-white font-medium">{formatDateTime(service.expires_at)}</div>
              </div>
            </div>
          </div>

          {emailTo && (
            <div className="mt-5 flex items-center gap-3 flex-wrap">
              <Button variant="white" size="sm" disabled={busy || mail === 'sending'} onClick={() => { void sendEmail(); }}
                className={`${BTN} h-11 ${scaleIf(currentFocusId, 'cs-email')}`} {...focusAttrs(currentFocusId, 'cs-email')}>
                {mail === 'sending' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                {mail === 'sent' ? t('billing.creds.sendAgainBtn') : t('billing.creds.emailMeBtn')}
              </Button>
              <span className="text-sm font-nunito text-brand-ice/80">
                {mail === 'sent' ? t('billing.creds.sentTo', { email: emailTo }) : null}
                {mail === 'sending' ? t('billing.creds.sendingTo', { email: emailTo }) : null}
                {mail === 'failed' ? <span className="text-amber-200">{mailNote}</span> : null}
                {mail === 'idle' ? t('billing.creds.canSendTo', { email: emailTo }) : null}
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-8 items-center">
            <Button variant="gold" disabled={busy} onClick={onPrimary}
              className={`${BTN_GOLD} ${scaleIf(currentFocusId, 'cs-primary')}`} {...focusAttrs(currentFocusId, 'cs-primary')}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {primaryLabel}
            </Button>
            {secondaryLabel && onSecondary && (
              <Button variant="white" disabled={busy} onClick={onSecondary}
                className={`${BTN} ${scaleIf(currentFocusId, 'cs-secondary')}`} {...focusAttrs(currentFocusId, 'cs-secondary')}>
                {secondaryLabel}
              </Button>
            )}
            {busy && busyLabel && <Spinner label={busyLabel} />}
          </div>
        </Card>
      </div>
    </div>
  );
});

CredentialsSheet.displayName = 'CredentialsSheet';
export default CredentialsSheet;
