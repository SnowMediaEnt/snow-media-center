-- "Popular searches" on the Plex search screen: the top searches across every
-- device over the last ninety days.
--
-- Two kinds of row count. plex_search_commit is a search the viewer meant
-- (moved down into the results, or opened one). player_search fires on every
-- keystroke, so on its own it would rank "b", "ba", "bat" above anything a
-- person typed; from those, only the last query of each typing burst is kept:
-- a query that no later query in the same session, within two minutes,
-- extends. Each session counts once per query, so one person hammering a
-- title does not make it popular.
--
-- Public and read-only: anonymous callers get the same list as signed-in
-- ones, and nothing about who searched leaves the table.

create or replace function public.get_popular_plex_searches(p_limit int default 20)
returns table(query text, searches bigint)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select
      session_id,
      occurred_at,
      lower(btrim(regexp_replace(coalesce(properties->>'query', ''), '\s+', ' ', 'g'))) as q
    from public.analytics_events
    where event_name in ('plex_search_commit', 'player_search')
      and coalesce(properties->>'scope', 'plex') = 'plex'
      and occurred_at > now() - interval '90 days'
  ),
  final as (
    select r.session_id, r.q
    from raw r
    where length(r.q) between 3 and 40
      and not exists (
        select 1 from raw r2
        where r2.session_id = r.session_id
          and r2.occurred_at > r.occurred_at
          and r2.occurred_at < r.occurred_at + interval '2 minutes'
          and r2.q <> r.q
          and left(r2.q, length(r.q)) = r.q
      )
  )
  select q as query, count(distinct session_id) as searches
  from final
  group by q
  order by searches desc, q asc
  limit greatest(1, least(coalesce(p_limit, 20), 40));
$$;

revoke all on function public.get_popular_plex_searches(int) from public;
grant execute on function public.get_popular_plex_searches(int) to anon, authenticated;

-- The burst check walks a session's searches in time order; without this it
-- scans the whole events table on every Plex search screen.
drop index if exists analytics_events_search_commit_idx;
create index if not exists analytics_events_plex_search_idx
  on public.analytics_events (session_id, occurred_at)
  where event_name in ('plex_search_commit', 'player_search');
