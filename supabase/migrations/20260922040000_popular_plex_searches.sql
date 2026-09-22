-- "Popular searches" on the Plex search screen: the searches viewers
-- committed to (moved down into the results, or opened one) over the last
-- sixty days, counted across every device. Only plex_search_commit events
-- count — player_search fires on every keystroke and would rank "b", "ba",
-- "bat" above anything a person meant.
--
-- Public and read-only: anonymous callers get the same list as signed-in
-- ones, and nothing about who searched leaves the table.

create or replace function public.get_popular_plex_searches(p_limit int default 12)
returns table(query text, searches bigint)
language sql
stable
security definer
set search_path = public
as $$
  select q as query, count(*) as searches
  from (
    select lower(btrim(regexp_replace(coalesce(properties->>'query', ''), '\s+', ' ', 'g'))) as q
    from public.analytics_events
    where event_name = 'plex_search_commit'
      and occurred_at > now() - interval '60 days'
  ) s
  where length(q) between 2 and 40
  group by q
  having count(*) >= 2
  order by searches desc, q asc
  limit greatest(1, least(coalesce(p_limit, 12), 30));
$$;

revoke all on function public.get_popular_plex_searches(int) from public;
grant execute on function public.get_popular_plex_searches(int) to anon, authenticated;

-- The aggregate scans by event name and time; without this it walks the
-- whole events table on every Plex search screen.
create index if not exists analytics_events_search_commit_idx
  on public.analytics_events (occurred_at desc)
  where event_name = 'plex_search_commit';
