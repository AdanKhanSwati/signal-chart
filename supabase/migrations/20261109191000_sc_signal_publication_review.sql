-- SignalChart premium-signal controlled publication.
-- No unattended publishing: proposals are private until an admin signs off.
-- Existing premium unlock and trial policies remain unchanged.
begin;

create table if not exists public.sc_signal_proposals (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null unique check(length(signal_key) between 3 and 140),
  market text not null check(market in ('crypto','forex')),
  asset text not null check(length(asset) between 2 and 36),
  candle_closed_at timestamptz not null,
  source text not null check(length(source) between 12 and 100),
  analysis jsonb not null check(jsonb_typeof(analysis)='object'),
  proposed_by uuid not null references auth.users(id),
  proposed_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  constraint sc_proposals_review_consistent check (
    (status='pending' and reviewed_at is null and reviewed_by is null)
    or (status<>'pending' and reviewed_at is not null and reviewed_by is not null)
  )
);
create index if not exists sc_proposals_status_at on public.sc_signal_proposals(status,proposed_at desc);
alter table public.sc_signal_proposals enable row level security;
revoke all on table public.sc_signal_proposals from public,anon,authenticated;
grant select,insert,update on table public.sc_signal_proposals to service_role;

create or replace function public.sc_propose_premium_signal(
 p_actor uuid,p_signal_key text,p_market text,p_asset text,
 p_candle_closed_at timestamptz,p_source text,p_analysis jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
declare v_entry numeric;declare v_stop numeric;declare v_target numeric;
declare v_direction text;declare v_risk numeric;declare v_reward numeric;
begin
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor)
 then raise exception 'Authenticated author required' using errcode='22023';end if;
 if p_signal_key !~ '^[a-zA-Z0-9][a-zA-Z0-9:_.-]{2,139}$'
  or p_market not in ('crypto','forex')
  or p_asset !~ '^[A-Z0-9/._-]{2,36}$'
 then raise exception 'Invalid instrument or identifier' using errcode='22023';end if;
 if p_candle_closed_at is null or p_candle_closed_at>now()-interval '1 minute'
  or p_candle_closed_at<now()-interval '4 hours'
 then raise exception 'Closed candle not recent enough for review' using errcode='22023';end if;
 if length(coalesce(p_source,''))<12 or length(p_source)>100
 then raise exception 'Market data source required' using errcode='22023';end if;
 if (p_market='crypto' and p_source not in
   ('Binance USD-M Futures','Coinbase USD spot','Kraken USD spot'))
   or (p_market='forex' and p_source<>'Yahoo Finance indicative')
 then raise exception 'Unrecognized market data source' using errcode='22023';end if;
 if jsonb_typeof(p_analysis)<>'object' or
  jsonb_typeof(p_analysis->'entry')<>'number' or
  jsonb_typeof(p_analysis->'stopLoss')<>'number' or
  jsonb_typeof(p_analysis->'takeProfit')<>'number'
 then raise exception 'Action levels must be numeric' using errcode='22023';end if;
 v_direction:=p_analysis->>'direction';
 if v_direction not in ('LONG','SHORT')
  or length(coalesce(p_analysis->>'research',''))<80
  or length(coalesce(p_analysis->>'evidenceUrl',''))<15
  or p_analysis->>'evidenceUrl' not like 'https://%'
 then raise exception 'Research evidence and direction required' using errcode='22023';end if;
 v_entry:=(p_analysis->>'entry')::numeric;
 v_stop:=(p_analysis->>'stopLoss')::numeric;
 v_target:=(p_analysis->>'takeProfit')::numeric;
 if v_entry<=0 or v_stop<=0 or v_target<=0 or v_stop=v_entry
 then raise exception 'Invalid trade levels' using errcode='22023';end if;
 if (v_direction='LONG' and not(v_stop<v_entry and v_entry<v_target))
  or (v_direction='SHORT' and not(v_target<v_entry and v_entry<v_stop))
 then raise exception 'Stop and target must match trade direction' using errcode='22023';end if;
 v_risk:=abs(v_entry-v_stop);v_reward:=abs(v_target-v_entry);
 if v_reward/v_risk<1.1 then
  raise exception 'Research candidate has insufficient projected reward/risk'
   using errcode='22023';end if;

 insert into public.sc_signal_proposals(signal_key,market,asset,candle_closed_at,source,analysis,proposed_by)
 values (p_signal_key,p_market,p_asset,p_candle_closed_at,p_source,
   p_analysis||jsonb_build_object('source',p_source,'candleClosedAt',p_candle_closed_at),
   p_actor) returning id into v_id;
 return jsonb_build_object('proposalId',v_id,'status','pending','published',false);
end $$;

create or replace function public.sc_review_premium_signal(
 p_actor uuid,p_proposal uuid,p_decision text,p_reason text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare proposal public.sc_signal_proposals%rowtype;
begin
 if p_actor is null or not exists(select 1 from auth.users where id=p_actor)
  or p_proposal is null or p_decision not in ('approve','reject')
  or length(trim(coalesce(p_reason,'')))<8
 then raise exception 'Review details required' using errcode='22023';end if;
 select * into proposal from public.sc_signal_proposals where id=p_proposal for update;
 if proposal.id is null then raise exception 'Proposal not found' using errcode='22023';end if;
 if proposal.status<>'pending' then raise exception 'Proposal already reviewed' using errcode='23505';end if;
 if p_decision='approve' and (
   now()-proposal.candle_closed_at>interval '4 hours'
   or proposal.candle_closed_at>now()-interval '1 minute')
 then raise exception 'Market data is stale; publish a fresh review instead'
   using errcode='22023';end if;
 if p_decision='approve' then
   insert into public.sc_premium_signals
      (signal_key,market,asset,public_meta,premium_data,published_at,visible)
   values (proposal.signal_key,proposal.market,proposal.asset,
     jsonb_build_object('sourceBasis',proposal.source,'review','manual'),
     proposal.analysis,now(),true);
 end if;
 update public.sc_signal_proposals
 set status=case when p_decision='approve' then 'approved' else 'rejected' end,
  reviewed_by=p_actor,reviewed_at=now(),review_note=left(p_reason,1000)
 where id=p_proposal;
 return jsonb_build_object('proposalId',p_proposal,
   'status',case when p_decision='approve' then 'approved' else 'rejected' end,
   'published',p_decision='approve');
end $$;

revoke all on function public.sc_propose_premium_signal(uuid,text,text,text,timestamptz,text,jsonb)
 from public,anon,authenticated;
revoke all on function public.sc_review_premium_signal(uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.sc_propose_premium_signal(uuid,text,text,text,timestamptz,text,jsonb)
 to service_role;
grant execute on function public.sc_review_premium_signal(uuid,uuid,text,text)
 to service_role;
commit;
