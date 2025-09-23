import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, ShoppingCart, ArrowLeft } from 'lucide-react';
import { useWixIntegration } from '@/hooks/useWixIntegration';
import { useWixStore } from '@/hooks/useWixStore';
import { useToast } from '@/hooks/use-toast';

const WixConnectionTest = ({ onBack }: { onBack?: () => void }) => {
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionResult, setConnectionResult] = useState<any>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [checkoutResult, setCheckoutResult] = useState<any>(null);
  
  const { testConnection } = useWixIntegration();
  const { products, createCart, fetchProducts } = useWixStore();
  const { toast } = useToast();

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
          description: `Total members: ${result.totalMembers || 'N/A'}`,
        });
      } else {
        toast({
          title: "❌ Wix Connection Failed",
          description: result.error || 'Unknown error',
          variant: "destructive"
        });
      }
    } catch (error) {
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
      // Use first available product for test
      if (products.length === 0) {
        await fetchProducts();
        return;
      }
      
      const testProduct = products[0];
      const testItems = [{
        productId: testProduct.id,
        quantity: 1,
        name: testProduct.name,
        price: testProduct.price,
        image: testProduct.images[0]
      }];
      
      console.log('Testing checkout with:', testItems);
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
      
    } catch (error) {
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

  return (
    <div className="space-y-6 p-6">
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
          <h2 className="text-2xl font-bold mb-2">Wix Store Connection Test</h2>
          <p className="text-muted-foreground">Test your Wix integration and checkout functionality</p>
        </div>
        <div className="w-20">{/* Spacer for balance */}</div>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2">
        {/* Connection Test */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {connectionStatus === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
              {connectionStatus === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
              {connectionStatus === 'testing' && <Loader2 className="h-5 w-5 animate-spin" />}
              Wix API Connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={testWixConnection}
              disabled={connectionStatus === 'testing'}
              className="w-full"
            >
              {connectionStatus === 'testing' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                'Test Wix Connection'
              )}
            </Button>
            
            {connectionResult && (
              <div className="space-y-2">
                <Badge variant={connectionStatus === 'success' ? 'default' : 'destructive'}>
                  {connectionStatus === 'success' ? 'Connected' : 'Failed'}
                </Badge>
                {connectionResult.totalMembers && (
                  <p className="text-sm text-muted-foreground">
                    Total Wix Members: {connectionResult.totalMembers}
                  </p>
                )}
                {connectionResult.error && (
                  <p className="text-sm text-red-500">
                    Error: {connectionResult.error}
                  </p>
                )}
                {connectionResult.message && (
                  <p className="text-sm text-muted-foreground">
                    {connectionResult.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Checkout Test */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {checkoutStatus === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
              {checkoutStatus === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
              {checkoutStatus === 'testing' && <Loader2 className="h-5 w-5 animate-spin" />}
              <ShoppingCart className="h-5 w-5" />
              Wix Checkout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={testCheckout}
              disabled={checkoutStatus === 'testing' || products.length === 0}
              className="w-full"
            >
              {checkoutStatus === 'testing' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing Checkout...
                </>
              ) : (
                'Test Checkout Flow'
              )}
            </Button>
            
            <p className="text-xs text-muted-foreground">
              Products available: {products.length}
            </p>
            
            {checkoutResult && (
              <div className="space-y-2">
                <Badge variant={checkoutStatus === 'success' ? 'default' : 'destructive'}>
                  {checkoutStatus === 'success' ? 'Checkout Ready' : 'Failed'}
                </Badge>
                {checkoutResult.checkoutUrl && (
                  <p className="text-sm text-muted-foreground">
                    Checkout URL: <span className="text-blue-500">Generated ✓</span>
                  </p>
                )}
                {checkoutResult.cart && (
                  <p className="text-sm text-muted-foreground">
                    Cart ID: {checkoutResult.cart.id}
                  </p>
                )}
                {checkoutResult.error && (
                  <p className="text-sm text-red-500">
                    Error: {checkoutResult.error}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Current Products */}
      <Card>
        <CardHeader>
          <CardTitle>Current Wix Products ({products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length > 0 ? (
            <div className="grid gap-2">
              {products.slice(0, 5).map((product) => (
                <div key={product.id} className="flex justify-between items-center p-2 border rounded">
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">${product.price}</p>
                  </div>
                  <Badge variant={product.inStock ? 'default' : 'secondary'}>
                    {product.inStock ? 'In Stock' : 'Out of Stock'}
                  </Badge>
                </div>
              ))}
              {products.length > 5 && (
                <p className="text-sm text-muted-foreground text-center">
                  ... and {products.length - 5} more products
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No products loaded</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WixConnectionTest;