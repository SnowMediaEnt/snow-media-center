-- Attachments on support tickets: screenshots and short voice notes, both ways.
--
-- One attachment per message, which matches how a chat actually works — you
-- send a picture, or you send a voice note. Multiple files per message would
-- need a child table and buys nothing here.

-- ── columns ────────────────────────────────────────────────────────────────
alter table public.support_messages
  add column if not exists attachment_path  text,
  add column if not exists attachment_kind  text,
  add column if not exists attachment_mime  text,
  add column if not exists attachment_bytes integer,
  -- Audio only. Lets the UI show "0:07" without downloading the file first.
  add column if not exists attachment_ms    integer;

-- Only the two kinds the app can produce and render. Anything else would be an
-- upload path nothing in the client knows how to display.
alter table public.support_messages
  drop constraint if exists support_messages_attachment_kind_check;
alter table public.support_messages
  add constraint support_messages_attachment_kind_check
  check (attachment_kind is null or attachment_kind in ('image', 'audio'));

-- `message` is NOT NULL, and an attachment-only message has no text. Rather
-- than loosen the column (every reader would then need a null check), the
-- client sends '' and this keeps that honest: a message must carry text OR a
-- file, never neither.
alter table public.support_messages
  drop constraint if exists support_messages_has_content_check;
alter table public.support_messages
  add constraint support_messages_has_content_check
  check (length(btrim(message)) > 0 or attachment_path is not null);

-- ── storage ────────────────────────────────────────────────────────────────
-- Private bucket. Files are reached through short-lived signed URLs, never
-- directly, so a leaked path is not a leaked screenshot.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  10485760,  -- 10 MB: a 4K PNG screenshot is ~2 MB, a 60s AAC voice note ~500 KB
  array['image/png','image/jpeg','image/webp','audio/mp4','audio/aac','audio/mpeg','audio/webm','audio/ogg']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = false;

-- Object paths are '<ticket_id>/<uuid>.<ext>'. The first path segment is the
-- ticket, which is what every policy below checks against.
create or replace function public.owns_support_ticket(ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = ticket and t.user_id = auth.uid()
  );
$$;

drop policy if exists "support attachments: read own or admin" on storage.objects;
create policy "support attachments: read own or admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'support-attachments'
    and (
      public.has_role(auth.uid(), 'admin')
      or public.owns_support_ticket(nullif(split_part(name, '/', 1), '')::uuid)
    )
  );

drop policy if exists "support attachments: write own or admin" on storage.objects;
create policy "support attachments: write own or admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'support-attachments'
    and (
      public.has_role(auth.uid(), 'admin')
      or public.owns_support_ticket(nullif(split_part(name, '/', 1), '')::uuid)
    )
  );

-- Deliberately NO update or delete policy for non-admins. A customer must not
-- be able to pull a screenshot back out of a ticket after support has read it,
-- and nothing in the app needs to overwrite an upload.
drop policy if exists "support attachments: admin delete" on storage.objects;
create policy "support attachments: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'support-attachments' and public.has_role(auth.uid(), 'admin'));
