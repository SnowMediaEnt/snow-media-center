import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle, Smartphone } from 'lucide-react';

const QRLogin = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'expired'>('loading');
  const [message, setMessage] = useState('');
  
  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid QR code - no token provided');
      return;
    }

    handleQRLogin();
  }, [token]);

  const handleQRLogin = async () => {
    try {
      // Check if user is already authenticated
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        // Redirect to login with return URL
        const returnUrl = encodeURIComponent(`/qr-login?token=${token}`);
        window.location.href = `/auth?redirect=${returnUrl}`;
        return;
      }

      // Check if token exists and is valid
      const { data: tokenData, error: tokenError } = await supabase
        .from('qr_login_sessions')
        .select('*')
        .eq('token', token)
        .maybeSingle();

      if (tokenError) {
        console.error('Token query error:', tokenError);
        setStatus('error');
        setMessage('Error checking QR code validity');
        return;
      }

      if (!tokenData) {
        setStatus('expired');
        setMessage('QR code has expired or is invalid');
        return;
      }

      if (tokenData.is_used) {
        setStatus('error');
        setMessage('This QR code has already been used');
        return;
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        setStatus('expired');
        setMessage('QR code has expired');
        return;
      }

      // Update the token with the current user
      const { error: updateError } = await supabase
        .from('qr_login_sessions')
        .update({
          user_id: session.user.id,
          is_used: true
        })
        .eq('token', token);

      if (updateError) {
        throw updateError;
      }

      setStatus('success');
      setMessage('Successfully signed in! You can close this window.');
      
      toast({
        title: "Success!",
        description: "QR code authentication successful",
      });

      // Redirect to home after 3 seconds
      setTimeout(() => {
        navigate('/');
      }, 3000);

    } catch (error) {
      console.error('QR Login error:', error);
      setStatus('error');
      setMessage('An error occurred during authentication');
      
      toast({
        title: "Authentication Error",
        description: "Failed to process QR code login",
        variant: "destructive",
      });
    }
  };

  const getIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="w-16 h-16 animate-spin text-blue-400" />;
      case 'success':
        return <CheckCircle className="w-16 h-16 text-green-400" />;
      case 'error':
      case 'expired':
        return <XCircle className="w-16 h-16 text-red-400" />;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'loading':
        return 'text-white';
      case 'success':
        return 'text-green-400';
      case 'error':
      case 'expired':
        return 'text-red-400';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <Card className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 w-full max-w-md">
        <CardContent className="p-8 text-center space-y-6">
          <div className="flex items-center justify-center mb-4">
            <Smartphone className="w-8 h-8 text-blue-400 mr-2" />
            <h1 className="text-2xl font-bold text-white">QR Code Login</h1>
          </div>
          
          <div className="flex flex-col items-center space-y-4">
            {getIcon()}
            
            <div className="space-y-2">
              <h2 className={`text-lg font-semibold ${getStatusColor()}`}>
                {status === 'loading' && 'Authenticating...'}
                {status === 'success' && 'Success!'}
                {status === 'error' && 'Authentication Failed'}
                {status === 'expired' && 'QR Code Expired'}
              </h2>
              
              <p className="text-white/80 text-sm">
                {message}
              </p>
            </div>
          </div>

          {status === 'error' || status === 'expired' ? (
            <div className="space-y-4">
              <Button 
                onClick={() => navigate('/auth')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Go to Login Page
              </Button>
              
              <p className="text-xs text-white/60">
                Make sure you're signed in before scanning QR codes
              </p>
            </div>
          ) : status === 'success' ? (
            <div className="space-y-4">
              <Button 
                onClick={() => navigate('/')}
                className="w-full bg-green-600 hover:bg-green-700 text-white"
              >
                Go to Home
              </Button>
              
              <p className="text-xs text-white/60">
                Redirecting automatically in 3 seconds...
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default QRLogin;