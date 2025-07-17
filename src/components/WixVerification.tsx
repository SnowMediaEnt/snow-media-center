import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useWixIntegration } from '@/hooks/useWixIntegration';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

const WixVerification = () => {
  const [email, setEmail] = useState('');
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [connectionResult, setConnectionResult] = useState<any>(null);
  const { verifyWixMember, testConnection, loading } = useWixIntegration();
  const { toast } = useToast();

  const handleVerify = async () => {
    if (!email) {
      toast({
        title: "Email required",
        description: "Please enter an email to verify",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await verifyWixMember(email);
      setVerificationResult(result);
      
      toast({
        title: result.exists ? "Wix member found!" : "No Wix member found",
        description: result.exists 
          ? `Found member: ${result.member?.name}` 
          : "This email is not associated with a Wix account",
        variant: result.exists ? "default" : "destructive",
      });
    } catch (error) {
      console.error('Verification error:', error);
      toast({
        title: "Verification failed",
        description: "Could not verify Wix integration. Check the function logs.",
        variant: "destructive",
      });
    }
  };

  const handleTestConnection = async () => {
    try {
      const result = await testConnection();
      setConnectionResult(result);
      
      toast({
        title: result.connected ? "Wix connected!" : "Wix connection failed",
        description: result.connected 
          ? `Found ${result.totalMembers} members in database` 
          : result.error || "Could not connect to Wix",
        variant: result.connected ? "default" : "destructive",
      });
    } catch (error) {
      console.error('Connection test error:', error);
      toast({
        title: "Connection test failed",
        description: "Could not test Wix connection. Check the function logs.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6 max-w-md mx-auto">
      <h3 className="text-2xl font-bold text-white mb-4">Test Wix Integration</h3>
      
      <div className="space-y-4">
        <Button 
          onClick={handleTestConnection} 
          disabled={loading}
          className="w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Testing...
            </>
          ) : (
            'Test Wix Connection'
          )}
        </Button>

        {connectionResult && (
          <div className="mt-4 p-4 bg-white/10 rounded-lg border border-white/20">
            <div className="flex items-center mb-2">
              {connectionResult.connected ? (
                <CheckCircle className="w-5 h-5 text-green-400 mr-2" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400 mr-2" />
              )}
              <span className="text-white font-medium">
                {connectionResult.connected ? 'Connected' : 'Connection Failed'}
              </span>
            </div>
            
            {connectionResult.connected && (
              <div className="text-white/80 text-sm">
                <p><strong>Total Members:</strong> {connectionResult.totalMembers}</p>
                <p><strong>Status:</strong> {connectionResult.message}</p>
              </div>
            )}
            
            {!connectionResult.connected && (
              <div className="text-white/80 text-sm">
                <p><strong>Error:</strong> {connectionResult.error}</p>
                {connectionResult.suggestions && (
                  <div className="mt-2">
                    <p><strong>Suggestions:</strong></p>
                    <ul className="list-disc pl-5 mt-1">
                      {connectionResult.suggestions.map((suggestion: string, index: number) => (
                        <li key={index}>{suggestion}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {connectionResult.statusCode === 403 && (
                  <div className="mt-2 p-2 bg-red-500/20 rounded border border-red-500/30">
                    <p className="text-red-300 font-semibold">⚠️ Permission Issue Detected</p>
                    <p className="text-red-200 text-xs mt-1">
                      Your API key needs "Read Members" permissions enabled in the Wix API Keys Manager.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <Input
          type="email"
          placeholder="Enter email to verify"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
        />
        
        <Button 
          onClick={handleVerify} 
          disabled={loading}
          className="w-full bg-white text-purple-800 hover:bg-white/90"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify Wix Member'
          )}
        </Button>

        {verificationResult && (
          <div className="mt-4 p-4 bg-white/10 rounded-lg border border-white/20">
            <div className="flex items-center mb-2">
              {verificationResult.exists ? (
                <CheckCircle className="w-5 h-5 text-green-400 mr-2" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400 mr-2" />
              )}
              <span className="text-white font-medium">
                {verificationResult.exists ? 'Member Found' : 'No Member Found'}
              </span>
            </div>
            
            {verificationResult.member && (
              <div className="text-white/80 text-sm">
                <p><strong>Name:</strong> {verificationResult.member.name}</p>
                <p><strong>Email:</strong> {verificationResult.member.email}</p>
                <p><strong>ID:</strong> {verificationResult.member.id}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default WixVerification;