import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Pause, Play, RefreshCw, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SafetyState {
  paused: boolean;
  pause_reason: string | null;
  paused_at: string | null;
  paused_until: string | null;
  token_threshold_per_hour: number;
  notify_email: string;
}

interface UsageRow {
  id: string;
  created_at: string;
  user_email: string | null;
  feature: string;
  model: string | null;
  prompt: string;
  response_preview: string | null;
  total_tokens: number;
  cost_credits: number;
  status: string;
  error_message: string | null;
}

const AdminAIPanel = () => {
  const { toast } = useToast();
  const [state, setState] = useState<SafetyState | null>(null);
  const [tokensLastHour, setTokensLastHour] = useState<number>(0);
  const [logs, setLogs] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [threshold, setThreshold] = useState<string>('');

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: t }, { data: l }] = await Promise.all([
      supabase.from('ai_safety_state').select('*').eq('id', 1).maybeSingle(),
      supabase.rpc('ai_tokens_last_hour'),
      supabase
        .from('ai_usage_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);
    if (s) {
      setState(s as SafetyState);
      setThreshold(String((s as SafetyState).token_threshold_per_hour));
    }
    setTokensLastHour(Number(t ?? 0));
    setLogs((l as UsageRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel('ai-usage-log')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ai_usage_log' },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const togglePause = async () => {
    if (!state) return;
    const next = !state.paused;
    const { error } = await supabase
      .from('ai_safety_state')
      .update({
        paused: next,
        pause_reason: next ? 'Manually paused by admin' : null,
        paused_at: next ? new Date().toISOString() : null,
        paused_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: next ? 'AI paused' : 'AI resumed' });
      load();
    }
  };

  const saveThreshold = async () => {
    const n = Number(threshold);
    if (!Number.isFinite(n) || n <= 0) {
      toast({ title: 'Invalid threshold', variant: 'destructive' });
      return;
    }
    const { error } = await supabase
      .from('ai_safety_state')
      .update({ token_threshold_per_hour: n, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    else {
      toast({ title: 'Threshold updated' });
      load();
    }
  };

  const filtered = logs.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.user_email ?? '').toLowerCase().includes(q) ||
      (r.prompt ?? '').toLowerCase().includes(q) ||
      (r.feature ?? '').toLowerCase().includes(q) ||
      (r.model ?? '').toLowerCase().includes(q)
    );
  });

  const usagePct = state ? Math.min(100, (tokensLastHour / state.token_threshold_per_hour) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900/80 border-slate-700 p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" /> AI Safety
            </h3>
            <p className="text-sm text-slate-400">
              Status:{' '}
              {state?.paused ? (
                <Badge variant="destructive">Paused</Badge>
              ) : (
                <Badge className="bg-green-600">Live</Badge>
              )}
              {state?.pause_reason && (
                <span className="ml-2 text-yellow-300">{state.pause_reason}</span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={load} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
            <Button onClick={togglePause} size="sm" variant={state?.paused ? 'default' : 'destructive'}>
              {state?.paused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
              {state?.paused ? 'Resume AI' : 'Pause AI'}
            </Button>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-300 mb-1">
            <span>Tokens used (last 1h)</span>
            <span>
              {tokensLastHour.toLocaleString()} / {state?.token_threshold_per_hour.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="h-2 bg-slate-800 rounded overflow-hidden">
            <div
              className={`h-full ${usagePct > 80 ? 'bg-red-500' : usagePct > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-slate-400">Token threshold per hour (auto-pause trigger)</label>
            <Input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          <Button onClick={saveThreshold} size="sm">Save</Button>
        </div>
        <p className="text-xs text-slate-500">
          When platform-wide token usage in the last hour exceeds this threshold, AI auto-pauses
          and emails {state?.notify_email}.
        </p>
      </Card>

      <Card className="bg-slate-900/80 border-slate-700 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-lg font-bold text-white">AI Request Log (last 200)</h3>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
            <Input
              placeholder="Filter by email, prompt, feature…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 bg-slate-800 border-slate-600 text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm text-left text-slate-200">
            <thead className="text-xs uppercase bg-slate-800 sticky top-0">
              <tr>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">User</th>
                <th className="px-2 py-2">Feature</th>
                <th className="px-2 py-2">Tokens</th>
                <th className="px-2 py-2">Cost</th>
                <th className="px-2 py-2">Prompt</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-6 text-slate-400">No requests yet.</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-2 py-2 whitespace-nowrap">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-2 py-2 max-w-[180px] truncate">{r.user_email ?? '—'}</td>
                  <td className="px-2 py-2">
                    <Badge variant="outline" className="text-xs">{r.feature}</Badge>
                  </td>
                  <td className="px-2 py-2">{r.total_tokens.toLocaleString()}</td>
                  <td className="px-2 py-2">{r.cost_credits.toFixed(2)}</td>
                  <td className="px-2 py-2 max-w-[300px]">
                    <div className="truncate" title={r.prompt}>{r.prompt}</div>
                    {r.response_preview && (
                      <div className="text-xs text-slate-500 truncate" title={r.response_preview}>
                        ↳ {r.response_preview}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {r.status === 'ok' ? (
                      <Badge className="bg-green-600 text-xs">ok</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-xs">{r.status}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default AdminAIPanel;
