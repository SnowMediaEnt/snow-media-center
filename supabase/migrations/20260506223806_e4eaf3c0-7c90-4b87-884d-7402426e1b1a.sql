-- Allow users to delete their own tickets/messages and admins to delete any
CREATE POLICY "Users can delete their own tickets"
ON public.support_tickets FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can delete any ticket"
ON public.support_tickets FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can delete messages in their tickets"
ON public.support_messages FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.support_tickets
  WHERE support_tickets.id = support_messages.ticket_id
    AND support_tickets.user_id = auth.uid()
));

CREATE POLICY "Admins can delete any message"
ON public.support_messages FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));