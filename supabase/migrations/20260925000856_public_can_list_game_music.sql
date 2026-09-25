-- The MP3s are public assets, but Supabase does not expose folder listings
-- without a SELECT policy. Reveal filenames only in the two game-audio
-- folders; this grants no access to other media-assets or knowledge-base files.
create policy "Public can list game music"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'media-assets'
  and storage.allow_only_operation('object.list')
  and (storage.foldername(name))[1] = 'game-audio'
  and (storage.foldername(name))[2] in ('adult', 'kids')
  and lower(storage.extension(name)) = 'mp3'
);
