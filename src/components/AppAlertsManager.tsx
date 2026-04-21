import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Plus, Trash2, Mail, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAppData } from '@/hooks/useAppData';
import { useAppAlerts, type AppAlert } from '@/hooks/useAppAlerts';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

const SEVERITIES: AppAlert['severity'][] = ['info', 'warning', 'critical'];

const AppAlertsManager = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { apps } = useAppData();
  const { alerts: activeAlerts, refetch } = useAppAlerts();

  const [allAlerts, setAllAlerts] = useState<AppAlert[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
  const [title, setTitle] = useState('Heads up');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<AppAlert['severity']>('warning');

  const sortedApps = useMemo(
    () => [...apps].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [apps]
  );

  const fetchAll = async () => {
    setLoadingList(true);
    const { data, error } = await supabase
      .from('app_alerts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Failed to load alerts', description: error.message, variant: 'destructive' });
    } else {
      setAllAlerts((data || []) as AppAlert[]);
    }
    setLoadingList(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Keep in sync with realtime updates from useAppAlerts (active changes)
  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlerts.length]);

  const toggleApp = (name: string) => {
    setSelectedApps((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleCreate = async () => {
    if (selectedApps.length === 0) {
      toast({ title: 'Pick at least one app', variant: 'destructive' });
      return;
    }
    if (!message.trim()) {
      toast({ title: 'Message is required', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const rows = selectedApps.map((name) => ({
      app_match: name,
      title: title.trim() || 'Heads up',
      message: message.trim(),
      severity,
      active: true,
      source: 'admin',
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from('app_alerts').insert(rows);
    setSubmitting(false);
    if (error) {
      toast({ title: 'Failed to create alert', description: error.message, variant: 'destructive' });
      return;
    }
    toast({
      title: `Alert posted for ${selectedApps.length} app${selectedApps.length === 1 ? '' : 's'}`,
      description: 'Users will see the popup the next time they open the app.',
    });
    setSelectedApps([]);
    setMessage('');
    setTitle('Heads up');
    setSeverity('warning');
    await fetchAll();
    await refetch();
  };

  const handleToggleActive = async (alert: AppAlert) => {
    const { error } = await supabase
      .from('app_alerts')
      .update({ active: !alert.active })
      .eq('id', alert.id);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    } else {
      await fetchAll();
      await refetch();
    }
  };

  const handleDelete = async (alert: AppAlert) => {
    const { error } = await supabase.from('app_alerts').delete().eq('id', alert.id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Alert deleted' });
      await fetchAll();
      await refetch();
    }
  };

  const severityBadgeColor = (s: AppAlert['severity']) =>
    s === 'critical'
      ? 'bg-red-600/30 text-red-300 border-red-500/40'
      : s === 'warning'
      ? 'bg-yellow-600/30 text-yellow-200 border-yellow-500/40'
      : 'bg-blue-600/30 text-blue-200 border-blue-500/40';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-yellow-300" />
        <div>
          <h2 className="text-2xl font-bold text-white">App Alerts</h2>
          <p className="text-sm text-slate-200">
            Show a popup when users open specific apps (e.g. "Dreamstreams EPG is down").
          </p>
        </div>
      </div>

      {/* Create form */}
      <Card className="bg-slate-900/60 border-slate-700 p-5 space-y-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Plus className="w-5 h-5" /> New alert
        </h3>

        <div className="space-y-2">
          <Label className="text-slate-200">Select apps (one or more)</Label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-3 rounded-md bg-slate-800/60 border border-slate-700">
            {sortedApps.length === 0 && (
              <p className="text-slate-400 text-sm col-span-full">No apps loaded yet.</p>
            )}
            {sortedApps.map((app) => {
              const checked = selectedApps.includes(app.name);
              return (
                <label
                  key={app.id}
                  className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition ${
                    checked ? 'bg-brand-gold/20 border border-brand-gold/40' : 'hover:bg-slate-700/60 border border-transparent'
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleApp(app.name)}
                  />
                  <span className="text-sm text-white truncate">{app.name}</span>
                </label>
              );
            })}
          </div>
          {selectedApps.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {selectedApps.map((n) => (
                <Badge key={n} className="bg-brand-gold/20 text-brand-gold border border-brand-gold/40">
                  {n}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 space-y-2">
            <Label className="text-slate-200">Popup title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Heads up"
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-200">Severity</Label>
            <div className="flex gap-1">
              {SEVERITIES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={severity === s ? 'gold' : 'outline'}
                  onClick={() => setSeverity(s)}
                  className="capitalize flex-1"
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-slate-200">Message</Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="e.g. EPG is currently down. We're working on it."
            className="bg-slate-800 border-slate-600 text-white"
          />
        </div>

        <Button
          onClick={handleCreate}
          disabled={submitting}
          variant="gold"
          className="w-full sm:w-auto"
        >
          {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Post alert{selectedApps.length > 1 ? ` to ${selectedApps.length} apps` : ''}
        </Button>
      </Card>

      {/* Existing alerts list */}
      <Card className="bg-slate-900/60 border-slate-700 p-5 space-y-3">
        <h3 className="text-lg font-semibold text-white">Existing alerts</h3>
        {loadingList ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : allAlerts.length === 0 ? (
          <p className="text-slate-400 text-sm">No alerts yet. Create one above.</p>
        ) : (
          <div className="space-y-2">
            {allAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-3 p-3 rounded-md bg-slate-800/60 border border-slate-700"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge className={`border ${severityBadgeColor(alert.severity)}`}>
                      {alert.severity}
                    </Badge>
                    <span className="text-white font-semibold truncate">{alert.app_match}</span>
                    {alert.source === 'email' && (
                      <Badge variant="outline" className="border-slate-600 text-slate-300">
                        <Mail className="w-3 h-3 mr-1" /> email
                      </Badge>
                    )}
                    {!alert.active && (
                      <Badge variant="outline" className="border-slate-600 text-slate-400">
                        inactive
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-200 font-medium">{alert.title}</p>
                  <p className="text-sm text-slate-400 whitespace-pre-wrap">{alert.message}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(alert.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Active</span>
                    <Switch
                      checked={alert.active}
                      onCheckedChange={() => handleToggleActive(alert)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(alert)}
                    className="bg-red-600/20 border-red-500/50 text-red-300 hover:bg-red-600/30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AppAlertsManager;
