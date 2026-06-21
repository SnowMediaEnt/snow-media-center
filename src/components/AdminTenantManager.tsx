import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Plus, Save, RefreshCw } from 'lucide-react';

interface Tenant {
  id: string;
  code: string;
  name: string;
  status: string;
}

const FEATURE_KEYS = [
  'support_videos',
  'games',
  'ai',
  'wix_store',
  'community',
  'customer_dashboard',
  'content_bar',
] as const;

type FeatureKey = (typeof FEATURE_KEYS)[number];

interface Branding {
  app_display_name: string;
  tagline: string;
  primary_color: string;
  accent_color: string;
  background_style: string;
  splash_bg: string;
  in_app_logo_url: string;
}

interface Settings {
  support_email: string;
  apps_source_url: string;
  rss_url: string;
  content_bar_default: boolean;
  plex_autoconnect: boolean;
  community_enabled: boolean;
}

const emptyBranding: Branding = {
  app_display_name: '',
  tagline: '',
  primary_color: '#3b82f6',
  accent_color: '#22d3ee',
  background_style: 'plain',
  splash_bg: '#0b1220',
  in_app_logo_url: '',
};

const emptySettings: Settings = {
  support_email: '',
  apps_source_url: '',
  rss_url: '',
  content_bar_default: false,
  plex_autoconnect: false,
  community_enabled: false,
};

