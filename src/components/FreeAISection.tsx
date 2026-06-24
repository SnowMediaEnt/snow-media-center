import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useFeatureFlag, setFeatureFlag } from '@/hooks/useFeatureFlag';
import { RefreshCw, Sparkles, RotateCcw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface FreeConfig {
  chat_total_limit_usd: number;
  chat_per_device_limit_usd: number;
  images_total_limit: number;
  images_per_device_limit: number;
  rate_limit_per_hour: number;
  global_calls_per_hour: number;
  global_images_per_hour: number;
  chat_spent_usd: number;
  images_used: number;
  updated_at: string | null;
}

interface AnonDeviceRow {
  device_id: string;
  chat_cost_usd: number;
  chat_calls: number;
  images_used: number;
  total_calls: number;
  last_used_at: string | null;
}

interface IpRow {
  ip_hash: string;
  calls_this_hour: number;
  images_this_hour: number;
  chat_cost_usd: number;
  last_seen_at: string | null;
}

const CONFIG_FIELDS: Array<{ key: keyof FreeConfig; label: string; step?: string }> = [
  { key: 'chat_total_limit_usd', label: 'Chat total cap (USD)', step: '0.01' },
  { key: 'chat_per_device_limit_usd', label: 'Chat per-device cap (USD)', step: '0.01' },
  { key: 'images_total_limit', label: 'Images total cap (count)' },
  { key: 'images_per_device_limit', label: 'Images per-device cap (count)' },
  { key: 'rate_limit_per_hour', label: 'Per-device calls / hour' },
  { key: 'global_calls_per_hour', label: 'Global calls / hour' },
  { key: 'global_images_per_hour', label: 'Global images / hour' },
];

const FreeAISection = () => {
  const { toast } = useToast();
  const { enabled: flagEnabled, loading: flagLoading } = useFeatureFlag('free_ai_enabled', false);
  const [cfg, setCfg] = useState<FreeConfig | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingFlag, setSavingFlag] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [devices, setDevices] = useState<AnonDeviceRow[]>([]);
  const [ips, setIps] = useState<IpRow[]>([]);
  const [anonStats, setAnonStats] = useState<{ chatCalls: number; imageCalls: number; chatCost: number }>({ chatCalls: 0, imageCalls: 0, chatCost: 0 });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: c }, { data: d }, { data: i }, { data: usage }] = await Promise.all([
      supabase.from('ai_free_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('ai_anon_usage').select('device_id, chat_cost_usd, chat_calls, images_used, total_calls, last_used_at').order('total_calls', { ascending: false }).limit(25),
      supabase.from('ai_ip_usage').select('ip_hash, calls_this_hour, images_this_hour, chat_cost_usd, last_seen_at').order('last_seen_at', { ascending: false }).limit(25),
      supabase.from('ai_usage_log').select('feature, cost_credits, user_email, user_id').gte('created_at', since).limit(1000),
    ]);
    if (c) {
      setCfg(c as unknown as FreeConfig);
      const init: Record<string, string> = {};
      CONFIG_FIELDS.forEach((f) => { init[f.key] = String((c as Record<string, unknown>)[f.key] ?? ''); });
      setEdits(init);
    }
    setDevices((d as AnonDeviceRow[]) ?? []);
    setIps((i as IpRow[]) ?? []);
    const anon = (usage ?? []).filter((u: { user_email: string | null; user_id: string | null }) =>
      u.user_id == null || (u.user_email ?? '').startsWith('anon:')
    );
    setAnonStats({
      chatCalls: anon.filter((r: { feature: string }) => r.feature === 'chat').length,
      imageCalls: anon.filter((r: { feature: string }) => r.feature !== 'chat').length,
      chatCost: anon.filter((r: { feature: string }) => r.feature === 'chat')
        .reduce((s: number, r: { cost_credits: number | null }) => s + Number(r.cost_credits ?? 0), 0),
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleFlag = async (next: boolean) => {
    setSavingFlag(true);
    try {
      await setFeatureFlag('free_ai_enabled', next);
      toast({ title: next ? 'Free AI ENABLED' : 'Free AI disabled' });
    } catch (e) {
      toast({ title: 'Failed to update flag', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSavingFlag(false);
    }
  };

  const saveCfg = async () => {
    const patch: Record<string, number> = {};
    for (const f of CONFIG_FIELDS) {
      const n = Number(edits[f.key]);
      if (!Number.isFinite(n) || n < 0) {
        toast({ title: `Invalid value for ${f.label}`, variant: 'destructive' });
        return;
      }
      patch[f.key] = n;
    }
    setSavingCfg(true);
    const { error } = await supabase.from('ai_free_config')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
    setSavingCfg(false);
    if (error) toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Caps updated' }); load(); }
  };

  const resetBudget = async () => {
    setResetting(true);
    const { error } = await supabase.from('ai_free_config').update({
      chat_spent_usd: 0,
      images_used: 0,
      global_calls_this_hour: 0,
      global_images_this_hour: 0,
      global_hour_bucket: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setResetting(false);
    if (error) toast({ title: 'Reset failed', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Free-AI budget reset to $0 / 0 images' }); load(); }
  };

  const chatPct = cfg && cfg.chat_total_limit_usd > 0
    ? Math.min(100, (Number(cfg.chat_spent_usd) / Number(cfg.chat_total_limit_usd)) * 100) : 0;
  const imgPct = cfg && cfg.images_total_limit > 0
    ? Math.min(100, (Number(cfg.images_used) / Number(cfg.images_total_limit)) * 100) : 0;

  return (
    <Card className="bg-gradient-to-br from-indigo-900/80 to-slate-900/80 border-indigo-700 p-4 space-y-4">
      <div className={`flex items-center justify-between flex-wrap gap-3 rounded-lg p-3 border ${flagEnabled ? 'bg-green-900/30 border-green-600' : 'bg-slate-950/60 border-slate-700'}`}>
        <div className="flex items-center gap-3">
          <Sparkles className={`w-7 h-7 ${flagEnabled ? 'text-green-300' : 'text-indigo-300'}`} />
          <div>
            <h3 className="text-xl font-bold text-white">
              Free AI — {flagEnabled
                ? <Badge className="bg-green-600 ml-1 align-middle">ENABLED</Badge>
                : <Badge variant="destructive" className="ml-1 align-middle">disabled</Badge>}
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              Master switch for anonymous chat &amp; image gen under the caps below.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-200 font-semibold">{flagEnabled ? 'ON' : 'OFF'}</span>
          <Switch
            checked={flagEnabled}
            disabled={flagLoading || savingFlag}
            onCheckedChange={toggleFlag}
            aria-label="Toggle free AI"
            className="scale-125"
          />
          <Button onClick={load} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
          <div className="flex justify-between text-sm text-slate-200">
            <span>Chat spend</span>
            <span>${Number(cfg?.chat_spent_usd ?? 0).toFixed(4)} / ${Number(cfg?.chat_total_limit_usd ?? 0).toFixed(2)}</span>
          </div>
          <div className="h-2 bg-slate-800 rounded overflow-hidden mt-2">
            <div className={`h-full ${chatPct > 80 ? 'bg-red-500' : chatPct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${chatPct}%` }} />
          </div>
        </div>
        <div className="rounded-lg bg-slate-950/60 border border-slate-800 p-3">
          <div className="flex justify-between text-sm text-slate-200">
            <span>Images used</span>
            <span>{cfg?.images_used ?? 0} / {cfg?.images_total_limit ?? 0}</span>
          </div>
          <div className="h-2 bg-slate-800 rounded overflow-hidden mt-2">
            <div className={`h-full ${imgPct > 80 ? 'bg-red-500' : imgPct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${imgPct}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded bg-slate-950/60 border border-slate-800 p-2">
          <div className="text-xs text-slate-400">Anon chat calls (7d)</div>
          <div className="text-xl font-bold text-white">{anonStats.chatCalls}</div>
        </div>
        <div className="rounded bg-slate-950/60 border border-slate-800 p-2">
          <div className="text-xs text-slate-400">Anon image calls (7d)</div>
          <div className="text-xl font-bold text-white">{anonStats.imageCalls}</div>
        </div>
        <div className="rounded bg-slate-950/60 border border-slate-800 p-2">
          <div className="text-xs text-slate-400">Anon chat cost (7d, credits)</div>
          <div className="text-xl font-bold text-white">{anonStats.chatCost.toFixed(2)}</div>
        </div>
      </div>

      <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-3 space-y-3">
        <div className="text-sm font-semibold text-slate-200">Caps &amp; rate limits</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CONFIG_FIELDS.map((f) => (
            <div key={String(f.key)}>
              <label className="text-xs text-slate-400">{f.label}</label>
              <Input
                type="number"
                step={f.step ?? '1'}
                value={edits[f.key] ?? ''}
                onChange={(e) => setEdits((s) => ({ ...s, [f.key]: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={saveCfg} disabled={savingCfg || !cfg} size="sm">
            {savingCfg ? 'Saving…' : 'Save caps'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={resetting || !cfg}>
                <RotateCcw className="w-4 h-4 mr-1" />
                {resetting ? 'Resetting…' : 'Reset free-AI budget'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset free-AI budget?</AlertDialogTitle>
                <AlertDialogDescription>
                  This zeroes chat spend, image count, and the hourly buckets — a fresh trial period
                  begins immediately. Per-device and per-IP ledgers are unaffected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={resetBudget}>Reset budget</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <span className="text-xs text-slate-500">
            Last updated: {cfg?.updated_at ? formatDistanceToNow(new Date(cfg.updated_at), { addSuffix: true }) : '—'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-3">
          <div className="text-sm font-semibold text-slate-200 mb-2">Top anonymous devices</div>
          <div className="max-h-64 overflow-y-auto text-xs">
            {loading && <div className="text-slate-400">Loading…</div>}
            {!loading && devices.length === 0 && <div className="text-slate-400">No anonymous usage yet.</div>}
            {devices.map((d) => (
              <div key={d.device_id} className="flex justify-between border-b border-slate-800 py-1 gap-2">
                <span className="font-mono truncate max-w-[160px]" title={d.device_id}>{d.device_id}</span>
                <span className="text-slate-300">{d.total_calls} calls · {d.images_used} img · ${Number(d.chat_cost_usd).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-slate-950/40 border border-slate-800 p-3">
          <div className="text-sm font-semibold text-slate-200 mb-2">Top IPs (current hour bucket)</div>
          <div className="max-h-64 overflow-y-auto text-xs">
            {loading && <div className="text-slate-400">Loading…</div>}
            {!loading && ips.length === 0 && <div className="text-slate-400">No IP usage yet.</div>}
            {ips.map((r) => (
              <div key={r.ip_hash} className="flex justify-between border-b border-slate-800 py-1 gap-2">
                <span className="font-mono truncate max-w-[160px]" title={r.ip_hash}>{r.ip_hash.slice(0, 16)}…</span>
                <span className="text-slate-300">{r.calls_this_hour} calls · {r.images_this_hour} img · ${Number(r.chat_cost_usd).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default FreeAISection;
