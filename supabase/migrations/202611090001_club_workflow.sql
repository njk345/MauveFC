-- Club workflow. Apply as the Supabase migration owner, never via an anon client.
create table public.clubs (id uuid primary key default gen_random_uuid(), name text not null, timezone text not null default 'America/New_York');
create table public.club_memberships (club_id uuid not null references public.clubs(id),user_id uuid not null references auth.users(id) on delete cascade,role text not null check(role in ('captain','player')),primary key(club_id,user_id));
create table public.seasons (id uuid primary key default gen_random_uuid(),club_id uuid not null references public.clubs(id),name text not null,competition text not null,format text not null,unique(id,club_id));
create table public.players (id uuid primary key default gen_random_uuid(),club_id uuid not null references public.clubs(id),name text not null check(length(name) between 1 and 100),number integer not null check(number between 0 and 99),position text not null check(position in ('Forward','Midfielder','Defender','Goalkeeper')),initials text not null check(length(initials) between 1 and 4),hometown text not null default '',bio text not null default '',is_public boolean not null default false,unique(id,club_id));
create table public.season_roster (club_id uuid not null,season_id uuid not null,player_id uuid not null,primary key(season_id,player_id),foreign key(season_id,club_id) references public.seasons(id,club_id),foreign key(player_id,club_id) references public.players(id,club_id));
create table public.matches (id uuid primary key default gen_random_uuid(),club_id uuid not null,season_id uuid not null,opponent text not null check(length(opponent) between 1 and 100),opponent_code text not null check(length(opponent_code) between 1 and 4),color text not null default '#657293' check(color ~ '^#[0-9A-Fa-f]{6}$'),kickoff timestamptz,source_timezone text not null default 'America/New_York',venue text not null check(length(venue) between 1 and 200),round integer not null check(round between 1 and 999),home boolean not null default true,status text not null default 'scheduled' check(status in ('scheduled','completed','postponed','cancelled')),revision integer not null default 0,unique(id,club_id),foreign key(season_id,club_id) references public.seasons(id,club_id));
create table public.match_results (match_id uuid primary key,club_id uuid not null,home integer not null check(home between 0 and 99),away integer not null check(away between 0 and 99),on_field_home integer not null check(on_field_home between 0 and 99),on_field_away integer not null check(on_field_away between 0 and 99),basis text not null check(basis in ('played','forfeit','adjusted')),reason text not null default '',attendance text not null check(attendance in ('unrecorded','partial','complete')),scorers text not null check(scorers in ('unrecorded','partial','complete')),assists text not null check(assists in ('unrecorded','partial','complete')),own_goals integer not null check(own_goals between 0 and 99),published boolean not null default false,updated_at timestamptz not null default now(),editor_id uuid references auth.users(id),foreign key(match_id,club_id) references public.matches(id,club_id));
create table public.match_player_stats (club_id uuid not null,match_id uuid not null,player_id uuid not null,appeared boolean not null default false,goals integer not null default 0 check(goals between 0 and 99),assists integer check(assists between 0 and 99),primary key(match_id,player_id),foreign key(match_id,club_id) references public.matches(id,club_id),foreign key(player_id,club_id) references public.players(id,club_id));
create table public.match_drafts (club_id uuid not null,match_id uuid not null,editor_id uuid not null references auth.users(id),payload jsonb not null,base_revision integer not null,updated_at timestamptz not null default now(),primary key(match_id,editor_id),foreign key(match_id,club_id) references public.matches(id,club_id));
create table public.result_history (id uuid primary key default gen_random_uuid(),club_id uuid not null,match_id uuid not null,editor_id uuid not null references auth.users(id),edited_at timestamptz not null default now(),before_value jsonb,after_value jsonb not null,foreign key(match_id,club_id) references public.matches(id,club_id));
create index matches_season_idx on public.matches(club_id,season_id);
create index memberships_user_idx on public.club_memberships(user_id);
create index roster_player_idx on public.season_roster(player_id);
create index history_match_idx on public.result_history(match_id,edited_at);

create function public.is_captain(p_club_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=auth.uid() and role='captain');
$$;
revoke all on function public.is_captain(uuid) from public;
grant execute on function public.is_captain(uuid) to authenticated;

alter table public.clubs enable row level security;
alter table public.club_memberships enable row level security;
alter table public.seasons enable row level security;
alter table public.players enable row level security;
alter table public.season_roster enable row level security;
alter table public.matches enable row level security;
alter table public.match_results enable row level security;
alter table public.match_player_stats enable row level security;
alter table public.match_drafts enable row level security;
alter table public.result_history enable row level security;
-- Base tables are private. Public reads use one bounded, explicit projection below.
revoke all on public.clubs,public.club_memberships,public.seasons,public.players,public.season_roster,public.matches,public.match_results,public.match_player_stats,public.match_drafts,public.result_history from anon,authenticated;
grant select on public.club_memberships,public.match_drafts to authenticated;
create policy own_membership on public.club_memberships for select to authenticated using(user_id=auth.uid());
create policy own_captain_drafts on public.match_drafts for select to authenticated using(editor_id=auth.uid() and public.is_captain(club_id));

