import { memo, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Users, Plus, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  loadSavedAccounts,
  upsertSavedAccount,
  savedAccountId,
  savePlayerAccount,
  buildPlayerAccount,
  saveCreds,
  authenticateRouted,
  loadCreds,
  SAVED_ACCOUNTS_REFRESH_EVENT,
  type SavedAccount,
  type XtreamCreds,
} from '@/lib/xtream';

interface Props {
  onBack: () => void;
  onPicked: (c: XtreamCreds) => void;
  onAddAccount: () => void;
}

const SwitchAccountScreen = memo(({ onBack, onPicked, onAddAccount }: Props) => {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState(1);
  const [busy, setBusy] = useState(false);
  const focusIdxRef = useRef(focusIdx);
  const accountsRef = useRef(accounts);
  const busyRef = useRef(busy);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [list, cur] = await Promise.all([loadSavedAccounts(), loadCreds()]);
      if (cancelled) return;
      setAccounts(list);
      setCurrentId(cur ? savedAccountId(cur.host, cur.username) : null);
    };
    void load();
    const onRefresh = () => { void load(); };
    window.addEventListener(SAVED_ACCOUNTS_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(SAVED_ACCOUNTS_REFRESH_EVENT, onRefresh);
    };
  }, []);

  const pickAccount = async (acc: SavedAccount) => {
    if (busyRef.current) return;
    setBusy(true);
    try {
      const res = await authenticateRouted(acc.username, acc.password);
      if (!res.ok || !res.creds || !res.server) {
        toast({
          title: 'Could not switch account',
          description: res.error || 'Sign-in failed. The saved password may be out of date.',
          variant: 'destructive',
        });
        return;
      }
      await saveCreds(res.creds);
      const built = buildPlayerAccount(res.server, res.creds, res.userInfo);
      await savePlayerAccount(built);
      void upsertSavedAccount({
        id: savedAccountId(res.creds.host, res.creds.username),
        serverLabel: res.server.label,
        host: res.creds.host,
        username: res.creds.username,
        password: res.creds.password,
        output: res.creds.output,
        addedAt: Date.now(),
      });
      toast({ title: 'Account switched', description: `Signed in as ${res.creds.username}.` });
      onPicked(res.creds);
    } catch (err) {
      toast({
        title: 'Could not switch account',
        description: (err as Error).message || 'Network error.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onBack();
        return;
      }
      const arrows = ['ArrowUp', 'ArrowDown', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      const total = accountsRef.current.length + 2; // Back + N + Add
      if (e.key === 'ArrowDown') setFocusIdx(i => (i + 1) % total);
      else if (e.key === 'ArrowUp') setFocusIdx(i => (i - 1 + total) % total);
      else if (e.key === 'Enter' || e.key === ' ') {
        const i = focusIdxRef.current;
        if (i === 0) { onBack(); return; }
        if (i === total - 1) { onAddAccount(); return; }
        const acc = accountsRef.current[i - 1];
        if (acc) void pickAccount(acc);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, onAddAccount]);

  const total = accounts.length + 2;
  const addIdx = total - 1;

  return (
    <div className="min-h-screen flex flex-col text-white bg-black/70">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <Button
          variant="white"
          size="sm"
          onClick={onBack}
          data-player-header-btn=""
          data-focused={focusIdx === 0 ? 'true' : 'false'}
          className={`tv-focusable home-focus-surface transition-transform duration-150 ${
            focusIdx === 0 ? 'scale-105' : ''
          }`}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Users className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold text-white">Switch Account</h1>
        </div>
        {busy && <Loader2 className="w-5 h-5 animate-spin text-brand-gold ml-2" />}
      </div>

      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-xl space-y-3">
          {accounts.length === 0 && (
            <p className="text-white/60 text-sm text-center py-6">
              No saved accounts yet. Add one below.
            </p>
          )}
          {accounts.map((a, i) => {
            const rowIdx = i + 1;
            const focused = focusIdx === rowIdx;
            const active = a.id === currentId;
            return (
              <div
                key={a.id}
                data-player-header-btn=""
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setFocusIdx(rowIdx); void pickAccount(a); }}
                className={`tv-focusable home-focus-surface flex items-center gap-3 rounded-xl px-4 py-3 bg-slate-900/70 border border-white/10 cursor-pointer transition-transform duration-150 ${
                  focused ? 'scale-[1.02]' : ''
                }`}
              >
                <Badge className="bg-brand-gold/25 text-brand-gold border border-brand-gold/40">
                  {a.serverLabel}
                </Badge>
                <span className="flex-1 font-nunito truncate">{a.username}</span>
                {active && (
                  <Badge className="bg-emerald-600/30 text-emerald-100 border border-emerald-400/40">
                    Active
                  </Badge>
                )}
              </div>
            );
          })}

          <div
            data-player-header-btn=""
            data-focused={focusIdx === addIdx ? 'true' : 'false'}
            onClick={() => { setFocusIdx(addIdx); onAddAccount(); }}
            className={`tv-focusable home-focus-surface flex items-center gap-3 rounded-xl px-4 py-3 bg-slate-900/40 border border-dashed border-white/20 cursor-pointer transition-transform duration-150 ${
              focusIdx === addIdx ? 'scale-[1.02]' : ''
            }`}
          >
            <Plus className="w-5 h-5 text-brand-ice" />
            <span className="font-nunito">Add another account</span>
          </div>
        </div>
      </div>
    </div>
  );
});

SwitchAccountScreen.displayName = 'SwitchAccountScreen';
export default SwitchAccountScreen;
