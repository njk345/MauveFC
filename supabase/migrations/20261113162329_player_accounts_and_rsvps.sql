set local lock_timeout='5s';
set local statement_timeout='30s';
-- Team membership links an Auth identity to one club-owned roster profile.
alter table public.club_memberships add column if not exists player_id uuid;
do $$begin if not exists(select 1 from pg_constraint where conname='membership_player_scope' and conrelid='public.club_memberships'::regclass) then alter table public.club_memberships add constraint membership_player_scope foreign key(player_id,club_id) references public.players(id,club_id); end if;end;$$;
create unique index if not exists membership_one_identity_per_player on public.club_memberships(club_id,player_id) where player_id is not null;

create table if not exists private.player_invites (
 club_id uuid not null references public.clubs(id),player_id uuid not null,
 email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254),
 generation uuid not null default gen_random_uuid(),expires_at timestamptz not null default now()+interval '7 days',
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 primary key(club_id,player_id),unique(club_id,email),
 foreign key(player_id,club_id) references public.players(id,club_id)
);
create table if not exists private.match_rsvps (
 club_id uuid not null,match_id uuid not null,player_id uuid not null,
 response text not null check(response in ('in','maybe','out')),
 kickoff_at_response timestamptz,updated_at timestamptz not null default now(),
 primary key(match_id,player_id),
 foreign key(match_id,club_id) references public.matches(id,club_id),
 foreign key(player_id,club_id) references public.players(id,club_id)
);
create index if not exists match_rsvps_player_idx on private.match_rsvps(player_id);
create table if not exists private.match_lineups (
 club_id uuid not null,match_id uuid primary key,
 published_payload jsonb,draft_payload jsonb,revision integer not null default 0,
 published_at timestamptz,updated_at timestamptz not null default now(),
 foreign key(match_id,club_id) references public.matches(id,club_id)
);
create index if not exists match_lineups_club_idx on private.match_lineups(club_id);
alter table private.player_invites enable row level security;
alter table private.match_rsvps enable row level security;
alter table private.match_lineups enable row level security;
revoke all on private.player_invites,private.match_rsvps,private.match_lineups from public,anon,authenticated;

create or replace function private.is_team_member(p_club_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=auth.uid() and role in ('captain','player'));
$$;
revoke all on function private.is_team_member(uuid) from public,anon,authenticated;

