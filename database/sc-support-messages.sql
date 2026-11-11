-- SignalChart customer support migration: server-only, free-tier PostgreSQL.
-- This creates new resources and does not modify existing auth/trial/payment data.
create table if not exists public.sc_support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(trim(subject)) between 4 and 140),
  category text not null check (category in ('general','billing','technical','complaint')),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sc_support_tickets_owner_time
 on public.sc_support_tickets(user_id, updated_at desc);
create table if not exists public.sc_support_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.sc_support_tickets(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','admin')),
  message text not null check (char_length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists sc_support_messages_ticket_time
 on public.sc_support_messages(ticket_id,created_at,id);
create index if not exists sc_support_messages_actor_time
 on public.sc_support_messages(actor_user_id,created_at desc);

alter table public.sc_support_tickets enable row level security;
alter table public.sc_support_messages enable row level security;
revoke all on table public.sc_support_tickets, public.sc_support_messages from PUBLIC, anon, authenticated;
grant select, insert, update on table public.sc_support_tickets to service_role;
grant select, insert on table public.sc_support_messages to service_role;
grant usage, select on sequence public.sc_support_messages_id_seq to service_role;

create or replace function public.sc_support_create(
 p_actor uuid,p_subject text,p_category text,p_message text)
returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare v_id uuid;
begin
 if p_actor is null or not exists (
  select 1 from auth.users where id=p_actor and email_confirmed_at is not null
 ) then raise exception 'Verified customer required' using errcode='22023'; end if;
 if char_length(trim(coalesce(p_subject,''))) not between 4 and 140 or
    coalesce(p_category,'') not in ('general','billing','technical','complaint') or
    char_length(trim(coalesce(p_message,''))) not between 1 and 2000
 then raise exception 'Invalid support message' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_actor::text));
 if (select count(*) from public.sc_support_tickets
     where user_id=p_actor and created_at>now()-interval '24 hours')>=5
 then raise exception 'Support request limit reached for today' using errcode='22023'; end if;
 insert into public.sc_support_tickets(user_id,subject,category)
 values(p_actor,trim(p_subject),p_category) returning id into v_id;
 insert into public.sc_support_messages(ticket_id,actor_user_id,sender_type,message)
 values(v_id,p_actor,'customer',trim(p_message));
 return jsonb_build_object('ticketId',v_id,'status','open');
end $fn$;

create or replace function public.sc_support_reply(
 p_actor uuid,p_ticket uuid,p_message text,p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare v_ticket public.sc_support_tickets%rowtype;
begin
 if p_actor is null or p_ticket is null or
    char_length(trim(coalesce(p_message,''))) not between 1 and 2000
 then raise exception 'Invalid reply' using errcode='22023'; end if;
 select * into v_ticket from public.sc_support_tickets where id=p_ticket for update;
 if v_ticket.id is null then return jsonb_build_object('status','not_found');end if;
 if v_ticket.user_id<>p_actor and p_admin is distinct from true
 then return jsonb_build_object('status','forbidden');end if;
 if v_ticket.status<>'open' then return jsonb_build_object('status','closed');end if;
 if (select count(*) from public.sc_support_messages
     where actor_user_id=p_actor and created_at>now()-interval '1 hour')>=40
 then return jsonb_build_object('status','rate_limited');end if;
 insert into public.sc_support_messages(ticket_id,actor_user_id,sender_type,message)
 values(p_ticket,p_actor,case when p_admin is true then 'admin' else 'customer' end,
 trim(p_message));
 update public.sc_support_tickets set updated_at=now() where id=p_ticket;
 return jsonb_build_object('status','sent','ticketId',p_ticket);
end $fn$;

create or replace function public.sc_support_close(
 p_actor uuid,p_ticket uuid,p_admin boolean default false)
returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare v_ticket public.sc_support_tickets%rowtype;
begin
 if p_actor is null or p_ticket is null
 then raise exception 'Invalid ticket ID' using errcode='22023';end if;
 select * into v_ticket from public.sc_support_tickets where id=p_ticket for update;
 if v_ticket.id is null then return jsonb_build_object('status','not_found');end if;
 if v_ticket.user_id<>p_actor and p_admin is distinct from true
 then return jsonb_build_object('status','forbidden');end if;
 update public.sc_support_tickets set status='closed',updated_at=now()
 where id=p_ticket and status='open';
 return jsonb_build_object('status','closed','ticketId',p_ticket);
end $fn$;

-- Security-definer functions are never callable by browser roles, even if the
-- project still has Supabase's legacy default EXECUTE grants.
revoke all on function public.sc_support_create(uuid,text,text,text) from PUBLIC,anon,authenticated;
revoke all on function public.sc_support_reply(uuid,uuid,text,boolean) from PUBLIC,anon,authenticated;
revoke all on function public.sc_support_close(uuid,uuid,boolean) from PUBLIC,anon,authenticated;
grant execute on function public.sc_support_create(uuid,text,text,text) to service_role;
grant execute on function public.sc_support_reply(uuid,uuid,text,boolean) to service_role;
grant execute on function public.sc_support_close(uuid,uuid,boolean) to service_role;
