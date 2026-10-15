-- Matches the migration version applied to the connected Supabase project.
-- Server-owned state holds dice history and unrevealed trivia answers. Clients
-- never read or write this table; the authenticated game server exposes a DTO.
alter table public.trivia_questions add column if not exists difficulty text not null default 'easy';

create table public.arcade_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('dice', 'trivia')),
  bet integer not null check (bet in (10,25,50,100)),
  state jsonb not null,
  version integer not null default 0 check (version >= 0),
  status text not null default 'active' check (status in ('active','settled','expired')),
  result jsonb,
  game_round_id bigint references public.game_rounds(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create unique index arcade_sessions_one_active on public.arcade_sessions(user_id,game) where status='active';
create index arcade_sessions_user_history on public.arcade_sessions(user_id,game,created_at desc);
alter table public.arcade_sessions enable row level security;
revoke all on public.arcade_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.arcade_sessions to service_role;

-- All wallet movements and completion records commit together. The service
-- role is the only caller; ordinary JWTs cannot invoke these RPCs directly.
create function public.start_verified_arcade(p_user uuid,p_id uuid,p_game text,p_bet integer,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.arcade_sessions%rowtype; b integer; r bigint;
begin
  if p_game not in ('dice','trivia') or p_bet not in (10,25,50,100) or p_state is null then
    raise exception 'invalid_arcade_start';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text || ':verified_arcade',0));
  select * into s from public.arcade_sessions where id=p_id and user_id=p_user and game=p_game for update;
  if found then
    select balance into b from public.play_chips where user_id=p_user;
    return jsonb_build_object('session',to_jsonb(s),'balance',b,'resumed',true);
  end if;
  select * into s from public.arcade_sessions where user_id=p_user and game=p_game and status='active' for update;
  if found and s.expires_at > now() then
    select balance into b from public.play_chips where user_id=p_user;
    return jsonb_build_object('session',to_jsonb(s),'balance',b,'resumed',true);
  elsif found then
    insert into public.game_rounds(user_id,game,bet,result)
      values(p_user,p_game,s.bet,jsonb_build_object('status','expired','payout',0,'net',-s.bet,'verified',true)) returning id into r;
    update public.arcade_sessions set status='expired',game_round_id=r,updated_at=now() where id=s.id;
  end if;
  b := public.apply_chip_change(p_user,-p_bet,p_game || '_arcade',null);
  insert into public.arcade_sessions(id,user_id,game,bet,state) values(p_id,p_user,p_game,p_bet,p_state) returning * into s;
  return jsonb_build_object('session',to_jsonb(s),'balance',b,'resumed',false);
end;
$$;

create function public.advance_verified_arcade(p_user uuid,p_id uuid,p_version integer,p_state jsonb,p_result jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.arcade_sessions%rowtype; b integer; r bigint; payout integer; final_result jsonb; score_mode text;
begin
  select * into s from public.arcade_sessions where id=p_id and user_id=p_user for update;
  if not found then raise exception 'round_not_found'; end if;
  select balance into b from public.play_chips where user_id=p_user;
  if s.status <> 'active' or s.version <> p_version then
    return jsonb_build_object('session',to_jsonb(s),'balance',b,'alreadySettled',s.status='settled','resynced',true);
  end if;
  if s.expires_at <= now() then raise exception 'round_expired'; end if;
  if p_state is null then raise exception 'invalid_arcade_state'; end if;
  if p_result is not null then
    payout := (p_result->>'payout')::integer;
    if payout is null or payout < 0 or payout > s.bet*6 then raise exception 'invalid_arcade_payout'; end if;
    final_result := p_result || jsonb_build_object('status','settled','net',payout-s.bet,'verified',true);
    insert into public.game_rounds(user_id,game,bet,result) values(p_user,s.game,s.bet,final_result) returning id into r;
    b := public.apply_chip_change(p_user,payout,s.game || '_arcade',r);
    score_mode := case when s.game='trivia' then (p_result->>'mode') || '-' || (p_result->>'difficulty') else 'classic' end;
    perform public.record_game_score(p_user,s.game,score_mode,(p_result->>'score')::integer,payout>s.bet);
    update public.arcade_sessions set state=p_state,version=version+1,status='settled',result=final_result,game_round_id=r,updated_at=now()
      where id=p_id returning * into s;
  else
    update public.arcade_sessions set state=p_state,version=version+1,updated_at=now() where id=p_id returning * into s;
  end if;
  return jsonb_build_object('session',to_jsonb(s),'balance',b,'alreadySettled',false,'resynced',false);
end;
$$;
revoke all on function public.start_verified_arcade(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.advance_verified_arcade(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.start_verified_arcade(uuid,uuid,text,integer,jsonb) to service_role;
grant execute on function public.advance_verified_arcade(uuid,uuid,integer,jsonb,jsonb) to service_role;
