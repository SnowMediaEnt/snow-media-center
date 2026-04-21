import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, KeyRound } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * SsoConsume — landing page for magic links coming from snowmedia.com
 *
 * Two URL shapes are supported:
 *
 * 1) Direct Supabase magic link (token_hash in query):
 *    /sso?token_hash=abc123&type=magiclink
 *    We call supabase.auth.verifyOtp to exchange it for a session.
 *
 * 2) Standard Supabase callback fragment:
 *    /sso#access_token=...&refresh_token=...
 *    We call supabase.auth.setSession with the parsed values.
 */
const SsoConsume = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your sign-in link…');

  useEffect(() => {
    const consume = async () => {
      try {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));

        // Shape 2: hash contains access_token + refresh_token
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          setStatus('success');
          setMessage('Signed in successfully. Redirecting…');
          toast({ title: 'Welcome back!', description: 'You are signed in.' });
          setTimeout(() => navigate('/', { replace: true }), 1500);
          return;
        }

        // Shape 1: token_hash + type in query
        const tokenHash = params.get('token_hash') ?? params.get('token');
        const type = (params.get('type') ?? 'magiclink') as
          | 'magiclink'
          | 'signup'
          | 'recovery'
          | 'email_change'
          | 'email';

        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (error) throw error;
          setStatus('success');
          setMessage('Signed in successfully. Redirecting…');
          toast({ title: 'Welcome back!', description: 'You are signed in.' });
          setTimeout(() => navigate('/', { replace: true }), 1500);
          return;
        }

        // No usable token found
        throw new Error('No sign-in token found in the link.');
      } catch (err) {
        console.error('[SsoConsume] Failed to consume magic link:', err);
        setStatus('error');
        setMessage(
          err instanceof Error
            ? err.message
            : 'We could not sign you in with that link. It may have expired or already been used.'
        );
      }
    };

    consume();
  }, [navigate, toast]);

  const Icon =
    status === 'loading' ? Loader2 : status === 'success' ? CheckCircle : XCircle;
  const iconColor =
    status === 'loading'
      ? 'text-blue-400 animate-spin'
      : status === 'success'
      ? 'text-green-400'
      : 'text-red-400';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <Card className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 w-full max-w-md">
        <CardContent className="p-8 text-center space-y-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <KeyRound className="w-7 h-7 text-blue-400" />
            <h1 className="text-2xl font-bold text-white">Snow Media Sign-In</h1>
          </div>

          <div className="flex flex-col items-center space-y-4">
            <Icon className={`w-16 h-16 ${iconColor}`} />
            <p className="text-white/90 text-base">{message}</p>
          </div>

          {status === 'error' && (
            <div className="space-y-3">
              <Button
                onClick={() => navigate('/auth')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Go to Sign In
              </Button>
              <p className="text-xs text-white/60">
                Sign-in links are single-use and expire after 1 hour. Request a new one
                from snowmedia.com if needed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SsoConsume;