const AdminTenantManager = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);

  const [branding, setBranding] = useState<Branding>(emptyBranding);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(
    Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>,
  );
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tenants')
      .select('id, code, name, status')
      .order('created_at', { ascending: true });
    if (error) toast.error(error.message);
    else setTenants((data ?? []) as Tenant[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const selectedTenant = tenants.find((t) => t.id === selectedId) ?? null;

  const loadTenantDetails = useCallback(async (id: string) => {
    setEditorLoading(true);
    const [b, s, f] = await Promise.all([
      supabase.from('tenant_branding').select('*').eq('tenant_id', id).maybeSingle(),
      supabase.from('tenant_settings').select('*').eq('tenant_id', id).maybeSingle(),
      supabase.from('tenant_features').select('feature_key, enabled').eq('tenant_id', id),
    ]);

    if (b.error) toast.error(b.error.message);
    if (s.error) toast.error(s.error.message);
    if (f.error) toast.error(f.error.message);

    setBranding({
      app_display_name: b.data?.app_display_name ?? '',
      tagline: b.data?.tagline ?? '',
      primary_color: b.data?.primary_color ?? '#3b82f6',
      accent_color: b.data?.accent_color ?? '#22d3ee',
      background_style: b.data?.background_style ?? 'plain',
      splash_bg: b.data?.splash_bg ?? '#0b1220',
      in_app_logo_url: b.data?.in_app_logo_url ?? '',
    });
    setSettings({
      support_email: s.data?.support_email ?? '',
      apps_source_url: s.data?.apps_source_url ?? '',
      rss_url: s.data?.rss_url ?? '',
      content_bar_default: !!s.data?.content_bar_default,
      plex_autoconnect: !!s.data?.plex_autoconnect,
      community_enabled: !!s.data?.community_enabled,
    });

    const fmap = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>;
    (f.data ?? []).forEach((row: { feature_key: string; enabled: boolean }) => {
      if ((FEATURE_KEYS as readonly string[]).includes(row.feature_key)) {
        fmap[row.feature_key as FeatureKey] = !!row.enabled;
      }
    });
    setFeatures(fmap);
    setEditorLoading(false);
  }, []);

  useEffect(() => {
    if (selectedId) loadTenantDetails(selectedId);
  }, [selectedId, loadTenantDetails]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('Name is required');
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.rpc('create_tenant', {
      p_name: newName.trim(),
      p_code: newCode.trim() || null,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as { id: string; code: string; name: string } | null;
    toast.success(`Created tenant "${result?.code}"`);
    setNewName('');
    setNewCode('');
    await fetchTenants();
    if (result?.id) setSelectedId(result.id);
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    const toNull = (v: string) => (v.trim() === '' ? null : v.trim());

    const bUp = await supabase.from('tenant_branding').upsert(
      {
        tenant_id: selectedId,
        app_display_name: branding.app_display_name,
        tagline: branding.tagline,
        primary_color: branding.primary_color,
        accent_color: branding.accent_color,
        background_style: branding.background_style,
        splash_bg: branding.splash_bg,
        in_app_logo_url: toNull(branding.in_app_logo_url),
      },
      { onConflict: 'tenant_id' },
    );

    const sUp = await supabase.from('tenant_settings').upsert(
      {
        tenant_id: selectedId,
        support_email: toNull(settings.support_email),
        apps_source_url: toNull(settings.apps_source_url),
        rss_url: toNull(settings.rss_url),
        content_bar_default: settings.content_bar_default,
        plex_autoconnect: settings.plex_autoconnect,
        community_enabled: settings.community_enabled,
      },
      { onConflict: 'tenant_id' },
    );

    const fUp = await supabase.from('tenant_features').upsert(
      FEATURE_KEYS.map((k) => ({
        tenant_id: selectedId,
        feature_key: k,
        enabled: features[k],
      })),
      { onConflict: 'tenant_id,feature_key' },
    );

    setSaving(false);
    const err = bUp.error || sUp.error || fUp.error;
    if (err) toast.error(err.message);
    else toast.success('Tenant saved');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      <div className="space-y-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center justify-between">
              Tenants
              <Button size="sm" variant="ghost" onClick={fetchTenants} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tenants.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`w-full text-left p-3 rounded-md border transition-colors ${
                  selectedId === t.id
                    ? 'bg-purple-600/30 border-purple-400/60'
                    : 'bg-slate-900/40 border-slate-700 hover:bg-slate-800'
                }`}
              >
                <div className="text-white font-medium">{t.name}</div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs text-purple-300">{t.code}</code>
                  <Badge variant="outline" className="text-xs text-slate-300">
                    {t.status}
                  </Badge>
                </div>
              </button>
            ))}
            {!loading && tenants.length === 0 && (
              <p className="text-sm text-slate-400">No tenants yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">Create tenant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="new-name" className="text-slate-300">Name *</Label>
              <Input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Acme TV" />
            </div>
            <div>
              <Label htmlFor="new-code" className="text-slate-300">Code (optional)</Label>
              <Input id="new-code" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="auto from name" />
            </div>
            <Button onClick={handleCreate} disabled={creating} className="w-full">
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create
            </Button>
          </CardContent>
        </Card>
      </div>

      <div>
        {!selectedTenant ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center text-slate-400">
              Select a tenant to edit, or create a new one.
            </CardContent>
          </Card>
        ) : editorLoading ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center text-slate-400">
              <Loader2 className="h-6 w-6 mx-auto animate-spin" />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="bg-gradient-to-br from-purple-900/30 to-slate-900/40 border-purple-700/40">
              <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide">Tenant code</div>
                  <code className="text-lg text-purple-300 font-mono">{selectedTenant.code}</code>
                  <p className="text-xs text-slate-400 mt-1">
                    This code is baked into that reseller's app build (VITE_TENANT_CODE).
                  </p>
                </div>
                <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500">
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader><CardTitle className="text-white text-base">Branding</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-300">App display name</Label>
                  <Input value={branding.app_display_name} onChange={(e) => setBranding({ ...branding, app_display_name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-slate-300">Tagline</Label>
                  <Input value={branding.tagline} onChange={(e) => setBranding({ ...branding, tagline: e.target.value })} />
                </div>
                <div>
                  <Label className="text-slate-300">Primary color</Label>
                  <Input value={branding.primary_color} onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })} />
                </div>
                <div>
                  <Label className="text-slate-300">Accent color</Label>
                  <Input value={branding.accent_color} onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })} />
                </div>
                <div>
                  <Label className="text-slate-300">Background style</Label>
                  <Select value={branding.background_style} onValueChange={(v) => setBranding({ ...branding, background_style: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="snow">snow</SelectItem>
                      <SelectItem value="plain">plain</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-300">Splash background</Label>
                  <Input value={branding.splash_bg} onChange={(e) => setBranding({ ...branding, splash_bg: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-slate-300">In-app logo URL</Label>
                  <Input value={branding.in_app_logo_url} onChange={(e) => setBranding({ ...branding, in_app_logo_url: e.target.value })} placeholder="https://..." />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader><CardTitle className="text-white text-base">Settings</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-300">Support email</Label>
                  <Input value={settings.support_email} onChange={(e) => setSettings({ ...settings, support_email: e.target.value })} placeholder="support@example.com" />
                </div>
                <div>
                  <Label className="text-slate-300">Apps source URL</Label>
                  <Input value={settings.apps_source_url} onChange={(e) => setSettings({ ...settings, apps_source_url: e.target.value })} placeholder="https://.../apps.json.php" />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-slate-300">RSS URL</Label>
                  <Input value={settings.rss_url} onChange={(e) => setSettings({ ...settings, rss_url: e.target.value })} placeholder="https://.../rss" />
                </div>
                <div className="flex items-center justify-between rounded-md border border-slate-700 p-3">
                  <Label className="text-slate-200">Content bar default ON</Label>
                  <Switch checked={settings.content_bar_default} onCheckedChange={(v) => setSettings({ ...settings, content_bar_default: v })} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-slate-700 p-3">
                  <Label className="text-slate-200">Plex autoconnect</Label>
                  <Switch checked={settings.plex_autoconnect} onCheckedChange={(v) => setSettings({ ...settings, plex_autoconnect: v })} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-slate-700 p-3">
                  <Label className="text-slate-200">Community enabled</Label>
                  <Switch checked={settings.community_enabled} onCheckedChange={(v) => setSettings({ ...settings, community_enabled: v })} />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader><CardTitle className="text-white text-base">Features</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {FEATURE_KEYS.map((k) => (
                  <div key={k} className="flex items-center justify-between rounded-md border border-slate-700 p-3">
                    <Label className="text-slate-200 font-mono text-sm">{k}</Label>
                    <Switch
                      checked={features[k]}
                      onCheckedChange={(v) => setFeatures({ ...features, [k]: v })}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminTenantManager;