create function public.club_snapshot(p_club_id uuid,p_private boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare response jsonb;
begin
 if p_private and not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select jsonb_build_object(
  'seasons',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'competition',s.competition,'format',s.format) order by s.name desc) from public.seasons s where s.club_id=p_club_id),'[]'::jsonb),
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',p.number,'position',p.position,'initials',p.initials,'hometown',p.hometown,'bio',p.bio) || case when p_private then jsonb_build_object('isPublic',p.is_public) else '{}'::jsonb end order by p.number) from public.players p where p.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',sr.season_id,'playerId',sr.player_id)) from public.season_roster sr join public.players p on p.id=sr.player_id where sr.club_id=p_club_id and (p_private or p.is_public)),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'seasonId',m.season_id,'opponent',m.opponent,'opponentCode',m.opponent_code,'color',m.color,'kickoff',m.kickoff,'venue',m.venue,'round',m.round,'home',m.home,'status',m.status,'revision',m.revision) || case when r.published then jsonb_build_object('result',jsonb_build_object('home',r.home,'away',r.away,'onFieldHome',r.on_field_home,'onFieldAway',r.on_field_away,'basis',r.basis,'reason',r.reason,'attendance',r.attendance,'scorers',r.scorers,'assists',r.assists,'ownGoals',r.own_goals,'published',true,'updatedAt',r.updated_at,'stats',coalesce((select jsonb_agg(jsonb_build_object('playerId',ps.player_id,'appeared',ps.appeared,'goals',ps.goals,'assists',ps.assists)) from public.match_player_stats ps join public.players p on p.id=ps.player_id where ps.match_id=m.id and (p_private or p.is_public)),'[]'::jsonb))) else '{}'::jsonb end order by m.round) from public.matches m left join public.match_results r on r.match_id=m.id where m.club_id=p_club_id),'[]'::jsonb)
 ) into response;
 return response;
