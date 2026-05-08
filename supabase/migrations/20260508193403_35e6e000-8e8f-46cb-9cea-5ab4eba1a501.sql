CREATE POLICY "Users can delete messages in their conversations"
ON public.ai_messages
FOR DELETE
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.ai_conversations
    WHERE ai_conversations.id = ai_messages.conversation_id
      AND ai_conversations.user_id = auth.uid()
  )
);