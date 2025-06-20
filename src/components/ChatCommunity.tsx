
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send, User, MessageSquare } from 'lucide-react';

interface ChatCommunityProps {
  onBack: () => void;
}

const ChatCommunity = ({ onBack }: ChatCommunityProps) => {
  const [activeTab, setActiveTab] = useState<'admin' | 'community'>('admin');
  const [message, setMessage] = useState('');
  const [adminMessage, setAdminMessage] = useState('');

  const communityMessages = [
    { user: "TechUser2024", message: "Anyone know how to install Cinema HD?", time: "2 min ago" },
    { user: "StreamFan", message: "Check the Install Apps section, works great!", time: "5 min ago" },
    { user: "AndroidTVPro", message: "Josh added new tutorials today 🔥", time: "8 min ago" },
    { user: "MediaLover", message: "The new store update is amazing", time: "12 min ago" }
  ];

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-8">
          <Button 
            onClick={onBack}
            variant="outline" 
            size="lg"
            className="mr-6 bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Chat & Community</h1>
            <p className="text-xl text-blue-200">Connect with admin and community</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex mb-6">
          <Button
            onClick={() => setActiveTab('admin')}
            variant={activeTab === 'admin' ? 'default' : 'outline'}
            className={`mr-4 text-lg px-8 py-3 ${
              activeTab === 'admin' 
                ? 'bg-orange-600 hover:bg-orange-700' 
                : 'bg-transparent border-orange-500 text-orange-400 hover:bg-orange-600'
            }`}
          >
            <User className="w-5 h-5 mr-2" />
            Message Josh (Admin)
          </Button>
          <Button
            onClick={() => setActiveTab('community')}
            variant={activeTab === 'community' ? 'default' : 'outline'}
            className={`text-lg px-8 py-3 ${
              activeTab === 'community' 
                ? 'bg-green-600 hover:bg-green-700' 
                : 'bg-transparent border-green-500 text-green-400 hover:bg-green-600'
            }`}
          >
            <MessageSquare className="w-5 h-5 mr-2" />
            Community Chat
          </Button>
        </div>

        {/* Admin Chat */}
        {activeTab === 'admin' && (
          <Card className="bg-gradient-to-br from-orange-900/30 to-slate-900 border-orange-700 p-6">
            <h3 className="text-2xl font-bold text-white mb-4">Send Private Message to Josh</h3>
            <p className="text-orange-200 mb-6">
              Get direct support from the admin. Messages are private and secure.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-white font-semibold mb-2">Subject</label>
                <Input 
                  placeholder="What do you need help with?"
                  className="bg-slate-800 border-slate-600 text-white text-lg py-3"
                />
              </div>
              
              <div>
                <label className="block text-white font-semibold mb-2">Message</label>
                <Textarea 
                  value={adminMessage}
                  onChange={(e) => setAdminMessage(e.target.value)}
                  placeholder="Describe your issue or question in detail..."
                  className="bg-slate-800 border-slate-600 text-white min-h-32 text-lg"
                />
              </div>
              
              <Button className="bg-orange-600 hover:bg-orange-700 text-white text-lg px-8 py-3">
                <Send className="w-5 h-5 mr-2" />
                Send to Josh
              </Button>
            </div>
          </Card>
        )}

        {/* Community Chat */}
        {activeTab === 'community' && (
          <div className="space-y-6">
            <Card className="bg-gradient-to-br from-green-900/30 to-slate-900 border-green-700 p-6">
              <h3 className="text-2xl font-bold text-white mb-4">Community Chat</h3>
              
              <div className="bg-slate-800 rounded-lg p-4 mb-4 max-h-80 overflow-y-auto">
                {communityMessages.map((msg, index) => (
                  <div key={index} className="mb-4 last:mb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-green-400 font-semibold">{msg.user}</span>
                      <span className="text-slate-400 text-sm">{msg.time}</span>
                    </div>
                    <p className="text-white">{msg.message}</p>
                  </div>
                ))}
              </div>
              
              <div className="flex gap-4">
                <Input 
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message..."
                  className="bg-slate-800 border-slate-600 text-white text-lg py-3 flex-1"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      // Handle send message
                      setMessage('');
                    }
                  }}
                />
                <Button className="bg-green-600 hover:bg-green-700 text-white px-6 py-3">
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatCommunity;
