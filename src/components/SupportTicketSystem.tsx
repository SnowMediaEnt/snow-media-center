import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SupportAttachment from '@/components/support/SupportAttachment';
import { useAttachmentComposer } from '@/components/support/useAttachmentComposer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

import { ArrowLeft, Plus, MessageCircle, Clock, Send, AlertCircle, CheckCircle2, XCircle, LogIn, Bot, Trash2, ImageIcon, Mic, Square } from 'lucide-react';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { supabase } from '@/integrations/supabase/client';

import { useAIConversations } from '@/hooks/useAIConversations';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useTVFocus, TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';

interface SupportTicketSystemProps {
  onBack: () => void;
}

const SupportTicketSystem = ({ onBack }: SupportTicketSystemProps) => {
  const [view, setView] = useState<'list' | 'ticket' | 'create' | 'ai-chat'>('list');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const attach = useAttachmentComposer();
  const [guestEmail, setGuestEmail] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [selectedAIConversationId, setSelectedAIConversationId] = useState<string | null>(null);
  const [aiNewMessage, setAiNewMessage] = useState('');
  const [aiReplyMessage, setAiReplyMessage] = useState('');
  const [accountPromptOpen, setAccountPromptOpen] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [pendingAccountEmail, setPendingAccountEmail] = useState('');


  const { user, signUp } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();



  const {
    tickets,
    messages,
    loading,
    fetchTicketMessages,
    createTicket,
    sendMessage,
    closeTicket,
    deleteTicket
  } = useSupportTickets(user);

  const selectedTicket = tickets.find(t => t.id === selectedTicketId);
  const ticketMessages = selectedTicketId ? messages[selectedTicketId] || [] : [];

  // AI conversations
  const {
    conversations: aiConversations,
    messages: aiMessages,
    loading: aiLoading,
    fetchConversationMessages: fetchAIMessages,
    createConversation: createAIConversation,
    sendMessage: sendAIMessage,
    deleteConversation: deleteAIConversation,
  } = useAIConversations();

  const selectedAIConversation = aiConversations.find(c => c.id === selectedAIConversationId);
  const aiConversationMessages = selectedAIConversationId ? aiMessages[selectedAIConversationId] || [] : [];

  const handleStartAIChat = async () => {
    if (!aiNewMessage.trim()) return;
    try {
      const title = aiNewMessage.slice(0, 50) + (aiNewMessage.length > 50 ? '...' : '');
      const id = await createAIConversation(title, aiNewMessage);
      setAiNewMessage('');
      setSelectedAIConversationId(id);
      setView('ai-chat');
      await fetchAIMessages(id);
    } catch (e) { console.error(e); }
  };

  const handleOpenAIChat = async (id: string) => {
    setSelectedAIConversationId(id);
    setView('ai-chat');
    await fetchAIMessages(id);
  };

  const handleSendAIReply = async () => {
    if (!selectedAIConversationId || !aiReplyMessage.trim()) return;
    try {
      await sendAIMessage(selectedAIConversationId, aiReplyMessage);
      setAiReplyMessage('');
    } catch (e) { console.error(e); }
  };

  const handleDeleteAIChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this AI conversation?')) {
      await deleteAIConversation(id);
    }
  };

  // Auto-scroll AI chat to latest message
  const aiMessagesEndRef = useRef<HTMLDivElement>(null);
  const aiScrollAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view === 'ai-chat') {
      requestAnimationFrame(() => {
        aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        const viewport = aiScrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    }
  }, [aiConversationMessages.length, selectedAIConversationId, view, aiLoading]);

  const ticketScrollAreaRef = useRef<HTMLDivElement>(null);

  /**
   * Page a message thread up or down with the D-pad. Returns true when the
   * viewport actually moved; false when it's already at the end (or there's
   * nothing to scroll), which lets the caller pass focus on to the next
   * control instead of trapping the user inside the thread.
   */
  const scrollThread = useCallback(
    (ref: React.RefObject<HTMLDivElement>, direction: -1 | 1): boolean => {
      const viewport = ref.current?.querySelector(
        '[data-radix-scroll-area-viewport]',
      ) as HTMLDivElement | null;
      if (!viewport) return false;

      const max = viewport.scrollHeight - viewport.clientHeight;
      if (max <= 1) return false; // thread fits on screen — nothing to scroll
      const current = viewport.scrollTop;
      // 1px slack: browsers report fractional scrollTop at the extremes.
      if (direction < 0 ? current <= 0 : current >= max - 1) return false;

      const step = viewport.clientHeight * 0.8; // keep a little overlap for context
      viewport.scrollTo({
        top: Math.max(0, Math.min(max, current + direction * step)),
        behavior: 'smooth',
      });
      return true;
    },
    [],
  );

  const emptyActionId = user ? 'empty-create-ticket' : 'empty-sign-in';
  const firstTicketId = tickets.length > 0 ? 'ticket-0' : emptyActionId;
  const firstAIHistoryId = aiConversations.length > 0 ? 'ai-history-0' : null;
  const lastTicketId = tickets.length > 0 ? `ticket-${tickets.length - 1}` : emptyActionId;

  const handleSystemBack = () => {
    if (view === 'ticket') {
      setView('list');
      setSelectedTicketId(null);
      return;
    }
    if (view === 'ai-chat') {
      setView('list');
      setSelectedAIConversationId(null);
      return;
    }
    if (view === 'create') {
      setView('list');
      return;
    }
    onBack();
  };

  const focusTicketField = (id: 'create-email' | 'create-subject' | 'create-message') => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-tv-focus-id="${id}"]`);
      el?.focus({ preventScroll: true });
      if (el) {
        try {
          const end = el.value?.length ?? 0;
          el.setSelectionRange(end, end);
        } catch { /* ignore */ }
      }
    });
  };

  const handleTicketFieldKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    nextId?: 'create-subject' | 'create-message'
  ) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    if (!nextId) {
      e.currentTarget.blur();
      return;
    }
    e.currentTarget.blur();
    focusTicketField(nextId);
  };

  const tvNavigation = useMemo<TVFocusNavigationMap>(() => {
    if (view === 'create') {
      const firstField = user ? 'create-subject' : 'create-email';
      return {
        'create-back': { down: firstField },
        'create-email': { up: 'create-back', down: 'create-subject' },
        'create-subject': { up: user ? 'create-back' : 'create-email', down: 'create-message' },
        'create-message': { up: 'create-subject', down: 'create-submit' },
        'create-submit': { up: 'create-message', right: 'create-cancel' },
        'create-cancel': { up: 'create-message', left: 'create-submit' },
      };
    }
    if (view === 'ticket') {
      return {
        'ticket-back': { right: selectedTicket?.status !== 'closed' && selectedTicket?.status !== 'resolved' ? 'ticket-close' : 'ticket-delete', down: 'ticket-messages' },
        'ticket-close': { left: 'ticket-back', right: 'ticket-delete', down: 'ticket-messages' },
        'ticket-delete': { left: selectedTicket?.status !== 'closed' && selectedTicket?.status !== 'resolved' ? 'ticket-close' : 'ticket-back', down: 'ticket-messages' },
        // Up/Down page through the history; once the thread hits an end,
        // focus continues on to the surrounding controls.
        'ticket-messages': {
          up: () => (scrollThread(ticketScrollAreaRef, -1) ? null : 'ticket-back'),
          down: () => (scrollThread(ticketScrollAreaRef, 1) ? null : 'ticket-reply'),
        },
        'ticket-reply': { up: 'ticket-messages', down: 'ticket-send' },
        'ticket-send': { up: 'ticket-reply' },
      };
    }
    if (view === 'ai-chat') {
      return {
        'ai-chat-back': { down: 'ai-chat-messages' },
        'ai-chat-messages': {
          up: () => (scrollThread(aiScrollAreaRef, -1) ? null : 'ai-chat-back'),
          down: () => (scrollThread(aiScrollAreaRef, 1) ? null : 'ai-chat-input'),
        },
        'ai-chat-input': { up: 'ai-chat-messages', right: 'ai-chat-send' },
        'ai-chat-send': { up: 'ai-chat-messages', left: 'ai-chat-input' },
      };
    }
    const map: TVFocusNavigationMap = {
      'list-back': { right: 'new-ticket', down: firstTicketId },
      'new-ticket': { left: 'list-back', down: 'ai-new-input' },
      'empty-create-ticket': { up: 'list-back', down: 'ai-new-input', right: 'new-ticket' },
      'empty-sign-in': { up: 'list-back', down: 'ai-new-input', right: 'new-ticket' },
      'ai-new-input': { up: lastTicketId, right: 'ai-new-send', down: firstAIHistoryId },
      'ai-new-send': { up: 'new-ticket', left: 'ai-new-input', down: firstAIHistoryId },
    };
    tickets.forEach((_, index) => {
      map[`ticket-${index}`] = {
        up: index === 0 ? 'list-back' : `ticket-${index - 1}`,
        down: index === tickets.length - 1 ? 'ai-new-input' : `ticket-${index + 1}`,
        right: index === 0 ? 'new-ticket' : undefined,
      };
    });
    aiConversations.forEach((_, index) => {
      map[`ai-history-${index}`] = {
        up: index === 0 ? 'ai-new-input' : `ai-history-${index - 1}`,
        down: index === aiConversations.length - 1 ? `ai-history-${index}` : `ai-history-${index + 1}`,
      };
    });
    return map;
  }, [aiConversations, firstAIHistoryId, firstTicketId, lastTicketId, selectedTicket?.status, scrollThread, tickets, user, view]);

  const tvFocus = useTVFocus({
    initialFocusId: view === 'create' ? 'create-back' : view === 'ticket' ? 'ticket-back' : view === 'ai-chat' ? 'ai-chat-back' : 'list-back',
    navigation: tvNavigation,
    onBack: handleSystemBack,
  });

  useEffect(() => {
    // Land focus on the Back button (not an input) so the on-screen keyboard
    // doesn't auto-open when entering Create / Ticket / AI-chat views.
    const id = view === 'create' ? 'create-back' : view === 'ticket' ? 'ticket-back' : view === 'ai-chat' ? 'ai-chat-back' : 'list-back';
    const timer = window.setTimeout(() => tvFocus.focusById(id, 'start'), 90);
    return () => window.clearTimeout(timer);
  }, [selectedAIConversationId, selectedTicketId, tvFocus.focusById, view]);

  // When the on-screen keyboard is dismissed (Android back), blur the active
  // text field so the webview can't immediately refocus it and reopen the OSK.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import('@capacitor/keyboard');
        const handle = await Keyboard.addListener('keyboardDidHide', () => {
          const el = document.activeElement as HTMLElement | null;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            el.blur();
          }
        });
        cleanup = () => { try { handle.remove(); } catch { /* ignore */ } };
      } catch { /* ignore — web or plugin missing */ }
    })();
    return () => { cleanup?.(); };
  }, []);


  const handleCreateTicket = async () => {
    // Demo mode has no ticket creation at all — belt and braces behind the
    // hidden entry points below.
    if (isDemo()) return;
    if (!newSubject.trim() || !newMessage.trim()) return;

    // Guest path: email optional (anonymous allowed)
    if (!user) {
      const email = guestEmail.trim();
      const hasEmail = email.length > 0;
      if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast({
          title: "Invalid email",
          description: "Please enter a valid email or leave it blank to send anonymously.",
          variant: "destructive",
        });
        return;
      }
      const contactLine = hasEmail
        ? `Contact email: ${email}`
        : 'Anonymous guest — no contact email provided.';
      const combinedMessage = `${newMessage}\n\n${contactLine}`;
      try {
        const { error } = await supabase.functions.invoke('report-channel', {
          body: {
            subject: `[Guest Ticket] ${newSubject}`,
            message: combinedMessage,
          },
        });
        if (error) throw error;
        toast({
          title: "Ticket sent",
          description: hasEmail
            ? "We received it. Create an account to get a reply in-app."
            : "We received your anonymous ticket. No reply will be possible.",
        });
        try { trackEvent('ticket_create', 'support', { subject_len: newSubject.length, has_user: false, guest_has_email: hasEmail }); } catch { void 0; }
        setNewSubject('');
        setNewMessage('');
        setView('list');
        if (hasEmail) {
          setPendingAccountEmail(email);
          setGuestEmail('');
          setAccountPromptOpen(true);
        } else {
          setGuestEmail('');
        }
      } catch (error) {
        console.error('Failed to send guest ticket:', error);
        toast({
          title: "Error",
          description: (error as Error)?.message || "Failed to send ticket. Please try again.",
          variant: "destructive",
        });
      }
      return;
    }


    try {
      const ticketId = await createTicket(newSubject, newMessage);
      try { trackEvent('ticket_create', 'support', { subject_len: newSubject.length, has_user: true }); } catch { void 0; }
      setNewSubject('');
      setNewMessage('');
      setSelectedTicketId(ticketId);
      setView('ticket');
      await fetchTicketMessages(ticketId);
    } catch (error) {
      console.error('Failed to create ticket:', error);
    }
  };

  const handleCreateAccountFromPrompt = async () => {
    if (!pendingAccountEmail || !accountPassword.trim() || accountPassword.length < 6) {
      toast({ title: 'Password too short', description: 'Use at least 6 characters.', variant: 'destructive' });
      return;
    }
    setCreatingAccount(true);
    try {
      const { error } = await signUp(pendingAccountEmail, accountPassword, accountName.trim() || undefined);
      if (error) throw error;
      toast({ title: 'Account created', description: 'Check your email to confirm, then sign in to see replies.' });
      setAccountPromptOpen(false);
      setAccountName('');
      setAccountPassword('');
      setPendingAccountEmail('');
    } catch (e: unknown) {
      console.error('Account create failed', e);
      toast({ title: 'Could not create account', description: e instanceof Error ? e.message : 'Try again later.', variant: 'destructive' });
    } finally {
      setCreatingAccount(false);
    }
  };


  const handleSendReply = async () => {
    if (!selectedTicketId) return;
    if (!replyMessage.trim() && !attach.draft) return;

    try {
      // Upload first, insert second. A row pointing at a file that never
      // uploaded would render as a permanently broken attachment; a file with
      // no row is just an orphan nobody sees.
      const uploaded = await attach.commit(selectedTicketId);
      await sendMessage(selectedTicketId, replyMessage, uploaded);
      setReplyMessage('');
    } catch (error) {
      console.error('Failed to send reply:', error);
      toast({
        title: 'Could not send that',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleViewTicket = async (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setView('ticket');
    await fetchTicketMessages(ticketId);
  };

  const handleCloseTicket = async () => {
    if (!selectedTicketId) return;
    try {
      await closeTicket(selectedTicketId);
      setView('list');
      setSelectedTicketId(null);
    } catch (error) {
      console.error('Failed to close ticket:', error);
    }
  };

  // Determine if ticket is "active" based on recent message activity (within last 24 hours)
  const isTicketActive = (ticket: { last_message_at: string; status: string }) => {
    if (ticket.status === 'closed' || ticket.status === 'resolved') return false;
    const lastMessage = new Date(ticket.last_message_at);
    const now = new Date();
    const hoursDiff = (now.getTime() - lastMessage.getTime()) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  };

  const getStatusIcon = (status: string, isActive?: boolean) => {
    if (isActive && status !== 'closed' && status !== 'resolved') {
      return <Clock className="h-4 w-4 text-green-500 animate-pulse" />;
    }
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

  const getStatusColor = (status: string, isActive?: boolean) => {
    if (isActive && status !== 'closed' && status !== 'resolved') {
      return 'bg-green-100 text-green-800';
    }
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
      <div ref={tvFocus.containerRef} className="tv-scroll-container tv-safe bg-neutral-900 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <BackButton onClick={() => setView('list')} label="Back to Tickets" data-tv-focus-id="create-back" />
            <h1 className="text-3xl font-bold">Create Support Ticket</h1>
          </div>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">New Support Request</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!user && (
                <>
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                    <strong>Not signed in</strong> — your ticket will be delivered, but you won't be able to receive replies in the app. Sign in to get responses.
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-300 mb-2 block">
                      Your email <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <Input
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      onKeyDown={(e) => handleTicketFieldKeyDown(e, 'create-subject')}
                      placeholder="you@example.com (leave blank to send anonymously)"
                      enterKeyHint="next"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      data-tv-focus-id="create-email"
                      data-tv-allow-enter="true"
                      className="bg-slate-700 border-slate-600 text-white "
                    />
                  </div>

                </>
              )}
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">
                  Subject
                </label>
                <Input
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  onKeyDown={(e) => handleTicketFieldKeyDown(e, 'create-message')}
                  enterKeyHint="next"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Brief description of your issue..."
                  data-tv-focus-id="create-subject"
                  data-tv-allow-enter="true"
                  className="bg-slate-700 border-slate-600 text-white "
                />

              </div>

              
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">
                  Message
                </label>
                <Textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => handleTicketFieldKeyDown(e)}
                  placeholder="Describe your issue in detail..."
                  rows={8}
                  enterKeyHint="done"
                  data-tv-focus-id="create-message"
                  data-tv-allow-enter="true"
                  className="bg-slate-700 border-slate-600 text-white "
                />
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleCreateTicket}
                  disabled={!newSubject.trim() || !newMessage.trim() || loading}
                  data-tv-focus-id="create-submit"
                  className="bg-blue-600 hover:bg-blue-700 "
                >
                  {loading ? "Creating..." : "Create Ticket"}
                </Button>
                <Button 
                  onClick={() => setView('list')}
                  variant="outline"
                  data-tv-focus-id="create-cancel"
                  className=""
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
    const ticketActive = isTicketActive(selectedTicket);
    return (
      <div ref={tvFocus.containerRef} className="tv-scroll-container tv-safe bg-neutral-900 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <BackButton onClick={() => setView('list')} label="Back to Tickets" data-tv-focus-id="ticket-back" />
              <h1 className="text-3xl font-bold">{selectedTicket.subject}</h1>
              <Badge className={getStatusColor(selectedTicket.status, ticketActive)}>
                {getStatusIcon(selectedTicket.status, ticketActive)}
                <span className="ml-1 capitalize">
                  {ticketActive ? 'Active' : selectedTicket.status.replace('_', ' ')}
                </span>
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {selectedTicket.status !== 'closed' && selectedTicket.status !== 'resolved' && (
                <Button 
                  onClick={handleCloseTicket}
                  variant="outline"
                  data-tv-focus-id="ticket-close"
                  className="bg-green-600/20 hover:bg-green-500/30 border-green-400/50 text-white "
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Close Ticket
                </Button>
              )}
              <Button
                onClick={async () => {
                  if (!selectedTicketId) return;
                  if (!confirm('Delete this ticket and all its messages? This cannot be undone.')) return;
                  await deleteTicket(selectedTicketId);
                  setSelectedTicketId(null);
                  setView('list');
                }}
                variant="outline"
                data-tv-focus-id="ticket-delete"
                className="bg-red-600/20 hover:bg-red-500/30 border-red-400/50 text-white "
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Ticket
              </Button>
            </div>
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
                <ScrollArea
                  ref={ticketScrollAreaRef}
                  data-tv-focus-id="ticket-messages"
                  aria-label="Ticket conversation history"
                  className="h-96 pr-4"
                >
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
                        {message.message?.trim() ? (
                          <p className="text-slate-200 whitespace-pre-wrap">{message.message}</p>
                        ) : null}
                        {message.attachment_path ? (
                          <SupportAttachment
                            path={message.attachment_path}
                            kind={message.attachment_kind}
                            mime={message.attachment_mime}
                            durationMs={message.attachment_ms}
                          />
                        ) : null}
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
                    data-tv-focus-id="ticket-reply"
                    className="bg-slate-700 border-slate-600 text-white "
                  />
                  {attach.draft ? (
                    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200">
                      {attach.draft.kind === 'audio'
                        ? <Mic className="h-4 w-4 text-brand-gold" />
                        : <ImageIcon className="h-4 w-4 text-brand-gold" />}
                      <span className="font-nunito">
                        {attach.draft.kind === 'audio' ? 'Voice message ready to send' : 'Screenshot ready to send'}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={attach.clearDraft}
                        data-tv-focus-id="ticket-attach-clear"
                        className="ml-auto text-slate-300"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={handleSendReply}
                      disabled={(!replyMessage.trim() && !attach.draft) || loading || attach.busy}
                      data-tv-focus-id="ticket-send"
                      className="bg-blue-600 hover:bg-blue-700 "
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send Reply
                    </Button>
                    {attach.canScreenshot && (
                      <Button
                        variant="outline"
                        onClick={() => void attach.takeScreenshot()}
                        disabled={attach.busy || attach.recordingMs !== null}
                        data-tv-focus-id="ticket-attach-shot"
                        className="border-slate-600 text-slate-200"
                      >
                        <ImageIcon className="h-4 w-4 mr-2" />
                        Attach screenshot
                      </Button>
                    )}
                    {attach.canRecord && (
                      attach.recordingMs === null ? (
                        <Button
                          variant="outline"
                          onClick={() => void attach.startRecording()}
                          disabled={attach.busy}
                          data-tv-focus-id="ticket-attach-voice"
                          className="border-slate-600 text-slate-200"
                        >
                          <Mic className="h-4 w-4 mr-2" />
                          Record a voice message
                        </Button>
                      ) : (
                        <>
                          <Button
                            onClick={() => void attach.stopRecording()}
                            data-tv-focus-id="ticket-attach-voice"
                            className="bg-red-600 hover:bg-red-700"
                          >
                            <Square className="h-4 w-4 mr-2" />
                            Stop ({Math.floor(attach.recordingMs / 1000)}s)
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={attach.cancelRecording}
                            className="text-slate-300"
                          >
                            Cancel
                          </Button>
                        </>
                      )
                    )}
                  </div>
                  {!attach.canRecord && attach.canScreenshot && (
                    <p className="text-xs font-nunito text-slate-400">
                      Voice messages need a microphone, which TV remotes don't share with apps —
                      you can still play any that support sends you.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'ai-chat' && selectedAIConversation) {
    return (
      <div ref={tvFocus.containerRef} className="tv-scroll-container tv-safe bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <BackButton onClick={() => { setView('list'); setSelectedAIConversationId(null); }} label="Back" data-tv-focus-id="ai-chat-back" />
            <h1 className="text-3xl font-bold line-clamp-1">{selectedAIConversation.title}</h1>
          </div>

          <Card className="bg-purple-950/40 border-purple-700/50">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Bot className="h-5 w-5" />
                AI Assistant
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea
                ref={aiScrollAreaRef}
                data-tv-focus-id="ai-chat-messages"
                aria-label="AI conversation history"
                className="h-96 pr-4"
              >
                <div className="space-y-4">
                  {aiConversationMessages.map((m) => (
                    <div
                      key={m.id}
                      className={`p-4 rounded-lg ${
                        m.sender_type === 'user'
                          ? 'bg-purple-600/20 ml-8'
                          : 'bg-slate-700/50 mr-8'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={m.sender_type === 'user' ? 'bg-purple-600 text-white' : 'bg-slate-600 text-white'}>
                          {m.sender_type === 'user' ? 'You' : 'AI Assistant'}
                        </Badge>
                        <span className="text-xs text-slate-400">
                          {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-slate-200 whitespace-pre-wrap">{m.message}</p>
                    </div>
                  ))}
                  <div ref={aiMessagesEndRef} />
                </div>
              </ScrollArea>

              <Separator className="my-4 bg-purple-700/50" />

              <div className="flex gap-2">
                <Input
                  value={aiReplyMessage}
                  onChange={(e) => setAiReplyMessage(e.target.value)}
                  placeholder="Type your message..."
                  data-tv-focus-id="ai-chat-input"
                  className="bg-slate-700 border-purple-600/50 text-white "
                  onKeyPress={(e) => e.key === 'Enter' && handleSendAIReply()}
                />
                <Button
                  onClick={handleSendAIReply}
                  disabled={!aiReplyMessage.trim() || aiLoading}
                  data-tv-focus-id="ai-chat-send"
                  className="bg-purple-600 hover:bg-purple-700 "
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div ref={tvFocus.containerRef} className="tv-scroll-container tv-safe bg-neutral-900 text-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <BackButton onClick={onBack} label="Back" data-tv-focus-id="list-back" />
            <h1 className="text-3xl font-bold">Tickets</h1>
          </div>
          {!isDemo() && (
            <Button 
              onClick={() => setView('create')}
              data-tv-focus-id="new-ticket"
              className="bg-blue-600 hover:bg-blue-700 "
            >
              <Plus className="h-4 w-4 mr-2" />
              New Ticket
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tickets.map((ticket, index) => {
            const ticketActive = isTicketActive(ticket);
            return (
              <Card 
                key={ticket.id}
                role="button"
                data-tv-focus-id={`ticket-${index}`}
                className={`bg-slate-800/50 border-slate-700 cursor-pointer hover:bg-slate-700/50 transition-all focus:outline-none  ${
                  ticket.user_has_unread ? 'ring-2 ring-blue-500' : ''
                }`}
                onClick={() => handleViewTicket(ticket.id)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-white text-lg line-clamp-2">
                      {ticket.subject}
                    </CardTitle>
                    <div className="flex items-center gap-2 ml-2">
                      {ticket.user_has_unread && (
                        <Badge className="bg-blue-600 text-white">New</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        tabIndex={-1}
                        data-tv-disabled="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this ticket? This cannot be undone.')) {
                            deleteTicket(ticket.id);
                          }
                        }}
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/20 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getStatusColor(ticket.status, ticketActive)}>
                      {getStatusIcon(ticket.status, ticketActive)}
                      <span className="ml-1 capitalize">
                        {ticketActive ? 'Active' : ticket.status.replace('_', ' ')}
                      </span>
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
            );
          })}

          {tickets.length === 0 && !loading && (
            <div className="col-span-full text-center py-12">
              <MessageCircle className="h-12 w-12 mx-auto text-slate-500 mb-4" />
              <h3 className="text-xl font-semibold text-slate-300 mb-2">No Support Tickets</h3>
              <p className="text-slate-500 mb-4">
                {user
                  ? "You haven't created any support tickets yet."
                  : "You can send a ticket without an account, but replies require signing in."}
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {!isDemo() && (
                  <Button
                    onClick={() => setView('create')}
                    data-tv-focus-id="empty-create-ticket"
                    className="bg-blue-600 hover:bg-blue-700 "
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {user ? 'Create Your First Ticket' : 'Send a Ticket'}
                  </Button>
                )}
                {!user && (
                  <Button
                    onClick={() => { try { sessionStorage.setItem('post_auth_view', 'support-tickets'); } catch { void 0; } navigate('/auth'); }}
                    variant="outline"
                    data-tv-focus-id="empty-sign-in"
                    className="bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white "
                  >
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign In
                  </Button>
                )}
              </div>

            </div>
          )}
        </div>

        {/* AI Chat History - purple section (saved history requires sign-in; anon users use the Support → AI tab for ephemeral chat) */}
        {user && <div className="mt-10">
          <Card className="bg-purple-950/40 border-purple-700/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white flex items-center gap-2">
                  <Bot className="h-5 w-5 text-purple-300" />
                  AI Chat History
                </CardTitle>
                <Badge variant="outline" className="text-purple-200 border-purple-400/50">
                  Last 5 saved
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Start new AI chat */}
              <div className="flex gap-2">
                <Input
                  value={aiNewMessage}
                  onChange={(e) => setAiNewMessage(e.target.value)}
                  placeholder="Ask the AI anything..."
                  data-tv-focus-id="ai-new-input"
                  className="bg-slate-700 border-purple-600/50 text-white "
                  onKeyPress={(e) => e.key === 'Enter' && handleStartAIChat()}
                />
                <Button
                  onClick={handleStartAIChat}
                  disabled={!aiNewMessage.trim() || aiLoading}
                  data-tv-focus-id="ai-new-send"
                  className="bg-purple-600 hover:bg-purple-700 "
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Chat
                </Button>
              </div>

              {/* Saved conversations */}
              {aiConversations.length === 0 ? (
                <p className="text-sm text-purple-200/70 text-center py-4">
                  No saved AI conversations yet. Start one above.
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {aiConversations.map((c, index) => (
                    <div
                      key={c.id}
                      role="button"
                      data-tv-focus-id={`ai-history-${index}`}
                      onClick={() => handleOpenAIChat(c.id)}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg bg-purple-900/30 border border-purple-700/40 hover:bg-purple-800/40 cursor-pointer transition-all focus:outline-none "
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white line-clamp-1">{c.title}</p>
                        <p className="text-xs text-purple-200/70">
                          Last message: {formatDistanceToNow(new Date(c.last_message_at), { addSuffix: true })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        tabIndex={-1}
                        data-tv-disabled="true"
                        onClick={(e) => handleDeleteAIChat(c.id, e)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/20 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>}
      </div>

      <Dialog open={accountPromptOpen} onOpenChange={setAccountPromptOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Create an account?</DialogTitle>
            <DialogDescription className="text-slate-300">
              We'll use <strong className="text-white">{pendingAccountEmail}</strong> so you can receive replies to your ticket in-app. Set a password (and optional name) below, or skip.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Name (optional)</label>
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Your name"
                autoComplete="off"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Password</label>
              <Input
                type="password"
                value={accountPassword}
                onChange={(e) => setAccountPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAccountPromptOpen(false);
                setAccountName('');
                setAccountPassword('');
                setPendingAccountEmail('');
              }}
              disabled={creatingAccount}
            >
              Skip
            </Button>
            <Button
              onClick={handleCreateAccountFromPrompt}
              disabled={creatingAccount || accountPassword.length < 6}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {creatingAccount ? 'Creating...' : 'Create account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

};

export default SupportTicketSystem;