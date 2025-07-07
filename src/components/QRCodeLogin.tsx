import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, RefreshCw, QrCode } from 'lucide-react';
import QRCode from 'qrcode';

interface QRCodeLoginProps {
  onSuccess: () => void;
}

const QRCodeLogin = ({ onSuccess }: QRCodeLoginProps) => {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [loginToken, setLoginToken] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const generateQRCode = async () => {
    setLoading(true);
    try {
      // Generate a unique token for this QR code session
      const token = crypto.randomUUID();
      setLoginToken(token);

      // Create the QR login session in the database
      const { error: sessionError } = await supabase
        .from('qr_login_sessions')
        .insert({
          token: token,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes from now
          is_used: false
        });

      if (sessionError) {
        throw sessionError;
      }

      // Create the login URL with the token
      const loginUrl = `${window.location.origin}/qr-login?token=${token}`;
      
      // Generate QR code
      const qrDataUrl = await QRCode.toDataURL(loginUrl, {
        width: 200,
        margin: 2,
        color: {
          dark: '#1e293b',
          light: '#ffffff'
        }
      });
      
      setQrCodeUrl(qrDataUrl);
      
      // Start polling for authentication
      startPolling(token);
      
    } catch (error) {
      console.error('Error generating QR code:', error);
      toast({
        title: "QR Code Error",
        description: "Failed to generate QR code",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (token: string) => {
    const interval = setInterval(async () => {
      try {
        // Check if someone has authenticated with this token
        const { data, error } = await supabase
          .from('qr_login_sessions')
          .select('*')
          .eq('token', token)
          .eq('is_used', false)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.error('Polling error:', error);
          return;
        }

        if (data && data.user_id) {
          // Someone has authenticated, sign them in
          clearInterval(interval);
          
          // Get the user's session
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          
          if (!sessionError && sessionData.session) {
            toast({
              title: "Success!",
              description: "You've been signed in via QR code",
            });
            onSuccess();
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000); // Poll every 2 seconds

    // Clean up after 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      toast({
        title: "QR Code Expired",
        description: "Please generate a new QR code to continue",
        variant: "destructive",
      });
    }, 300000);
  };

  useEffect(() => {
    generateQRCode();
  }, []);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <QrCode className="w-8 h-8 mx-auto mb-2 text-blue-400" />
        <h3 className="text-lg font-semibold text-white mb-2">QR Code Login</h3>
        <p className="text-sm text-blue-200">
          Scan with your phone to sign in instantly
        </p>
      </div>

      <Card className="bg-white/5 border-white/10 p-6 text-center">
        {loading ? (
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            <p className="text-white/60">Generating QR code...</p>
          </div>
        ) : qrCodeUrl ? (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg inline-block">
              <img 
                src={qrCodeUrl} 
                alt="QR Code for login" 
                className="w-48 h-48 mx-auto"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-white/80">
                Scan this QR code with your phone's camera
              </p>
              <p className="text-xs text-white/60">
                QR code expires in 5 minutes
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      <Button 
        onClick={generateQRCode}
        disabled={loading}
        variant="outline"
        className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20"
      >
        <RefreshCw className="w-4 h-4 mr-2" />
        Generate New QR Code
      </Button>

      <div className="text-center">
        <p className="text-xs text-white/60">
          Make sure you're signed in on your phone first
        </p>
      </div>
    </div>
  );
};

export default QRCodeLogin;