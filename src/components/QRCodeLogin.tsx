import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, RefreshCw, QrCode, AlertTriangle } from 'lucide-react';
import QRCode from 'qrcode';

interface QRCodeLoginProps {
  onSuccess: () => void;
}

const QRCodeLogin = ({ onSuccess }: QRCodeLoginProps) => {
  const { t } = useTranslation();
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [loginToken, setLoginToken] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const generateQRCode = async () => {
    setLoading(true);
    try {
      // Generate cryptographically secure token
      let token: string;
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        token = crypto.randomUUID();
      } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        // Secure fallback using crypto.getRandomValues
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
      } else {
        // Final fallback - should rarely happen in modern browsers
        // Combine multiple entropy sources for better randomness
        const timestamp = Date.now().toString(36);
        const performance = typeof window !== 'undefined' && window.performance 
          ? Math.floor(window.performance.now() * 1000).toString(36) 
          : '';
        const random1 = Math.random().toString(36).substring(2, 15);
        const random2 = Math.random().toString(36).substring(2, 15);
        token = `qr_${timestamp}${performance}${random1}${random2}`;
        console.warn('[Security] Using weak random fallback for token generation - crypto API not available');
      }
      
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
        console.error('Database error:', sessionError);
        throw new Error(`Database error: ${sessionError.message}`);
      }

      // For Android TV STB app - QR just contains the token, no URL needed
      const loginUrl = `snowmedia-qr-login:${token}`;
      
      console.log('Generated QR token:', loginUrl);

      // Generate QR code with better error handling
      const qrDataUrl = await QRCode.toDataURL(loginUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1e293b',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      });
      
      setQrCodeUrl(qrDataUrl);
      
      // Start polling for authentication
      startPolling(token);
      
      toast({
        title: t('auth.qrCode.generatedTitle'),
        description: t('auth.qrCode.generatedDesc'),
      });
      
    } catch (error) {
      console.error('Error generating QR code:', error);
      const errorMessage = error instanceof Error ? error.message : t('auth.qrCode.unknownError');
      toast({
        title: t('auth.qrCode.errorTitle'),
        description: t('auth.qrCode.errorDesc', { error: errorMessage }),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (token: string) => {
    const interval = setInterval(async () => {
      try {
        // Check via SECURITY DEFINER RPC (raw rows are no longer publicly readable)
        const { data: rows, error } = await supabase
          .rpc('get_qr_session', { p_token: token });

        const data = Array.isArray(rows) ? rows[0] : null;

        if (error) {
          console.error('Polling error:', error);
          return;
        }

        if (data && data.user_id && !data.is_used) {
          // Someone has authenticated, sign them in
          clearInterval(interval);
          
          // Get the user's session
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          
          if (!sessionError && sessionData.session) {
            toast({
              title: t('auth.qrCode.signedInTitle'),
              description: t('auth.qrCode.signedInDesc'),
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
        title: t('auth.qrCode.expiredTitle'),
        description: t('auth.qrCode.expiredDesc'),
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
        <h3 className="text-lg font-semibold text-white mb-2">{t('auth.qrCode.title')}</h3>
        <p className="text-sm text-blue-200">
          {t('auth.qrCode.subtitle')}
        </p>
      </div>

      <Card className="bg-white/5 border-white/10 p-6 text-center">
        {loading ? (
          <div className="flex flex-col items-center space-y-4 py-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            <p className="text-white/60">{t('auth.qrCode.generating')}</p>
          </div>
        ) : qrCodeUrl ? (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg inline-block">
              <img 
                src={qrCodeUrl} 
                alt={t('auth.qrCode.imageAlt')} 
                className="w-64 h-64 mx-auto"
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-white/80">
                {t('auth.qrCode.scanHint')}
              </p>
              <p className="text-xs text-white/60">
                {t('auth.qrCode.expiresNote')}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-4 py-8">
            <AlertTriangle className="w-8 h-8 text-yellow-400" />
            <p className="text-yellow-200 text-center">
              {t('auth.qrCode.notGenerated')}
            </p>
          </div>
        )}
      </Card>

      <Button 
        onClick={generateQRCode}
        disabled={loading}
        variant="outline"
        className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20"
      >
        <RefreshCw className="w-4 h-4 mr-2" />
        {t('auth.qrCode.generateBtn')}
      </Button>

      <div className="text-center">
        <p className="text-xs text-white/60">
          {t('auth.qrCode.footer')}
        </p>
      </div>
    </div>
  );
};

export default QRCodeLogin;