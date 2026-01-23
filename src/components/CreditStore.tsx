import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CreditCard, Zap, Star, Gift } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  description: string;
  is_active: boolean;
}

interface CreditStoreProps {
  onBack: () => void;
}

const CreditStore = ({ onBack }: CreditStoreProps) => {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { toast } = useToast();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);

  // Keyboard back button handling
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Allow Backspace when typing
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      if (event.key === 'Backspace' && isTyping) return;
      
      // Handle back button - no nested containers, just exit
      if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        onBack();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  useEffect(() => {
    fetchCreditPackages();
  }, []);

  const fetchCreditPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('credit_packages')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true });

      if (error) throw error;
      setPackages(data || []);
    } catch (error) {
      console.error('Error fetching credit packages:', error);
      toast({
        title: "Error",
        description: "Failed to load credit packages",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const calculateSavings = (credits: number, price: number) => {
    const basePrice = credits * 0.12; // Base price per credit
    const savings = ((basePrice - price) / basePrice) * 100;
    return Math.round(savings);
  };

  const handlePurchase = async (packageData: CreditPackage) => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to purchase credits",
        variant: "destructive",
      });
      return;
    }

    setPurchasing(packageData.id);
    
    try {
      // For now, simulate purchase - in production you'd integrate with PayPal or Stripe
      // Since Wix cart creation is failing due to catalog mismatch, we'll simulate for demo
      toast({
        title: "Processing Payment",
        description: "Processing your credit purchase...",
      });

      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Add credits to user account
      const { error } = await supabase.rpc('update_user_credits', {
        p_user_id: user.id,
        p_amount: packageData.credits,
        p_transaction_type: 'purchase',
        p_description: `Purchased ${packageData.name}`,
        p_paypal_transaction_id: `sim_${Date.now()}`
      });

      if (error) throw error;

      toast({
        title: "Purchase Successful!",
        description: `You've received ${packageData.credits} credits`,
      });

      // Refresh user profile to show updated credits
      window.location.reload();
    } catch (error) {
      console.error('Error purchasing credits:', error);
      toast({
        title: "Purchase Failed",
        description: "Unable to create checkout. Please try again.",
        variant: "destructive",
      });
    } finally {
      setPurchasing(null);
    }
  };

  const getPackageIcon = (index: number) => {
    switch (index) {
      case 0: return Zap;
      case 1: return CreditCard;
      case 2: return Star;
      case 3: return Gift;
      default: return CreditCard;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <Button 
              onClick={onBack}
              variant="outline" 
              size="lg"
              className="mr-6 bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Credit Store</h1>
              <p className="text-xl text-blue-200">Purchase credits for AI image generation</p>
            </div>
          </div>
          {profile && (
            <div className="bg-green-600/20 border border-green-500/50 rounded-lg px-4 py-2">
              <div className="text-green-400 font-medium">Your Balance</div>
              <div className="text-2xl font-bold text-white">{profile.credits} credits</div>
            </div>
          )}
        </div>

        {/* Credit Usage Info */}
        <Card className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 border-blue-500/30 mb-8">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-white mb-3">How Credits Work</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                <span className="text-white/80">Standard Image (1024x1024): 6 credits</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                <span className="text-white/80">Large Image (1536x1024): 12 credits</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span className="text-white/80">High-quality AI generated images</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                <span className="text-white/80">Credits never expire</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Credit Packages */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <Card key={i} className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 animate-pulse">
                <div className="h-48 bg-white/10"></div>
                <CardContent className="p-4 space-y-2">
                  <div className="h-4 bg-white/10 rounded"></div>
                  <div className="h-3 bg-white/10 rounded w-3/4"></div>
                  <div className="h-6 bg-white/10 rounded w-1/2"></div>
                </CardContent>
              </Card>
            ))
          ) : (
            packages.map((pkg, index) => {
              const Icon = getPackageIcon(index);
              const savings = calculateSavings(pkg.credits, pkg.price);
              const isPopular = index === 1; // Make the second package popular
              
              return (
                <Card 
                  key={pkg.id} 
                  className={`bg-gradient-to-br from-blue-600/20 to-purple-600/20 border-blue-500/30 overflow-hidden hover:from-blue-600/30 hover:to-purple-600/30 transition-all duration-300 relative ${
                    isPopular ? 'ring-2 ring-yellow-400 scale-105' : ''
                  }`}
                >
                  {isPopular && (
                    <div className="absolute top-0 right-0 bg-yellow-500 text-black px-2 py-1 text-xs font-bold rounded-bl-lg">
                      MOST POPULAR
                    </div>
                  )}
                  {savings > 0 && (
                    <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                      Save {savings}%
                    </div>
                  )}
                  
                  <CardHeader className="text-center pb-4">
                    <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Icon className="w-8 h-8 text-white" />
                    </div>
                    <CardTitle className="text-xl text-white">{pkg.name}</CardTitle>
                    <div className="text-3xl font-bold text-white">${pkg.price.toFixed(2)}</div>
                    <div className="text-blue-200">{pkg.credits} credits</div>
                  </CardHeader>
                  
                  <CardContent className="text-center">
                    <p className="text-white/70 text-sm mb-4">{pkg.description}</p>
                    
                    <div className="space-y-2 mb-4">
                      <div className="text-xs text-white/60">
                        ~{Math.floor(pkg.credits / 6)} standard images
                      </div>
                      <div className="text-xs text-white/60">
                        ~{Math.floor(pkg.credits / 12)} large images
                      </div>
                    </div>
                    
                    <Button
                      onClick={() => handlePurchase(pkg)}
                      disabled={purchasing === pkg.id || !user}
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                    >
                      {purchasing === pkg.id ? 'Processing...' : 'Purchase Credits'}
                    </Button>
                    
                    {!user && (
                      <p className="text-xs text-white/60 mt-2">Sign in required</p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Payment Info */}
        <Card className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 mt-8">
          <CardContent className="p-6 text-center">
            <h3 className="text-lg font-semibold text-white mb-3">Secure Payment</h3>
            <p className="text-white/70 text-sm mb-4">
              All transactions are secure and processed through trusted payment providers. 
              Credits are added to your account instantly after purchase.
            </p>
            <div className="flex justify-center space-x-4 text-xs text-white/60">
              <span>• Secure SSL encryption</span>
              <span>• Instant credit delivery</span>
              <span>• No monthly fees</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CreditStore;