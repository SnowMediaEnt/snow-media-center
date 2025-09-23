-- Create support tickets table
CREATE TABLE public.support_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_message_at timestamp with time zone NOT NULL DEFAULT now(),
  user_has_unread boolean NOT NULL DEFAULT false,
  admin_has_unread boolean NOT NULL DEFAULT true
);

-- Create support messages table
CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'admin')),
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create AI conversations table
CREATE TABLE public.ai_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_message_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create AI messages table
CREATE TABLE public.ai_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'assistant')),
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for support_tickets
CREATE POLICY "Users can view their own tickets" 
ON public.support_tickets 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own tickets" 
ON public.support_tickets 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tickets" 
ON public.support_tickets 
FOR UPDATE 
USING (auth.uid() = user_id);

-- RLS policies for support_messages
CREATE POLICY "Users can view messages in their tickets" 
ON public.support_messages 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.support_tickets 
  WHERE id = support_messages.ticket_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Users can create messages in their tickets" 
ON public.support_messages 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.support_tickets 
  WHERE id = support_messages.ticket_id 
  AND user_id = auth.uid()
));

-- RLS policies for AI conversations
CREATE POLICY "Users can manage their own AI conversations" 
ON public.ai_conversations 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- RLS policies for AI messages
CREATE POLICY "Users can view messages in their conversations" 
ON public.ai_messages 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.ai_conversations 
  WHERE id = ai_messages.conversation_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Users can create messages in their conversations" 
ON public.ai_messages 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.ai_conversations 
  WHERE id = ai_messages.conversation_id 
  AND user_id = auth.uid()
));

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_conversations_updated_at
BEFORE UPDATE ON public.ai_conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to update last_message_at and unread status
CREATE OR REPLACE FUNCTION public.update_ticket_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.support_tickets 
  SET 
    last_message_at = NEW.created_at,
    updated_at = now(),
    user_has_unread = CASE 
      WHEN NEW.sender_type = 'admin' THEN true 
      ELSE user_has_unread 
    END,
    admin_has_unread = CASE 
      WHEN NEW.sender_type = 'user' THEN true 
      ELSE false 
    END
  WHERE id = NEW.ticket_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update AI conversation last_message_at
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.ai_conversations 
  SET 
    last_message_at = NEW.created_at,
    updated_at = now()
  WHERE id = NEW.conversation_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for message updates
CREATE TRIGGER support_message_update_ticket
AFTER INSERT ON public.support_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_ticket_on_message();

CREATE TRIGGER ai_message_update_conversation
AFTER INSERT ON public.ai_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_on_message();

-- Function to limit AI conversations per user (keep only 5 most recent)
CREATE OR REPLACE FUNCTION public.limit_ai_conversations()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete old conversations if user has more than 5
  DELETE FROM public.ai_conversations 
  WHERE user_id = NEW.user_id 
  AND id NOT IN (
    SELECT id FROM public.ai_conversations 
    WHERE user_id = NEW.user_id 
    ORDER BY last_message_at DESC 
    LIMIT 5
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to limit AI conversations
CREATE TRIGGER limit_ai_conversations_trigger
AFTER INSERT ON public.ai_conversations
FOR EACH ROW
EXECUTE FUNCTION public.limit_ai_conversations();