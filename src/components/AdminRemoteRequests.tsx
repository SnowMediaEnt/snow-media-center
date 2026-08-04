import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MonitorSmartphone, Loader2, Save, User, Mail, Smartphone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import type { Tables } from '@/integrations/supabase/types';

type RemoteRequest = Tables<'remote_support_requests'>;

interface RequestWithUser extends RemoteRequest {
  user_email?: string;
  user_name?: string;
}

const STATUS_OPTIONS = ['pending_payment', 'paid', 'in_progress', 'done', 'cancelled'] as const;

const statusBadgeClass = (status: string): string => {
  switch (status) {
    case 'pending_payment':
      return 'bg-yellow-100 text-yellow-800';
    case 'paid':
      return 'bg-green-100 text-green-800';
    case 'in_progress':
      return 'bg-blue-100 text-blue-800';
    case 'done':
      return 'bg-emerald-100 text-emerald-800';
    case 'cancelled':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const AdminRemoteRequests = () => {
  const [requests, setRequests] = useState<RequestWithUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('remote_support_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const userIds = [...new Set((data ?? []).map((r) => r.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, email, full_name')
        .in('user_id', userIds);
      const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

      const rows = (data ?? []).map((r) => ({
        ...r,
        user_email: profileMap.get(r.user_id)?.email || 'Unknown',
        user_name: profileMap.get(r.user_id)?.full_name || undefined,
      }));
      setRequests(rows);
      setNoteDrafts((prev) => {
        const next = { ...prev };
        for (const r of rows) if (!(r.id in next)) next[r.id] = r.admin_note ?? '';
        return next;
      });
    } catch (err) {
      console.error('Error fetching remote support requests:', err);
      toast({
        title: 'Error',
        description: 'Failed to load remote support requests',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const updateStatus = useCallback(
    async (id: string, status: string) => {
      try {
        const { error } = await supabase
          .from('remote_support_requests')
          .update({ status })
          .eq('id', id);
        if (error) throw error;
        setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
        toast({ title: 'Status Updated', description: `Request marked ${status.replace('_', ' ')}` });
      } catch (err) {
        console.error('Error updating request status:', err);
        toast({ title: 'Error', description: 'Failed to update status', variant: 'destructive' });
      }
    },
    [toast],
  );

  const saveNote = useCallback(
    async (id: string) => {
      try {
        setSavingNote(id);
        const { error } = await supabase
          .from('remote_support_requests')
          .update({ admin_note: noteDrafts[id] ?? '' })
          .eq('id', id);
        if (error) throw error;
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, admin_note: noteDrafts[id] ?? '' } : r)),
        );
        toast({ title: 'Note Saved' });
      } catch (err) {
        console.error('Error saving note:', err);
        toast({ title: 'Error', description: 'Failed to save note', variant: 'destructive' });
      } finally {
        setSavingNote(null);
      }
    },
    [noteDrafts, toast],
  );

  return (
    <div className="space-y-4">
      {requests.map((r) => (
        <Card key={r.id} className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge className={statusBadgeClass(r.status)}>
                    <span className="capitalize">{r.status.replace('_', ' ')}</span>
                  </Badge>
                  {r.order_number && (
                    <Badge variant="outline" className="text-slate-300">
                      Order #{r.order_number}
                    </Badge>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-white mb-1">{r.issue}</h3>
                <div className="flex items-center gap-4 text-sm text-slate-400 flex-wrap">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {r.user_name || r.user_email}
                  </span>
                  <span>Created {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                  {r.paid_at && (
                    <span className="text-green-400">
                      Paid {formatDistanceToNow(new Date(r.paid_at), { addSuffix: true })}
                    </span>
                  )}
                  {r.session_started_at && (
                    <span className="text-blue-400">
                      Session started {formatDistanceToNow(new Date(r.session_started_at), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
              <Select value={r.status} onValueChange={(v) => updateStatus(r.id, v)}>
                <SelectTrigger className="w-44 bg-slate-700 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              {r.needs && (
                <div className="bg-slate-700/40 rounded-lg p-3">
                  <p className="text-slate-400 mb-1">What they need done</p>
                  <p className="text-slate-200 whitespace-pre-wrap">{r.needs}</p>
                </div>
              )}
              <div className="bg-slate-700/40 rounded-lg p-3 space-y-1">
                <p className="text-slate-400 mb-1">Contact &amp; device</p>
                {r.contact && (
                  <p className="text-slate-200 flex items-center gap-2">
                    <Mail className="h-3 w-3 text-slate-400" />
                    {r.contact}
                  </p>
                )}
                {(r.device_model || r.android_version) && (
                  <p className="text-slate-200 flex items-center gap-2">
                    <Smartphone className="h-3 w-3 text-slate-400" />
                    {[r.device_model, r.android_version && `Android ${r.android_version}`]
                      .filter(Boolean)
                      .join(' — ')}
                  </p>
                )}
                <p className="text-slate-500 font-mono text-xs pt-1">ref: {r.id}</p>
              </div>
            </div>

            <div className="flex gap-2 items-start">
              <Textarea
                value={noteDrafts[r.id] ?? ''}
                onChange={(e) =>
                  setNoteDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                }
                placeholder="Internal note (only admins see this)..."
                rows={2}
                className="bg-slate-700 border-slate-600 text-white text-sm"
              />
              <Button
                onClick={() => saveNote(r.id)}
                disabled={savingNote === r.id}
                variant="outline"
                className="bg-purple-600/20 border-purple-400/50 text-white hover:bg-purple-500/30 shrink-0"
              >
                {savingNote === r.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {requests.length === 0 && !loading && (
        <div className="text-center py-12">
          <MonitorSmartphone className="h-12 w-12 mx-auto text-slate-500 mb-4" />
          <h3 className="text-xl font-semibold text-slate-300 mb-2">No Remote Requests</h3>
          <p className="text-slate-500">No remote support sessions have been requested yet.</p>
        </div>
      )}
    </div>
  );
};

export default AdminRemoteRequests;
