import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, ShoppingCart, ArrowLeft, Wifi, Database, Package } from 'lucide-react';
import { useWixIntegration } from '@/hooks/useWixIntegration';
import { useWixStore } from '@/hooks/useWixStore';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const APPS_JSON_URL = 'https://snowmediaapps.com/apps/apps.json.php';

const WixConnectionTest = ({ onBack }: { onBack?: () => void }) => {
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionResult, setConnectionResult] = useState<any>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [checkoutResult, setCheckoutResult] = useState<any>(null);
  const [appsJsonStatus, setAppsJsonStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [appsJsonResult, setAppsJsonResult] = useState<any>(null);
  const [supabaseStatus, setSupabaseStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [supabaseResult, setSupabaseResult] = useState<any>(null);

  const { testConnection } = useWixIntegration();
  const { products, createCart, fetchProducts } = useWixStore();
  const { toast } = useToast();

  const testAppsJson = async () => {
    setAppsJsonStatus('testing');
    setAppsJsonResult(null);
    try {
      const url = `${APPS_JSON_URL}?ts=${Date.now()}`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Server returned HTML instead of JSON');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Response is not valid JSON');
      }

      let appCount = 0;
      if (Array.isArray(parsed)) appCount = parsed.length;
      else if (parsed?.apps && Array.isArray(parsed.apps)) appCount = parsed.apps.length;
      else if (typeof parsed === 'object') appCount = Object.keys(parsed).length;

      setAppsJsonResult({ appCount, url });
      setAppsJsonStatus('success');
      toast({ title: '✅ Apps JSON Connected', description: `Found ${appCount} apps at snowmediaapps.com` });
    } catch (err: any) {
      setAppsJsonResult({ error: err.message });
      setAppsJsonStatus('error');
      toast({ title: '❌ Apps JSON Failed', description: err.message, variant: 'destructive' });
    }
  };

  const testSupabase = async () => {
    setSupabaseStatus('testing');
    setSupabaseResult(null);
    try {
      // Test 1: REST ping
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const hasSession = !!sessionData?.session;

      // Test 2: Query a table
      const { count, error: dbError } = await supabase
        .from('apps')
        .select('*', { count: 'exact', head: true });

      if (dbError) throw new Error(`DB query failed: ${dbError.message}`);

      setSupabaseResult({ connected: true, hasSession, appsInDb: count ?? 0 });
      setSupabaseStatus('success');
      toast({ title: '✅ Supabase Connected', description: `DB reachable · ${count ?? 0} apps in DB · Session: ${hasSession ? 'Active' : 'None'}` });
    } catch (err: any) {
      setSupabaseResult({ error: err.message });
      setSupabaseStatus('error');
      toast({ title: '❌ Supabase Failed', description: err.message, variant: 'destructive' });
    }
  };

  const testWixConnection = async () => {
    setConnectionStatus('testing');
    setConnectionResult(null);

    try {
      const result = await testConnection();
      console.log('Connection test result:', result);
      setConnectionResult(result);
      setConnectionStatus(result.connected ? 'success' : 'error');

      if (result.connected) {
        toast({
          title: "✅ Wix Connection Successful",
          description: `Total members: ${result.totalMembers ?? 'N/A'}`,
        });
      } else {
        toast({
          title: "❌ Wix Connection Failed",
          description: result.error || 'Unknown error',
          variant: "destructive"
        });
      }
    } catch (error: any) {
      console.error('Connection test error:', error);
      setConnectionResult({ error: error.message });
      setConnectionStatus('error');
      toast({
        title: "❌ Connection Test Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const testCheckout = async () => {
    setCheckoutStatus('testing');
    setCheckoutResult(null);

    try {
      console.log('Current products:', products);
      console.log('Products length:', products.length);

      // Use first available product for test
      if (products.length === 0) {
        console.log('No products available, fetching...');
        await fetchProducts();

        // Check again after fetching
        if (products.length === 0) {
          throw new Error('No products available for checkout test. Please ensure your Wix store has products.');
        }
      }

      const testProduct = products[0];
      console.log('Using test product:', testProduct);

      const testItems = [{
        productId: testProduct.id,
        quantity: 1,
        name: testProduct.name,
        price: testProduct.price,
        image: testProduct.images?.[0] || ''
      }];

      console.log('Testing checkout with items:', testItems);
      const result = await createCart(testItems);
      console.log('Checkout test result:', result);

      setCheckoutResult(result);
      setCheckoutStatus('success');

      toast({
        title: "✅ Checkout Test Successful",
        description: "Cart created and checkout URL generated",
      });

      // Open checkout URL in new tab for verification
      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, '_blank');
      }

    } catch (error: any) {
      console.error('Checkout test error:', error);
      setCheckoutResult({ error: error.message });
      setCheckoutStatus('error');
      toast({
        title: "❌ Checkout Test Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const runAllTests = async () => {
    await testAppsJson();
    await testSupabase();
    await testWixConnection();
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'success') return <CheckCircle className="h-5 w-5 text-green-500" />;
    if (status === 'error') return <XCircle className="h-5 w-5 text-red-500" />;
    if (status === 'testing') return <Loader2 className="h-5 w-5 animate-spin" />;
    return null;
  };

  return (
    <div className="space-y-6 p-6 text-white min-h-screen bg-slate-900">
      <div className="flex items-center justify-between">
        <div>
          {onBack && (
            <Button onClick={onBack} variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          )}
        </div>
        <div className="text-center flex-1">
          <h2 className="text-2xl font-bold mb-1">Connection Diagnostics</h2>
          <p className="text-slate-400 text-sm">Verify all services are reachable and functional</p>
        </div>
        <div className="w-24">
          <Button onClick={runAllTests} size="sm" variant="gold">
            Test All
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">

        {/* Apps JSON Test */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-white text-base">
              <StatusIcon status={appsJsonStatus} />
              <Package className="h-5 w-5 text-blue-400" />
              Apps JSON (snowmediaapps.com)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-400 break-all">{APPS_JSON_URL}</p>
            <Button
              onClick={testAppsJson}
              disabled={appsJsonStatus === 'testing'}
              className="w-full"
              size="sm"
            >
              {appsJsonStatus === 'testing' ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing...</>
              ) : 'Test Apps JSON'}
            </Button>
            {appsJsonResult && (
              <div className="space-y-1">
                <Badge variant={appsJsonStatus === 'success' ? 'default' : 'destructive'}>
                  {appsJsonStatus === 'success' ? `✓ Connected` : '✗ Failed'}
                </Badge>
                {appsJsonResult.appCount !== undefined && (
                  <p className="text-xs text-slate-300">Apps available: {appsJsonResult.appCount}</p>
                )}
                {appsJsonResult.error && (
                  <p className="text-xs text-red-400">Error: {appsJsonResult.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Supabase Test */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-white text-base">
              <StatusIcon status={supabaseStatus} />
              <Database className="h-5 w-5 text-green-400" />
              Supabase / Auth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-400">Database + Authentication backend</p>
            <Button
              onClick={testSupabase}
              disabled={supabaseStatus === 'testing'}
              className="w-full"
              size="sm"
            >
              {supabaseStatus === 'testing' ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing...</>
              ) : 'Test Supabase'}
            </Button>
            {supabaseResult && (
              <div className="space-y-1">
                <Badge variant={supabaseStatus === 'success' ? 'default' : 'destructive'}>
                  {supabaseStatus === 'success' ? '✓ Connected' : '✗ Failed'}
                </Badge>
                {supabaseResult.connected && (
                  <>
                    <p className="text-xs text-slate-300">Apps in DB: {supabaseResult.appsInDb}</p>
                    <p className="text-xs text-slate-300">Session: {supabaseResult.hasSession ? 'Active ✓' : 'None (not logged in)'}</p>
                  </>
                )}
                {supabaseResult.error && (
                  <p className="text-xs text-red-400">Error: {supabaseResult.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Wix API Connection Test */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-white text-base">
              <StatusIcon status={connectionStatus} />
              <Wifi className="h-5 w-5 text-purple-400" />
              Wix API / Members
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-400">Wix account members &amp; store access</p>
            <Button
              onClick={testWixConnection}
              disabled={connectionStatus === 'testing'}
              className="w-full"
              size="sm"
            >
              {connectionStatus === 'testing' ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing...</>
              ) : 'Test Wix Connection'}
            </Button>
            {connectionResult && (
              <div className="space-y-1">
                <Badge variant={connectionStatus === 'success' ? 'default' : 'destructive'}>
                  {connectionStatus === 'success' ? '✓ Connected' : '✗ Failed'}
                </Badge>
                {connectionResult.totalMembers != null && (
                  <p className="text-xs text-slate-300">Wix Members: {connectionResult.totalMembers}</p>
                )}
                {connectionResult.message && (
                  <p className="text-xs text-slate-300">{connectionResult.message}</p>
                )}
                {connectionResult.error && (
                  <p className="text-xs text-red-400">Error: {connectionResult.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Checkout Test */}
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-white text-base">
              <StatusIcon status={checkoutStatus} />
              <ShoppingCart className="h-5 w-5 text-yellow-400" />
              Wix Store / Checkout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-400">Products: {products.length} loaded</p>
            <Button
              onClick={testCheckout}
              disabled={checkoutStatus === 'testing' || products.length === 0}
              className="w-full"
              size="sm"
            >
              {checkoutStatus === 'testing' ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing...</>
              ) : products.length === 0 ? 'No products loaded' : 'Test Checkout Flow'}
            </Button>
            {checkoutResult && (
              <div className="space-y-1">
                <Badge variant={checkoutStatus === 'success' ? 'default' : 'destructive'}>
                  {checkoutStatus === 'success' ? '✓ Checkout Ready' : '✗ Failed'}
                </Badge>
                {checkoutResult.checkoutUrl && (
                  <p className="text-xs text-slate-300">Checkout URL: <span className="text-green-400">Generated ✓</span></p>
                )}
                {checkoutResult.cart && (
                  <p className="text-xs text-slate-300">Cart ID: {checkoutResult.cart.id}</p>
                )}
                {checkoutResult.error && (
                  <p className="text-xs text-red-400">Error: {checkoutResult.error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Current Wix Products */}
      {products.length > 0 && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">Wix Store Products ({products.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {products.slice(0, 5).map((product) => (
                <div key={product.id} className="flex justify-between items-center p-2 border border-slate-700 rounded">
                  <div>
                    <p className="font-medium text-sm text-white">{product.name}</p>
                    <p className="text-xs text-slate-400">${product.price}</p>
                  </div>
                  <Badge variant={product.inStock ? 'default' : 'secondary'}>
                    {product.inStock ? 'In Stock' : 'Out of Stock'}
                  </Badge>
                </div>
              ))}
              {products.length > 5 && (
                <p className="text-xs text-slate-400 text-center">
                  ... and {products.length - 5} more products
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default WixConnectionTest;
