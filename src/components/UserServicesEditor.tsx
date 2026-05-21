import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Tv, Wifi, Trash2, Plus, Calendar, Smartphone } from 'lucide-react';
import { ensureCustomerRow, daysUntil, type UserDevice, type UserService } from '@/hooks/useUserServices';

const DEVICE_OPTIONS: string[] = [
  'Amazon Fire TV / Firestick',
  'Smart TV',
  'Android TV Box',
  'Android Phone or Tablet',
  'Other',
];

const SERVICE_OPTIONS: string[] = ['Dreamstreams', 'VibezTV', 'Plex'];

const COMMON_IPTV_APPS: string[] = [
  'TiviMate',
  'IPTV Smarters Pro',
  'XCIPTV',
  'Sparkle TV',
  'OTT Navigator',
  'Smart STB',
  'Snow IPTV',
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** The user whose devices/services we're editing. */
  userId: string;
  email: string;
  /** True when an admin is editing another user. */
  adminMode?: boolean;
  /** Display name shown in the title. */
  displayName?: string;
  onSaved?: () => void;
}

const UserServicesEditor = ({ open, onClose, userId, email, adminMode = false, displayName, onSaved }: Props) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [services, setServices] = useState<UserService[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cid = await ensureCustomerRow(userId, email, adminMode);
        if (cancelled) return;
        setCustomerId(cid);
        const [devRes, svcRes] = await Promise.all([
          supabase.from('customer_devices').select('id, device_type, label, notes').eq('customer_id', cid),
          supabase.from('customer_services')
            .select('id, service_type, service_name, expiration_date, tied_apps, renewal_status, notes')
            .eq('customer_id', cid),
        ]);
        if (cancelled) return;
        setDevices((devRes.data as UserDevice[]) || []);
        setServices(((svcRes.data as any[]) || []).map((s) => ({
          ...s,
          tied_apps: Array.isArray(s.tied_apps) ? s.tied_apps : [],
        })));
      } catch (e: any) {
        toast({ title: 'Could not load', description: e.message || String(e), variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId, email, adminMode, toast]);

  const selectedDeviceTypes = useMemo(() => new Set(devices.map(d => d.device_type)), [devices]);

  const toggleDevice = (deviceType: string) => {
    setDevices(prev => {
      const has = prev.find(d => d.device_type === deviceType);
      if (has) return prev.filter(d => d.device_type !== deviceType);
      return [...prev, { id: `new-${Date.now()}-${deviceType}`, device_type: deviceType, label: null, notes: null }];
    });
  };

  const toggleServiceByName = (name: string) => {
    setServices(prev => {
      const existing = prev.find(s => (s.service_name || '').toLowerCase() === name.toLowerCase());
      if (existing) return prev.filter(s => s.id !== existing.id);
      return [
        ...prev,
        {
          id: `new-${Date.now()}-${name}`,
          service_type: name === 'Plex' ? 'Plex' : 'IPTV',
          service_name: name,
          expiration_date: null,
          tied_apps: [],
          renewal_status: 'active',
          notes: null,
        },
      ];
    });
  };

  const updateService = (id: string, patch: Partial<UserService>) => {
    setServices(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const removeService = (id: string) => {
    setServices(prev => prev.filter(s => s.id !== id));
  };

  const toggleTiedApp = (id: string, app: string) => {
    setServices(prev => prev.map(s => {
      if (s.id !== id) return s;
      const has = s.tied_apps.includes(app);
      return { ...s, tied_apps: has ? s.tied_apps.filter(a => a !== app) : [...s.tied_apps, app] };
    }));
  };

  const handleSave = async () => {
    if (!customerId) return;
    setSaving(true);
    try {
      // --- Devices: diff against DB ---
      const { data: existingDev } = await supabase
        .from('customer_devices').select('id, device_type').eq('customer_id', customerId);
      const existingTypes = new Set((existingDev || []).map((d: any) => d.device_type));
      const newTypes = new Set(devices.map(d => d.device_type));

      const toAdd = [...newTypes].filter(t => !existingTypes.has(t));
      const toRemoveIds = (existingDev || [])
        .filter((d: any) => !newTypes.has(d.device_type))
        .map((d: any) => d.id);

      if (toAdd.length) {
        await supabase.from('customer_devices').insert(
          toAdd.map(t => ({ customer_id: customerId, device_type: t }))
        );
      }
      if (toRemoveIds.length) {
        await supabase.from('customer_devices').delete().in('id', toRemoveIds);
      }

      // --- Services ---
      for (const s of services) {
        const payload = {
          customer_id: customerId,
          service_type: s.service_type || 'IPTV',
          service_name: s.service_name || null,
          expiration_date: s.expiration_date || null,
          tied_apps: s.tied_apps || [],
          renewal_status: s.renewal_status || 'active',
          notes: s.notes || null,
        };
        if (s.id.startsWith('new-')) {
          await supabase.from('customer_services').insert(payload);
        } else {
          await supabase.from('customer_services').update(payload).eq('id', s.id);
        }
      }
      // Delete services removed locally
      const { data: existingSvc } = await supabase
        .from('customer_services').select('id').eq('customer_id', customerId);
      const keepIds = new Set(services.filter(s => !s.id.startsWith('new-')).map(s => s.id));
      const removeSvc = (existingSvc || []).filter((s: any) => !keepIds.has(s.id)).map((s: any) => s.id);
      if (removeSvc.length) {
        await supabase.from('customer_services').delete().in('id', removeSvc);
      }

      toast({ title: 'Saved', description: 'Your devices and services were updated.' });
      window.dispatchEvent(new CustomEvent('userServicesRefresh'));
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-slate-900 border-slate-700 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl text-white">
            {adminMode ? `Edit ${displayName || email}` : 'My Devices & Services'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Pick the devices you own and add your IPTV service expiration date. We'll warn you 1 week before, on the due date, and pop a notice on tied apps if it's expired.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-slate-400 text-center py-8">Loading…</p>
        ) : (
          <div className="space-y-6">
            {/* Devices */}
            <section>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-blue-300" /> Devices you own
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEVICE_OPTIONS.map(d => {
                  const active = selectedDeviceTypes.has(d);
                  return (
                    <Button
                      key={d}
                      type="button"
                      onClick={() => toggleDevice(d)}
                      className={`justify-start text-left h-auto py-3 transition-all duration-200 outline-none focus:outline-none focus-visible:scale-110 focus-visible:shadow-[0_0_20px_rgba(96,165,250,0.7)] focus-visible:z-10 ${
                        active
                          ? 'bg-blue-600 hover:bg-blue-700 text-white scale-[1.02] shadow-lg shadow-blue-500/30'
                          : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200'
                      }`}
                    >
                      <Tv className="w-4 h-4 mr-2 flex-shrink-0" />
                      <span className="whitespace-normal">{d}</span>
                    </Button>
                  );
                })}
              </div>
            </section>

            {/* Services */}
            <section>
              <div className="mb-3">
                <h3 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <Wifi className="w-5 h-5 text-green-300" /> Your Services
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SERVICE_OPTIONS.map(name => {
                    const active = services.some(s => (s.service_name || '').toLowerCase() === name.toLowerCase());
                    return (
                      <Button
                        key={name}
                        type="button"
                        onClick={() => toggleServiceByName(name)}
                        className={`justify-start text-left h-auto py-3 transition-all duration-200 outline-none focus:outline-none focus-visible:scale-110 focus-visible:shadow-[0_0_20px_rgba(96,165,250,0.7)] focus-visible:z-10 ${
                          active
                            ? 'bg-blue-600 hover:bg-blue-700 text-white scale-[1.02] shadow-lg shadow-blue-500/30'
                            : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200'
                        }`}
                      >
                        <Wifi className="w-4 h-4 mr-2 flex-shrink-0" />
                        <span className="whitespace-normal">{name}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {services.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Expiration date (so we can warn you before it expires)
                  </Label>
                  {services.map(s => {
                    const days = daysUntil(s.expiration_date);
                    let statusBadge: React.ReactNode = null;
                    if (days !== null) {
                      if (days < 0) statusBadge = <Badge className="bg-red-600 text-white">Expired {Math.abs(days)}d ago</Badge>;
                      else if (days === 0) statusBadge = <Badge className="bg-amber-500 text-black">Expires today</Badge>;
                      else if (days <= 7) statusBadge = <Badge className="bg-amber-500 text-black">In {days}d</Badge>;
                      else statusBadge = <Badge className="bg-emerald-600 text-white">{days}d left</Badge>;
                    }
                    return (
                      <div key={s.id} className="flex items-center gap-2 rounded-md bg-slate-800/50 border border-slate-700 px-3 py-2">
                        <span className="text-white font-medium text-sm w-24 flex-shrink-0">{s.service_name || s.service_type}</span>
                        <Input
                          type="date"
                          value={s.expiration_date || ''}
                          onChange={(e) => updateService(s.id, { expiration_date: e.target.value || null })}
                          className="bg-slate-900 border-slate-600 text-white flex-1 outline-none focus:outline-none focus-visible:scale-105 focus-visible:shadow-[0_0_20px_rgba(96,165,250,0.7)] transition-all"
                        />
                        {statusBadge}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
            </section>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-slate-700">
          <Button variant="outline" onClick={onClose} disabled={saving}
            className="bg-slate-700 hover:bg-slate-600 border-slate-600 text-white outline-none focus:outline-none focus-visible:scale-110 focus-visible:shadow-[0_0_20px_rgba(148,163,184,0.7)] transition-all">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}
            className="bg-blue-600 hover:bg-blue-700 outline-none focus:outline-none focus-visible:scale-110 focus-visible:shadow-[0_0_20px_rgba(96,165,250,0.8)] transition-all">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UserServicesEditor;
