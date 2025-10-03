import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft, 
  Plus, 
  MessageCircle, 
  Clock, 
  Send,
  AlertCircle,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { formatDistanceToNow } from 'date-fns';

interface SupportTicketSystemProps {
  onBack: () => void;
}

const SupportTicketSystem = ({ onBack }: SupportTicketSystemProps) => {
  const [view, setView] = useState<'list' | 'ticket' | 'create'>('list');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [replyMessage, setReplyMessage] = useState('');

  const {
    tickets,
    messages,
    loading,
    fetchTicketMessages,
    createTicket,
    sendMessage
  } = useSupportTickets();

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);
  const ticketMessages = selectedTicketId ? messages[selectedTicketId] || [] : [];

  const handleCreateTicket = async () => {
    if (!newSubject.trim() || !newMessage.trim()) return;
    
    try {
      const ticketId = await createTicket(newSubject, newMessage);
      setNewSubject('');
      setNewMessage('');
      setSelectedTicketId(ticketId);
      setView('ticket');
      await fetchTicketMessages(ticketId);
    } catch (error) {
      console.error('Failed to create ticket:', error);
    }
  };

  const handleSendReply = async () => {
    if (!selectedTicketId || !replyMessage.trim()) return;
    
    try {
      await sendMessage(selectedTicketId, replyMessage);
      setReplyMessage('');
    } catch (error) {
      console.error('Failed to send reply:', error);
    }
  };

  const handleViewTicket = async (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setView('ticket');
    await fetchTicketMessages(ticketId);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'resolved':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'closed':
        return <XCircle className="h-4 w-4 text-gray-500" />;
      default:
        return <MessageCircle className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-yellow-100 text-yellow-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'resolved':
        return 'bg-green-100 text-green-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (view === 'create') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Button 
              onClick={() => setView('list')} 
              variant="outline" 
              size="sm"
              className="bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Tickets
            </Button>
            <h1 className="text-3xl font-bold">Create Support Ticket</h1>
          </div>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">New Support Request</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">
                  Subject
                </label>
                <Input
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Brief description of your issue..."
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">
                  Message
                </label>
                <Textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Describe your issue in detail..."
                  rows={8}
                  className="bg-slate-700 border-slate-600 text-white"
                />
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleCreateTicket}
                  disabled={!newSubject.trim() || !newMessage.trim() || loading}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {loading ? "Creating..." : "Create Ticket"}
                </Button>
                <Button 
                  onClick={() => setView('list')}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (view === 'ticket' && selectedTicket) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Button 
              onClick={() => setView('list')} 
              variant="outline" 
              size="sm"
              className="bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Tickets
            </Button>
            <h1 className="text-3xl font-bold">{selectedTicket.subject}</h1>
            <Badge className={getStatusColor(selectedTicket.status)}>
              {getStatusIcon(selectedTicket.status)}
              <span className="ml-1 capitalize">{selectedTicket.status.replace('_', ' ')}</span>
            </Badge>
          </div>

          <div className="grid gap-6">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" />
                  Messages
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-96 pr-4">
                  <div className="space-y-4">
                    {ticketMessages.map((message) => (
                      <div key={message.id} className={`p-4 rounded-lg ${
                        message.sender_type === 'user' 
                          ? 'bg-blue-600/20 ml-8' 
                          : 'bg-slate-700/50 mr-8'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={message.sender_type === 'user' ? 'default' : 'secondary'}>
                            {message.sender_type === 'user' ? 'You' : 'Snow Media Support'}
                          </Badge>
                          <span className="text-xs text-slate-400">
                            {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-slate-200 whitespace-pre-wrap">{message.message}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                
                <Separator className="my-4 bg-slate-600" />
                
                <div className="space-y-3">
                  <Textarea
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder="Type your reply..."
                    rows={4}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <Button 
                    onClick={handleSendReply}
                    disabled={!replyMessage.trim() || loading}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Reply
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button 
              onClick={onBack} 
              variant="outline" 
              size="sm"
              className="bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-3xl font-bold">Support Tickets</h1>
          </div>
          <Button 
            onClick={() => setView('create')}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Ticket
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tickets.map((ticket) => (
            <Card 
              key={ticket.id}
              className={`bg-slate-800/50 border-slate-700 cursor-pointer hover:bg-slate-700/50 transition-colors ${
                ticket.user_has_unread ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={() => handleViewTicket(ticket.id)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="text-white text-lg line-clamp-2">
                    {ticket.subject}
                  </CardTitle>
                  {ticket.user_has_unread && (
                    <Badge className="bg-blue-600 text-white ml-2">New</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={getStatusColor(ticket.status)}>
                    {getStatusIcon(ticket.status)}
                    <span className="ml-1 capitalize">{ticket.status.replace('_', ' ')}</span>
                  </Badge>
                  <Badge variant="outline" className="text-slate-300">
                    {ticket.priority}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-400">
                  <p>Created: {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}</p>
                  <p>Last updated: {formatDistanceToNow(new Date(ticket.last_message_at), { addSuffix: true })}</p>
                </div>
              </CardContent>
            </Card>
          ))}

          {tickets.length === 0 && !loading && (
            <div className="col-span-full text-center py-12">
              <MessageCircle className="h-12 w-12 mx-auto text-slate-500 mb-4" />
              <h3 className="text-xl font-semibold text-slate-300 mb-2">No Support Tickets</h3>
              <p className="text-slate-500 mb-4">You haven't created any support tickets yet.</p>
              <Button 
                onClick={() => setView('create')}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Ticket
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupportTicketSystem;