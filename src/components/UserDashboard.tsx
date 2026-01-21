import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Wallet, CreditCard, History, User, LogOut, Plus, MessageCircle, ShoppingCart, MapPin, Users, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useWixIntegration } from '@/hooks/useWixIntegration';
import { useToast } from '@/hooks/use-toast';

interface UserDashboardProps {
  onViewChange: (view: 'home' | 'apps' | 'media' | 'news' | 'support' | 'chat' | 'settings' | 'user' | 'store' | 'community' | 'credits') => void;
  onManageMedia: () => void;
  onViewSettings: () => void;
  onCommunityChat: () => void;
  onCreditStore: () => void;
}

const UserDashboard = ({ onViewChange, onManageMedia, onViewSettings, onCommunityChat, onCreditStore }: UserDashboardProps) => {
  const { user, signOut } = useAuth();
  const { profile, transactions, loading } = useUserProfile();
  const { wixProfile, wixOrders, wixReferrals, loading: wixLoading, fetchWixData } = useWixIntegration();
  const { toast } = useToast();
  const [showPurchase, setShowPurchase] = useState(false);
  const [focusedElement, setFocusedElement] = useState(0); // 0: back, 1: sign out, 2-5: tabs, 6-7: action buttons
  const [activeTab, setActiveTab] = useState('overview');

  // Android TV/Firestick navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement > 0) {
            setFocusedElement(focusedElement - 1);
          }
          break;
        case 'ArrowRight':
          if (focusedElement < 7) {
            setFocusedElement(focusedElement + 1);
          }
          break;
        case 'ArrowUp':
          if (focusedElement >= 6) {
            setFocusedElement(focusedElement - 4); // Move from action buttons to tabs
          } else if (focusedElement >= 2) {
            setFocusedElement(focusedElement - 2); // Move from tabs to header buttons
          }
          break;
        case 'ArrowDown':
          if (focusedElement <= 1) {
            setFocusedElement(focusedElement + 2); // Move from header to tabs
          } else if (focusedElement <= 5) {
            setFocusedElement(Math.min(focusedElement + 4, 7)); // Move from tabs to action buttons
          }
          break;
        case 'Enter':
        case ' ':
          if (focusedElement === 0) {
            onViewChange('home');
          } else if (focusedElement === 1) {
            handleSignOut();
          } else if (focusedElement === 2) {
            setActiveTab('overview');
          } else if (focusedElement === 3) {
            setActiveTab('credits');
          } else if (focusedElement === 4) {
            setActiveTab('store');
          } else if (focusedElement === 5) {
            setActiveTab('referrals');
          } else if (focusedElement === 6) {
            onCreditStore();
          } else if (focusedElement === 7) {
            onCommunityChat();
          }
          break;
        case 'Escape':
        case 'Backspace':
          onViewChange('home');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, onViewChange, onCreditStore, onCommunityChat]);

  // Fetch Wix data when user changes
  useEffect(() => {
    if (user?.email && !wixLoading) {
      fetchWixData(user.email);
    }
  }, [user?.email, wixLoading, fetchWixData]);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({
        title: "Error signing out",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Signed out",
        description: "You have been successfully signed out.",
      });
      onViewChange('home');
    }
  };

  if (loading) {
    return (
      <div className="tv-scroll-container tv-safe bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-xl text-blue-200">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-scroll-container tv-safe bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
      <div className="max-w-6xl mx-auto pb-16">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
            <Button 
              onClick={() => onViewChange('home')}
              variant="gold" 
              size="lg"
              className={`transition-all duration-200 ${
                focusedElement === 0 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <Button 
              onClick={handleSignOut}
              variant="outline" 
              className={`bg-red-600 border-red-500 text-white hover:bg-red-700 transition-all duration-200 ${
                focusedElement === 1 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Your Dashboard</h1>
            <p className="text-xl text-blue-200">Welcome back, {profile?.full_name || user?.email}</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-green-600 to-green-800 border-green-500 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm font-medium">Available Credits</p>
                <p className="text-3xl font-bold text-white">{profile?.credits?.toFixed(2) || '0.00'}</p>
              </div>
              <Wallet className="w-12 h-12 text-green-200" />
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium">Total Spent</p>
                <p className="text-3xl font-bold text-white">${profile?.total_spent?.toFixed(2) || '0.00'}</p>
              </div>
              <CreditCard className="w-12 h-12 text-blue-200" />
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm font-medium">Transactions</p>
                <p className="text-3xl font-bold text-white">{transactions.length}</p>
              </div>
              <History className="w-12 h-12 text-purple-200" />
            </div>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 mb-8">
          <Button 
            onClick={onCreditStore}
            size="lg"
            className={`bg-green-600 hover:bg-green-700 text-white transition-all duration-200 ${
              focusedElement === 6 ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <Plus className="w-5 h-5 mr-2" />
            Purchase Credits
          </Button>
          <Button 
            onClick={onCommunityChat}
            size="lg"
            variant="outline"
            className={`bg-blue-600/20 border-blue-500/50 text-white hover:bg-blue-600/30 transition-all duration-200 ${
              focusedElement === 7 ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <MessageCircle className="w-5 h-5 mr-2" />
            Community Chat
          </Button>
        </div>

        {/* Dashboard Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8 bg-slate-800/50 border-slate-600">
            <TabsTrigger 
              value="overview" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 2 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              Overview
            </TabsTrigger>
            <TabsTrigger 
              value="credits" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 3 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              App Credits
            </TabsTrigger>
            <TabsTrigger 
              value="store" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 4 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              Store Account
            </TabsTrigger>
            <TabsTrigger 
              value="referrals" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${
                focusedElement === 5 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              Referrals
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
              <h2 className="text-2xl font-bold text-white mb-4">Account Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Profile Information</h3>
                  <div className="space-y-2">
                    <p className="text-slate-300"><span className="font-medium">Name:</span> {profile?.full_name || 'Not set'}</p>
                    <p className="text-slate-300"><span className="font-medium">Email:</span> {profile?.email || user?.email}</p>
                    <p className="text-slate-300"><span className="font-medium">Username:</span> {profile?.username || 'Not set'}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Account Stats</h3>
                  <div className="space-y-2">
                    <p className="text-slate-300"><span className="font-medium">Member Since:</span> {new Date(profile?.created_at || '').toLocaleDateString()}</p>
                    <p className="text-slate-300"><span className="font-medium">Total Credits Used:</span> {profile?.total_spent?.toFixed(2) || '0.00'}</p>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="credits" className="mt-0">
            <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
                <Sparkles className="w-6 h-6 mr-2" />
                App Credits & AI Usage
              </h2>
              
              {transactions.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No credit transactions yet</p>
              ) : (
                <div className="space-y-3">
                  {transactions.map((transaction) => (
                    <div 
                      key={transaction.id}
                      className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-600"
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${
                          transaction.transaction_type === 'purchase' ? 'bg-green-400' :
                          transaction.transaction_type === 'deduction' ? 'bg-red-400' :
                          'bg-blue-400'
                        }`} />
                        <div>
                          <p className="text-white font-medium">{transaction.description}</p>
                          <p className="text-slate-400 text-sm">
                            {new Date(transaction.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${
                          transaction.transaction_type === 'purchase' ? 'text-green-400' :
                          transaction.transaction_type === 'deduction' ? 'text-red-400' :
                          'text-blue-400'
                        }`}>
                          {transaction.transaction_type === 'deduction' ? '-' : '+'}
                          {transaction.amount.toFixed(2)} credits
                        </p>
                        <Badge 
                          variant="secondary" 
                          className={`${
                            transaction.transaction_type === 'purchase' ? 'bg-green-600' :
                            transaction.transaction_type === 'deduction' ? 'bg-red-600' :
                            'bg-blue-600'
                          } text-white`}
                        >
                          {transaction.transaction_type}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="store" className="mt-0">
            <div className="space-y-6">
              <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
                <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
                  <ShoppingCart className="w-6 h-6 mr-2" />
                  Store Purchase History
                </h2>
                
                {wixLoading ? (
                  <p className="text-slate-400 text-center py-8">Loading store data...</p>
                ) : wixOrders && wixOrders.length > 0 ? (
                  <div className="space-y-3">
                    {wixOrders.map((order: any) => (
                      <div 
                        key={order.id}
                        className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-600"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-3 h-3 rounded-full bg-blue-400" />
                          <div>
                            <p className="text-white font-medium">Order #{order.number}</p>
                            <p className="text-slate-400 text-sm">
                              {new Date(order.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-green-400">${order.total}</p>
                          <Badge variant="secondary" className="bg-blue-600 text-white">
                            {order.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-400 text-center py-8">No store purchases yet</p>
                )}
              </Card>

              <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
                <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
                  <MapPin className="w-6 h-6 mr-2" />
                  Shipping & Billing Info
                </h2>
                
                {wixProfile ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-white">Shipping Address</h3>
                      <div className="space-y-2 text-slate-300">
                        <p>{wixProfile.shipping?.address || 'Not set'}</p>
                        <p>{wixProfile.shipping?.city}, {wixProfile.shipping?.state} {wixProfile.shipping?.zip}</p>
                        <p>{wixProfile.shipping?.country}</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-white">Billing Address</h3>
                      <div className="space-y-2 text-slate-300">
                        <p>{wixProfile.billing?.address || 'Not set'}</p>
                        <p>{wixProfile.billing?.city}, {wixProfile.billing?.state} {wixProfile.billing?.zip}</p>
                        <p>{wixProfile.billing?.country}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-400 text-center py-8">No address information available</p>
                )}
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="referrals" className="mt-0">
            <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
                <Users className="w-6 h-6 mr-2" />
                Referral Program
              </h2>
              
              {wixReferrals ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-slate-800/50 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-white mb-2">Total Referrals</h3>
                      <p className="text-3xl font-bold text-blue-400">{wixReferrals.totalReferrals || 0}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-white mb-2">Earnings</h3>
                      <p className="text-3xl font-bold text-green-400">${wixReferrals.totalEarnings || '0.00'}</p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-4">
                      <h3 className="text-lg font-semibold text-white mb-2">Pending</h3>
                      <p className="text-3xl font-bold text-yellow-400">${wixReferrals.pendingEarnings || '0.00'}</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">Your Referral Link</h3>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={wixReferrals.referralUrl || 'Loading...'}
                        readOnly
                        className="flex-1 bg-slate-800/50 border border-slate-600 rounded-lg p-3 text-white"
                      />
                      <Button 
                        onClick={() => {
                          navigator.clipboard.writeText(wixReferrals.referralUrl || '');
                          toast({
                            title: "Copied!",
                            description: "Referral link copied to clipboard.",
                          });
                        }}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-center py-8">Loading referral information...</p>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default UserDashboard;