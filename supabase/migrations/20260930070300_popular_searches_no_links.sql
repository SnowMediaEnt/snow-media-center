-- "Popular searches" no longer offers links, addresses or phone numbers.
--
-- The list is counted from analytics_events, which any client can write with
-- any session id, so a script can push a phrase of its choice to the top and
-- have it shown on every box's Plex search screen. The real fix is in the
-- app (1.7.8): a popular search is shown only once it finds a title on the
-- viewer's own Plex server. This drops the worst kinds of text here as well,
-- for every client: anything that looks like a web address, an email address
-- or a phone number. No title needs any of those.
--
-- Same signature, same result shape, same grants as 20260922040000; only the
-- WHERE clause of `final` gains the pattern test. analytics_* tables are not
-- changed.

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
      -- a link, a domain, an email address or a phone number
      and r.q !~ '(https?:|www\.|@|\.(com|net|org|io|co|me|tv|xyz|info|biz|us|ru|app|site|link|shop|live)\M|[0-9]{6,}|[0-9]{3}[ .()-]+[0-9]{3}[ .-]+[0-9]{4})'
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
