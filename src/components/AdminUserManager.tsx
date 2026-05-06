import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Coins, Plus, Minus, MessageCircle, User as UserIcon, Mail } from 'lucide-react';

interface ProfileRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  credits: number;
  total_spent: number;
}

const AdminUserManager = ({ onOpenUserTickets }: { onOpenUserTickets?: (userId: string, email: string) => void }) => {
  const { toast } = useToast();
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, username, credits, total_spent')
        .order('updated_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      setUsers((data as ProfileRow[]) || []);
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Error', description: e.message || 'Failed to load users', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      u.email?.toLowerCase().includes(s) ||
      u.full_name?.toLowerCase().includes(s) ||
      u.username?.toLowerCase().includes(s) ||
      u.user_id.includes(s)
    );
  });

  const adjustCredits = async (u: ProfileRow, delta: number) => {
    const raw = amounts[u.user_id] || '';
    const amount = Math.abs(parseFloat(raw));
    if (!amount || isNaN(amount)) {
      toast({ title: 'Enter amount', description: 'Set a credit amount first', variant: 'destructive' });
      return;
    }
    setBusyId(u.user_id);
    try {
      const { data, error } = await supabase.rpc('update_user_credits', {
        p_user_id: u.user_id,
        p_amount: amount,
        p_transaction_type: delta > 0 ? 'purchase' : 'deduction',
        p_description: delta > 0 ? `Admin grant: +${amount} credits` : `Admin deduction: -${amount} credits`,
        p_paypal_transaction_id: null,
      });
      if (error) throw error;
      if (data === false) {
        toast({ title: 'Insufficient credits', description: "User doesn't have enough credits to deduct", variant: 'destructive' });
      } else {
        toast({ title: 'Done', description: `${delta > 0 ? 'Added' : 'Removed'} ${amount} credits` });
        setAmounts(prev => ({ ...prev, [u.user_id]: '' }));
        await fetchUsers();
      }
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Error', description: e.message || 'Failed to adjust credits', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email, name, username or user id..."
            className="pl-9 bg-slate-700 border-slate-600 text-white"
          />
        </div>
        <Button onClick={fetchUsers} variant="outline" className="bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white">
          Refresh
        </Button>
      </div>

      {loading && <p className="text-slate-400 text-sm">Loading users…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-slate-400 text-sm py-8 text-center">No users found.</p>
      )}

      <div className="grid gap-3">
        {filtered.map((u) => (
          <Card key={u.user_id} className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-white font-semibold">
                    <UserIcon className="h-4 w-4 text-purple-300" />
                    {u.full_name || u.username || 'Unnamed user'}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-400 mt-1">
                    <Mail className="h-3 w-3" /> {u.email || '—'}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-1">{u.user_id}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className="bg-yellow-600/30 text-yellow-200 border border-yellow-500/40">
                    <Coins className="h-3 w-3 mr-1" />
                    {Number(u.credits).toFixed(2)} credits
                  </Badge>
                  <span className="text-xs text-slate-400">Spent: {Number(u.total_spent).toFixed(2)}</span>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={amounts[u.user_id] || ''}
                  onChange={(e) => setAmounts(prev => ({ ...prev, [u.user_id]: e.target.value }))}
                  placeholder="Amount"
                  className="w-32 bg-slate-700 border-slate-600 text-white"
                />
                <Button
                  size="sm"
                  disabled={busyId === u.user_id}
                  onClick={() => adjustCredits(u, +1)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
                <Button
                  size="sm"
                  disabled={busyId === u.user_id}
                  variant="outline"
                  onClick={() => adjustCredits(u, -1)}
                  className="bg-red-600/20 hover:bg-red-500/30 border-red-400/50 text-white"
                >
                  <Minus className="h-4 w-4 mr-1" /> Deduct
                </Button>
                {onOpenUserTickets && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenUserTickets(u.user_id, u.email || '')}
                    className="bg-purple-600/20 hover:bg-purple-500/30 border-purple-400/50 text-white"
                  >
                    <MessageCircle className="h-4 w-4 mr-1" /> Tickets
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminUserManager;
