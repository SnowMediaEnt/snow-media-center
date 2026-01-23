import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  ArrowLeft,
  MessageCircle, 
  Clock, 
  Send,
  AlertCircle,
  CheckCircle2,
  XCircle,
  User,
  Mail,
  Shield
} from 'lucide-react';
import { useAdminTickets, AdminTicket } from '@/hooks/useAdminTickets';
import { formatDistanceToNow } from 'date-fns';

interface AdminSupportDashboardProps {
  onBack: () => void;
}

const AdminSupportDashboard = ({ onBack }: AdminSupportDashboardProps) => {
  const [view, setView] = useState<'list' | 'ticket'>('list');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const {
    tickets,
    messages,
    loading,
    unreadCount,
    fetchTicketMessages,
    sendAdminReply,
    updateTicketStatus
  } = useAdminTickets();

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);
  const ticketMessages = selectedTicketId ? messages[selectedTicketId] || [] : [];

  const filteredTickets = statusFilter === 'all' 
    ? tickets 
    : tickets.filter(t => t.status === statusFilter);

  // Hierarchical back button handling
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return;
      }
      
      // Handle back button - hierarchical exit from nested containers
      if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        
        // If viewing a ticket, go back to list first
        if (view === 'ticket') {
          setView('list');
          setSelectedTicketId(null);
          return;
        }
        
        // Otherwise exit to previous page
        onBack();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, onBack]);

  const handleViewTicket = async (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setView('ticket');
    await fetchTicketMessages(ticketId);
  };

  const handleSendReply = async () => {
    if (!selectedTicketId || !replyMessage.trim()) return;
    
    try {
      await sendAdminReply(selectedTicketId, replyMessage);
      setReplyMessage('');
    } catch (error) {
      console.error('Failed to send reply:', error);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!selectedTicketId) return;
    await updateTicketStatus(selectedTicketId, status);
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

  if (view === 'ticket' && selectedTicket) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Button 
              onClick={() => setView('list')} 
              variant="outline" 
              size="sm"
              className="bg-purple-600/20 hover:bg-purple-500/30 border-purple-400/50 text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Tickets
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{selectedTicket.subject}</h1>
              <div className="flex items-center gap-2 mt-1 text-sm text-slate-400">
                <User className="h-4 w-4" />
                <span>{selectedTicket.user_name || 'Unknown User'}</span>
                <Mail className="h-4 w-4 ml-2" />
                <span>{selectedTicket.user_email}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Ticket Info Sidebar */}
            <Card className="bg-slate-800/50 border-slate-700 lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-white text-lg">Ticket Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-slate-400">Status</label>
                  <Select 
                    value={selectedTicket.status} 
                    onValueChange={handleStatusChange}
                  >
                    <SelectTrigger className="bg-slate-700 border-slate-600 text-white mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm text-slate-400">Priority</label>
                  <Badge variant="outline" className="text-slate-300 mt-1 block w-fit">
                    {selectedTicket.priority}
                  </Badge>
                </div>

                <div>
                  <label className="text-sm text-slate-400">Created</label>
                  <p className="text-white text-sm mt-1">
                    {formatDistanceToNow(new Date(selectedTicket.created_at), { addSuffix: true })}
                  </p>
                </div>

                <div>
                  <label className="text-sm text-slate-400">Last Message</label>
                  <p className="text-white text-sm mt-1">
                    {formatDistanceToNow(new Date(selectedTicket.last_message_at), { addSuffix: true })}
                  </p>
                </div>

                <div>
                  <label className="text-sm text-slate-400">Ticket ID</label>
                  <p className="text-slate-400 text-xs mt-1 font-mono">
                    {selectedTicket.id}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Messages */}
            <Card className="bg-slate-800/50 border-slate-700 lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" />
                  Conversation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-80 pr-4">
                  <div className="space-y-4">
                    {ticketMessages.map((message) => (
                      <div key={message.id} className={`p-4 rounded-lg ${
                        message.sender_type === 'admin' 
                          ? 'bg-purple-600/20 ml-8' 
                          : 'bg-slate-700/50 mr-8'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={message.sender_type === 'admin' ? 'default' : 'secondary'}>
                            {message.sender_type === 'admin' ? (
                              <><Shield className="h-3 w-3 mr-1" /> Admin</>
                            ) : (
                              <><User className="h-3 w-3 mr-1" /> User</>
                            )}
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
                    placeholder="Type your reply as admin..."
                    rows={4}
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                  <Button 
                    onClick={handleSendReply}
                    disabled={!replyMessage.trim() || loading}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Admin Reply
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button 
              onClick={onBack} 
              variant="outline" 
              size="sm"
              className="bg-purple-600/20 hover:bg-purple-500/30 border-purple-400/50 text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Shield className="h-8 w-8 text-purple-400" />
                Admin Support Dashboard
              </h1>
              {unreadCount > 0 && (
                <p className="text-purple-300 text-sm mt-1">
                  {unreadCount} ticket{unreadCount !== 1 ? 's' : ''} need attention
                </p>
              )}
            </div>
          </div>
          
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 bg-slate-800 border-slate-600 text-white">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tickets</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4">
          {filteredTickets.map((ticket) => (
            <Card 
              key={ticket.id}
              className={`bg-slate-800/50 border-slate-700 cursor-pointer hover:bg-slate-700/50 transition-colors ${
                ticket.admin_has_unread ? 'ring-2 ring-purple-500' : ''
              }`}
              onClick={() => handleViewTicket(ticket.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {ticket.admin_has_unread && (
                        <Badge className="bg-purple-600 text-white">New</Badge>
                      )}
                      <Badge className={getStatusColor(ticket.status)}>
                        {getStatusIcon(ticket.status)}
                        <span className="ml-1 capitalize">{ticket.status.replace('_', ' ')}</span>
                      </Badge>
                      <Badge variant="outline" className="text-slate-300">
                        {ticket.priority}
                      </Badge>
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-1">
                      {ticket.subject}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-slate-400">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {ticket.user_name || ticket.user_email}
                      </span>
                      <span>
                        Created {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                      </span>
                      <span>
                        Updated {formatDistanceToNow(new Date(ticket.last_message_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {filteredTickets.length === 0 && !loading && (
            <div className="text-center py-12">
              <MessageCircle className="h-12 w-12 mx-auto text-slate-500 mb-4" />
              <h3 className="text-xl font-semibold text-slate-300 mb-2">No Tickets Found</h3>
              <p className="text-slate-500">
                {statusFilter === 'all' 
                  ? 'No support tickets have been created yet.' 
                  : `No tickets with status "${statusFilter}".`}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminSupportDashboard;