end;$$;
revoke all on function public.club_snapshot(uuid,boolean) from public,anon,authenticated;
create function public.get_public_club(p_club_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select public.club_snapshot(p_club_id,false);$$;
create function public.get_captain_club(p_club_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select public.club_snapshot(p_club_id,true);$$;
revoke all on function public.get_public_club(uuid),public.get_captain_club(uuid) from public;
grant execute on function public.get_public_club(uuid) to anon,authenticated;
grant execute on function public.get_captain_club(uuid) to authenticated;

create function public.validate_result_payload(p_match_id uuid,p_payload jsonb,p_publish boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches; s jsonb; field text; total integer:=0;begin
 select * into strict m from public.matches where id=p_match_id;
 if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'stats') is distinct from 'array' or jsonb_array_length(p_payload->'stats')>200 then raise exception 'Invalid result payload';end if;
 foreach field in array array['home','away','onFieldHome','onFieldAway','ownGoals'] loop
  if jsonb_typeof(p_payload->field) is distinct from 'number' or (p_payload->>field)!~'^(0|[1-9][0-9]?)$' then raise exception 'Scores must be whole numbers from 0 to 99';end if;
 end loop;
 if coalesce(p_payload->>'basis','') not in ('played','forfeit','adjusted') or coalesce(p_payload->>'attendance','') not in ('unrecorded','partial','complete') or coalesce(p_payload->>'scorers','') not in ('unrecorded','partial','complete') or coalesce(p_payload->>'assists','') not in ('unrecorded','partial','complete') or jsonb_typeof(p_payload->'published') is distinct from 'boolean' or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(p_payload->>'reason')>500 then raise exception 'Invalid result fields';end if;
 if (select count(*)<>count(distinct value->>'playerId') from jsonb_array_elements(p_payload->'stats')) then raise exception 'Duplicate player';end if;
 for s in select value from jsonb_array_elements(p_payload->'stats') loop
  if not exists(select 1 from public.season_roster where season_id=m.season_id and player_id=(s->>'playerId')::uuid and club_id=m.club_id) then raise exception 'Player is not eligible for this season';end if;
  if jsonb_typeof(s->'appeared') is distinct from 'boolean' or jsonb_typeof(s->'goals') is distinct from 'number' or (s->>'goals')!~'^(0|[1-9][0-9]?)$' or (jsonb_typeof(s->'assists') is distinct from 'null' and (jsonb_typeof(s->'assists') is distinct from 'number' or coalesce(s->>'assists','')!~'^(0|[1-9][0-9]?)$')) then raise exception 'Invalid player totals';end if;
  total:=total+(s->>'goals')::integer;
  if p_publish then
   if not (s->>'appeared')::boolean and ((s->>'goals')::integer>0 or coalesce((s->>'assists')::integer,0)>0) then raise exception 'Player must have appeared';end if;
   if (s->>'appeared')::boolean and p_payload->>'attendance'='unrecorded' then raise exception 'Attendance must be marked partial or complete';end if;
   if p_payload->>'assists'='unrecorded' and s->'assists'<>'null'::jsonb then raise exception 'Unrecorded assists must be unknown';end if;
   if p_payload->>'assists'='complete' and (s->>'appeared')::boolean and s->'assists'='null'::jsonb then raise exception 'Complete assist capture requires known totals';end if;
  end if;
 end loop;
 if p_publish then
  if m.status='cancelled' then raise exception 'Cancelled fixtures cannot be published';end if;
  if p_payload->>'basis'<>'played' and btrim(p_payload->>'reason')='' then raise exception 'An adjustment reason is required';end if;
  if p_payload->>'basis'='played' and ((p_payload->>'home')::integer<>(p_payload->>'onFieldHome')::integer or (p_payload->>'away')::integer<>(p_payload->>'onFieldAway')::integer) then raise exception 'Official and on-field scores must match for played results';end if;
  total:=total+(p_payload->>'ownGoals')::integer;
  if total>(p_payload->>'onFieldHome')::integer then raise exception 'Attributed goals exceed on-field score';end if;
  if p_payload->>'scorers'='complete' and total<>(p_payload->>'onFieldHome')::integer then raise exception 'Complete scoring must reconcile';end if;
  if p_payload->>'scorers'='unrecorded' and total>0 then raise exception 'Scorers must be marked partial or complete';end if;
 end if;
end;$$;
revoke all on function public.validate_result_payload(uuid,jsonb,boolean) from public,anon,authenticated;

create function public.save_match_result(p_match_id uuid,p_expected_revision integer,p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches; before_snapshot jsonb; publish boolean;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if m.revision is distinct from p_expected_revision then raise exception 'Match changed; reload before saving' using errcode='40001';end if;
 publish:=coalesce((p_payload->>'published')::boolean,false);
 perform public.validate_result_payload(p_match_id,p_payload,publish);
 if not publish then
  insert into public.match_drafts(club_id,match_id,editor_id,payload,base_revision) values(m.club_id,m.id,auth.uid(),p_payload,m.revision)
  on conflict(match_id,editor_id) do update set payload=excluded.payload,base_revision=excluded.base_revision,updated_at=now();return;
 end if;
 select jsonb_build_object('result',to_jsonb(r),'stats',coalesce((select jsonb_agg(to_jsonb(ps)) from public.match_player_stats ps where ps.match_id=m.id),'[]'::jsonb)) into before_snapshot from public.match_results r where r.match_id=m.id;
 insert into public.match_results(match_id,club_id,home,away,on_field_home,on_field_away,basis,reason,attendance,scorers,assists,own_goals,published,editor_id)
 values(m.id,m.club_id,(p_payload->>'home')::int,(p_payload->>'away')::int,(p_payload->>'onFieldHome')::int,(p_payload->>'onFieldAway')::int,p_payload->>'basis',p_payload->>'reason',p_payload->>'attendance',p_payload->>'scorers',p_payload->>'assists',(p_payload->>'ownGoals')::int,true,auth.uid())
 on conflict(match_id) do update set home=excluded.home,away=excluded.away,on_field_home=excluded.on_field_home,on_field_away=excluded.on_field_away,basis=excluded.basis,reason=excluded.reason,attendance=excluded.attendance,scorers=excluded.scorers,assists=excluded.assists,own_goals=excluded.own_goals,published=true,editor_id=auth.uid(),updated_at=now();
 delete from public.match_player_stats where match_id=m.id;
 insert into public.match_player_stats(club_id,match_id,player_id,appeared,goals,assists)
 select m.club_id,m.id,(s->>'playerId')::uuid,(s->>'appeared')::boolean,(s->>'goals')::integer,(s->>'assists')::integer from jsonb_array_elements(p_payload->'stats') s;
 update public.matches set status='completed',revision=revision+1 where id=m.id;
 insert into public.result_history(club_id,match_id,editor_id,before_value,after_value) values(m.club_id,m.id,auth.uid(),before_snapshot,p_payload);
 delete from public.match_drafts where match_id=m.id and editor_id=auth.uid();
end;$$;
revoke all on function public.save_match_result(uuid,integer,jsonb) from public;
grant execute on function public.save_match_result(uuid,integer,jsonb) to authenticated;

create function public.save_fixture(p_club_id uuid,p_fixture jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare fixture_id uuid:=coalesce(nullif(p_fixture->>'id','')::uuid,gen_random_uuid());current_match public.matches;begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if coalesce(p_fixture->>'status','') not in ('scheduled','postponed','cancelled','completed') then raise exception 'Invalid fixture status';end if;
 select * into current_match from public.matches where id=fixture_id for update;
 if found then
  if current_match.club_id<>p_club_id then raise exception 'Club mismatch' using errcode='42501';end if;
  if current_match.revision<>coalesce((p_fixture->>'revision')::integer,-1) then raise exception 'Fixture changed' using errcode='40001';end if;
  if exists(select 1 from public.match_results where match_id=fixture_id and published) and (current_match.season_id<>(p_fixture->>'seasonId')::uuid or p_fixture->>'status'<>'completed') then raise exception 'A published result keeps its season and completed status';end if;
  update public.matches set opponent=btrim(p_fixture->>'opponent'),opponent_code=p_fixture->>'opponentCode',color=p_fixture->>'color',kickoff=nullif(p_fixture->>'kickoff','')::timestamptz,venue=btrim(p_fixture->>'venue'),round=(p_fixture->>'round')::integer,home=(p_fixture->>'home')::boolean,status=p_fixture->>'status',revision=revision+1 where id=fixture_id;
 else
  if p_fixture->>'status'='completed' then raise exception 'Publish a result to complete a new match';end if;
  insert into public.matches(id,club_id,season_id,opponent,opponent_code,color,kickoff,venue,round,home,status) values(fixture_id,p_club_id,(p_fixture->>'seasonId')::uuid,btrim(p_fixture->>'opponent'),p_fixture->>'opponentCode',p_fixture->>'color',nullif(p_fixture->>'kickoff','')::timestamptz,btrim(p_fixture->>'venue'),(p_fixture->>'round')::int,(p_fixture->>'home')::boolean,p_fixture->>'status');
 end if;
 return fixture_id;
end;$$;
revoke all on function public.save_fixture(uuid,jsonb) from public;
grant execute on function public.save_fixture(uuid,jsonb) to authenticated;

create function public.save_roster_player(p_club_id uuid,p_season_id uuid,p_player jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare player_id uuid:=coalesce(nullif(p_player->>'id','')::uuid,gen_random_uuid());begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 if exists(select 1 from public.players where id=player_id and club_id<>p_club_id) then raise exception 'Club mismatch' using errcode='42501';end if;
 insert into public.players(id,club_id,name,number,position,initials,hometown,bio,is_public) values(player_id,p_club_id,btrim(p_player->>'name'),(p_player->>'number')::integer,p_player->>'position',p_player->>'initials',coalesce(p_player->>'hometown',''),coalesce(p_player->>'bio',''),coalesce((p_player->>'isPublic')::boolean,false))
 on conflict(id) do update set name=excluded.name,number=excluded.number,position=excluded.position,initials=excluded.initials,hometown=excluded.hometown,bio=excluded.bio,is_public=excluded.is_public where public.players.club_id=p_club_id;
 if not found then raise exception 'Club mismatch' using errcode='42501';end if;
 insert into public.season_roster(club_id,season_id,player_id) values(p_club_id,p_season_id,player_id) on conflict do nothing;return player_id;
end;$$;
revoke all on function public.save_roster_player(uuid,uuid,jsonb) from public;
grant execute on function public.save_roster_player(uuid,uuid,jsonb) to authenticated;

-- SQL-derived club record, never a maintained counter; the definer view has a public-only projection.
create view public.public_season_totals as
 select m.club_id,m.season_id,count(*)::int played,count(*) filter(where r.home>r.away)::int wins,count(*) filter(where r.home=r.away)::int draws,count(*) filter(where r.home<r.away)::int losses,sum(r.home)::int goals_for,sum(r.away)::int goals_against,sum(case when r.home>r.away then 3 when r.home=r.away then 1 else 0 end)::int points
 from public.matches m join public.match_results r on r.match_id=m.id where r.published and m.status='completed' group by m.club_id,m.season_id;
revoke all on public.public_season_totals from anon,authenticated;
grant select on public.public_season_totals to anon,authenticated;
create view public.public_player_season_totals as
 select ps.club_id,m.season_id,ps.player_id,count(*) filter(where ps.appeared)::int appearances,sum(ps.goals)::int goals,sum(ps.assists)::int assists,count(ps.assists)::int assists_recorded_matches
 from public.match_player_stats ps join public.players p on p.id=ps.player_id join public.matches m on m.id=ps.match_id join public.match_results r on r.match_id=m.id
 where p.is_public and r.published and m.status='completed' group by ps.club_id,m.season_id,ps.player_id;
revoke all on public.public_player_season_totals from anon,authenticated;
grant select on public.public_player_season_totals to anon,authenticated;