-- Consumed only by a verified Auth identity. User-editable metadata is ignored.
create or replace function private.accept_player_invites(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare mail text;i private.player_invites;begin
 select lower(btrim(email)) into mail from auth.users where id=p_user_id and email_confirmed_at is not null;
 if mail is null then return;end if;
 for i in select * from private.player_invites where email=mail and expires_at>now() loop
  -- Match the captain's lock order: player, then invitation.
  perform 1 from public.players where id=i.player_id and club_id=i.club_id for update;
  select * into i from private.player_invites where club_id=i.club_id and player_id=i.player_id and email=mail and expires_at>now() for update;
  if not found then continue;end if;
  if exists(select 1 from public.club_memberships where club_id=i.club_id and player_id=i.player_id and user_id<>p_user_id) then continue;end if;
  if exists(select 1 from public.club_memberships where club_id=i.club_id and user_id=p_user_id and player_id is not null and player_id<>i.player_id) then continue;end if;
  insert into public.club_memberships(club_id,user_id,role,player_id) values(i.club_id,p_user_id,'player',i.player_id)
  on conflict(club_id,user_id) do update set player_id=excluded.player_id;
  delete from private.player_invites where club_id=i.club_id and player_id=i.player_id;
 end loop;
end;$$;
revoke all on function private.accept_player_invites(uuid) from public,anon,authenticated;

create or replace function public.get_team_access(p_club_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.club_memberships;begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 perform private.accept_player_invites(auth.uid());
 select * into m from public.club_memberships where club_id=p_club_id and user_id=auth.uid();
 return jsonb_build_object('member',found,'role',m.role,'playerId',m.player_id);
end;$$;

-- Used by the user-scoped Edge client before generating a private Auth link.
create or replace function public.prepare_player_invite(p_club_id uuid,p_player_id uuid,p_email text) returns jsonb language plpgsql security definer set search_path='' as $$
declare mail text:=lower(btrim(p_email));account auth.users;g uuid;begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 perform 1 from public.players where id=p_player_id and club_id=p_club_id for update;
 if not found then raise exception 'Player does not belong to this club';end if;
 if mail is null or length(mail)>254 or mail!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid player email';end if;
 select * into account from auth.users where lower(btrim(email))=mail;
 if exists(select 1 from public.club_memberships where club_id=p_club_id and player_id=p_player_id and user_id is distinct from account.id) then raise exception 'This player already has an account. Revoke its access before assigning another email.';end if;
 if exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=account.id and player_id is not null and player_id<>p_player_id) then raise exception 'That account is linked to another player';end if;
 if exists(select 1 from private.player_invites where club_id=p_club_id and email=mail and player_id<>p_player_id) then raise exception 'That email already has an invitation for another player';end if;
 insert into private.player_invites(club_id,player_id,email,created_by) values(p_club_id,p_player_id,mail,auth.uid())
 on conflict(club_id,player_id) do update set email=excluded.email,generation=gen_random_uuid(),expires_at=now()+interval '7 days',created_at=now(),created_by=auth.uid() returning generation into g;
 return jsonb_build_object('generation',g,'type',case
  when account.id is null then 'invite'
  when exists(select 1 from public.club_memberships where user_id=account.id and role='captain') then 'existing'
  when account.email_confirmed_at is null and not exists(select 1 from public.club_memberships where user_id=account.id) then 'recovery'
  when exists(select 1 from public.club_memberships where club_id=p_club_id and user_id=account.id and player_id=p_player_id and role='player') and not exists(select 1 from public.club_memberships where user_id=account.id and club_id<>p_club_id) then 'recovery'
  else 'existing' end);
end;$$;
create or replace function public.cancel_player_invite(p_club_id uuid,p_player_id uuid,p_generation uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 delete from private.player_invites where club_id=p_club_id and player_id=p_player_id and generation=p_generation;
end;$$;
create or replace function public.revoke_player_access(p_club_id uuid,p_player_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 perform 1 from public.players where club_id=p_club_id and id=p_player_id for update;
 if not found then raise exception 'Player does not belong to this club';end if;
 if exists(select 1 from public.club_memberships where club_id=p_club_id and player_id=p_player_id and role='captain') then raise exception 'Captain access must be managed by an administrator';end if;
 delete from private.player_invites where club_id=p_club_id and player_id=p_player_id;
 delete from public.club_memberships where club_id=p_club_id and player_id=p_player_id and role='player';
end;$$;
create or replace function public.link_captain_profile(p_club_id uuid,p_player_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 perform 1 from public.players where club_id=p_club_id and id=p_player_id for update;
 if not found then raise exception 'Player does not belong to this club';end if;
 if exists(select 1 from public.club_memberships where club_id=p_club_id and player_id=p_player_id and user_id<>auth.uid()) then raise exception 'That profile already belongs to another account';end if;
 update public.club_memberships set player_id=p_player_id where club_id=p_club_id and user_id=auth.uid();
end;$$;


revoke all on function public.get_team_access(uuid),public.prepare_player_invite(uuid,uuid,text),public.cancel_player_invite(uuid,uuid,uuid),public.revoke_player_access(uuid,uuid),public.link_captain_profile(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_team_access(uuid),public.prepare_player_invite(uuid,uuid,text),public.cancel_player_invite(uuid,uuid,uuid),public.revoke_player_access(uuid,uuid),public.link_captain_profile(uuid,uuid) to authenticated;

create or replace function public.save_match_rsvp(p_match_id uuid,p_response text) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;player uuid;begin
 select * into strict m from public.matches where id=p_match_id for update;
 select player_id into player from public.club_memberships where club_id=m.club_id and user_id=auth.uid();
 if player is null then raise exception 'A linked team account is required' using errcode='42501';end if;
 if not exists(select 1 from public.season_roster where season_id=m.season_id and player_id=player and club_id=m.club_id) then raise exception 'You are not on this season roster' using errcode='42501';end if;
 if m.status<>'scheduled' or (m.kickoff is not null and m.kickoff<=now()) then raise exception 'RSVPs are closed for this fixture';end if;
 if p_response is null then delete from private.match_rsvps where match_id=m.id and player_id=player;return;end if;
 if p_response not in ('in','maybe','out') then raise exception 'Invalid RSVP';end if;
 insert into private.match_rsvps(club_id,match_id,player_id,response,kickoff_at_response) values(m.club_id,m.id,player,p_response,m.kickoff)
 on conflict(match_id,player_id) do update set response=excluded.response,kickoff_at_response=excluded.kickoff_at_response,updated_at=now();
end;$$;

create or replace function public.save_match_lineup(p_match_id uuid,p_expected_revision integer,p_payload jsonb,p_publish boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;l private.match_lineups;player text;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select * into l from private.match_lineups where match_id=m.id for update;
 if coalesce(l.revision,0) is distinct from p_expected_revision then raise exception 'The lineup changed. Reload before saving.' using errcode='40001';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(p_payload->>'formation','') not in ('2-3-1','3-2-1','2-2-2') or jsonb_typeof(p_payload->'starters') is distinct from 'array' or jsonb_array_length(p_payload->'starters')<>7 or jsonb_typeof(p_payload->'bench') is distinct from 'array' or jsonb_array_length(p_payload->'bench')>100 or p_publish is null then raise exception 'Invalid lineup';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'starters') s where jsonb_typeof(s) not in ('string','null')) or exists(select 1 from jsonb_array_elements(p_payload->'bench') s where jsonb_typeof(s)<>'string') then raise exception 'Invalid lineup player';end if;
 if p_publish and exists(select 1 from jsonb_array_elements(p_payload->'starters') s where s='null'::jsonb) then raise exception 'Choose all seven starters before sharing';end if;
 if (select count(*)<>count(distinct value) from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) where value is not null) then raise exception 'A player cannot appear twice';end if;
 for player in select value from jsonb_array_elements_text((p_payload->'starters')||(p_payload->'bench')) where value is not null loop
  if not exists(select 1 from public.season_roster where club_id=m.club_id and season_id=m.season_id and player_id=player::uuid) then raise exception 'Player is not eligible for this fixture';end if;
 end loop;
 insert into private.match_lineups(club_id,match_id,published_payload,draft_payload,revision,published_at)
 values(m.club_id,m.id,case when p_publish then p_payload end,case when not p_publish then p_payload end,1,case when p_publish then now() end)
 on conflict(match_id) do update set published_payload=case when p_publish then p_payload else match_lineups.published_payload end,draft_payload=case when p_publish then null else p_payload end,revision=match_lineups.revision+1,published_at=case when p_publish then now() else match_lineups.published_at end,updated_at=now();
end;$$;
create or replace function public.unshare_match_lineup(p_match_id uuid,p_expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;l private.match_lineups;begin
 select * into strict m from public.matches where id=p_match_id for update;
 if not public.is_captain(m.club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 select * into strict l from private.match_lineups where match_id=m.id for update;
 if l.revision is distinct from p_expected_revision then raise exception 'The lineup changed. Reload before saving.' using errcode='40001';end if;
 update private.match_lineups set draft_payload=coalesce(draft_payload,published_payload),published_payload=null,published_at=null,revision=revision+1,updated_at=now() where match_id=m.id;
end;$$;

create or replace function public.get_team_club(p_club_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare data jsonb;captain boolean;begin
 if not private.is_team_member(p_club_id) then raise exception 'Team membership required' using errcode='42501';end if;
 captain:=public.is_captain(p_club_id);
 data:=public.get_public_club(p_club_id);
 return data || jsonb_build_object(
  'players',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'number',number,'position',position,'initials',initials,'hometown',hometown,'bio',bio,'isPublic',is_public) order by number,name) from public.players where club_id=p_club_id),'[]'::jsonb),
  'roster',coalesce((select jsonb_agg(jsonb_build_object('seasonId',season_id,'playerId',player_id)) from public.season_roster where club_id=p_club_id),'[]'::jsonb),
  'rsvps',coalesce((select jsonb_agg(jsonb_build_object('matchId',r.match_id,'playerId',r.player_id,'response',r.response,'updatedAt',r.updated_at,'needsConfirmation',r.kickoff_at_response is distinct from m.kickoff)) from private.match_rsvps r join public.matches m on m.id=r.match_id where r.club_id=p_club_id),'[]'::jsonb),
  'lineups',coalesce((select jsonb_agg(jsonb_build_object('matchId',match_id,'payload',case when captain then coalesce(draft_payload,published_payload) else published_payload end,'shared',published_payload is not null,'updatedAt',case when captain then updated_at else published_at end) || case when captain then jsonb_build_object('revision',revision,'hasDraft',draft_payload is not null) else '{}'::jsonb end) from private.match_lineups where club_id=p_club_id and (captain or published_payload is not null)),'[]'::jsonb)
 );
end;$$;
create or replace function public.get_player_accounts(p_club_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_captain(p_club_id) then raise exception 'Captain access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('playerId',p.id,'status',case when m.user_id is not null then 'active' when i.expires_at>now() then 'invited' when i.player_id is not null then 'expired' else 'unlinked' end,'email',coalesce(u.email,i.email),'role',m.role,'expiresAt',i.expires_at) order by p.number,p.name) from public.players p left join public.club_memberships m on m.club_id=p.club_id and m.player_id=p.id left join auth.users u on u.id=m.user_id left join private.player_invites i on i.club_id=p.club_id and i.player_id=p.id where p.club_id=p_club_id),'[]'::jsonb);
end;$$;

revoke all on function public.get_team_access(uuid),public.prepare_player_invite(uuid,uuid,text),public.cancel_player_invite(uuid,uuid,uuid),public.revoke_player_access(uuid,uuid),public.link_captain_profile(uuid,uuid),public.save_match_rsvp(uuid,text),public.save_match_lineup(uuid,integer,jsonb,boolean),public.unshare_match_lineup(uuid,integer),public.get_team_club(uuid),public.get_player_accounts(uuid) from public,anon,authenticated;
grant execute on function public.get_team_access(uuid),public.prepare_player_invite(uuid,uuid,text),public.cancel_player_invite(uuid,uuid,uuid),public.revoke_player_access(uuid,uuid),public.link_captain_profile(uuid,uuid),public.save_match_rsvp(uuid,text),public.save_match_lineup(uuid,integer,jsonb,boolean),public.unshare_match_lineup(uuid,integer),public.get_team_club(uuid),public.get_player_accounts(uuid) to authenticated;
