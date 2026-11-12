-- SignalChart private keyless economic-calendar bridge for Cloudflare staging.
-- Only weekly source-attributed event research; no trading privileges.
-- pg_net fetches the public calendar from Supabase egress because this feed
-- rejects some Cloudflare edge addresses. The source is an independent calendar
-- aggregator, not an official guarantee of complete news coverage.
begin;

create schema if not exists signalchart_internal;
revoke all on schema signalchart_internal from public,anon,authenticated;
create table if not exists signalchart_internal.sc_economic_feed(
 source text primary key check(source='forex_factory_weekly'),
 request_id bigint,
 requested_at timestamptz,
 last_good_at timestamptz,
 events jsonb not null default '[]'::jsonb
  check(jsonb_typeof(events)='array'),
 last_error text,
 updated_at timestamptz not null default now()
);
alter table signalchart_internal.sc_economic_feed enable row level security;
revoke all on table signalchart_internal.sc_economic_feed from public,anon,authenticated;
-- No API role can write a calendar: only the DB-owned scheduled functions.

create or replace function signalchart_internal.sc_request_economic_feed()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_req bigint;
begin
 v_req:=net.http_get(
  url:='https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  timeout_milliseconds:=12000
 );
 insert into signalchart_internal.sc_economic_feed
  (source,request_id,requested_at,updated_at)
 values ('forex_factory_weekly',v_req,now(),now())
 on conflict(source) do update
 set request_id=excluded.request_id,
     requested_at=excluded.requested_at,
     updated_at=now();
 return v_req;
end $$;

create or replace function signalchart_internal.sc_ingest_economic_feed()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare st signalchart_internal.sc_economic_feed%rowtype;
declare resp record;
declare raw jsonb;
declare item jsonb;
declare vals jsonb:='[]'::jsonb;
declare ordered jsonb;
declare published timestamptz;
declare currency text;
declare impact text;
declare label text;
declare n integer:=0;
begin
 select * into st from signalchart_internal.sc_economic_feed
  where source='forex_factory_weekly' for update;
 if st.source is null or st.request_id is null or
    st.requested_at is null or st.requested_at<now()-interval '30 minutes'
 then return jsonb_build_object('stored',false,'reason','no_recent_request');end if;
 select id,status_code,timed_out,error_msg,content into resp
 from net._http_response where id=st.request_id limit 1;
 if resp.id is null then
  return jsonb_build_object('stored',false,'reason','request_pending');
 end if;
 if resp.status_code<>200 or coalesce(resp.timed_out,false) or
    resp.error_msg is not null or length(coalesce(resp.content,''))>300000
 then
  update signalchart_internal.sc_economic_feed
   set last_error='calendar_http_unavailable',updated_at=now()
   where source=st.source;
  return jsonb_build_object('stored',false,'reason','provider_unavailable');
 end if;
 begin
  raw:=resp.content::jsonb;
 exception when others then
  update signalchart_internal.sc_economic_feed
   set last_error='invalid_json',updated_at=now()
   where source=st.source;
  return jsonb_build_object('stored',false,'reason','invalid_json');
 end;
 if jsonb_typeof(raw)<>'array' or jsonb_array_length(raw)>3000 then
  return jsonb_build_object('stored',false,'reason','invalid_calendar_shape');
 end if;
 for item in select x.value from jsonb_array_elements(raw) x(value) loop
  if jsonb_typeof(item)<>'object' then continue;end if;
  currency:=upper(left(trim(coalesce(item->>'country','')),3));
  impact:=lower(left(trim(coalesce(item->>'impact','')),12));
  label:=left(trim(coalesce(item->>'title','')),180);
  if currency !~ '^[A-Z]{3}$' or impact not in ('high','medium') or
     length(label)<3 then continue;end if;
  begin
   published:=(item->>'date')::timestamptz;
  exception when others then
   continue;
  end;
  if published<now()-interval '7 days' or
     published>now()+interval '9 days' then continue;end if;
  vals:=vals||jsonb_build_array(jsonb_build_object(
   'id','ff:'||md5(currency||':'||label||':'||published::text),
   'currency',currency,'impact',impact,'title',label,
   'scheduledAt',to_char(published at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'forecast',left(coalesce(item->>'forecast',''),70),
   'previous',left(coalesce(item->>'previous',''),70),
   'source','Forex Factory weekly calendar',
   'sourceUrl','https://www.forexfactory.com/calendar'
  ));
  n:=n+1;
 end loop;
 -- A source with no attributable high/medium event must not be interpreted
 -- as positive evidence that no economic releases can interrupt trading.
 if n<1 then
  update signalchart_internal.sc_economic_feed set
   last_error='empty_relevant_events',updated_at=now()
   where source=st.source;
  return jsonb_build_object('stored',false,'reason','empty_relevant_events');
 end if;
 select jsonb_agg(x.value order by x.value->>'scheduledAt') into ordered
 from jsonb_array_elements(vals) x(value);
 update signalchart_internal.sc_economic_feed set
   events=coalesce(ordered,'[]'::jsonb),last_good_at=now(),
   last_error=null,updated_at=now() where source=st.source;
 return jsonb_build_object('stored',true,'eventCount',n,
  'source','forex_factory_weekly');
end $$;

create or replace function public.sc_economic_calendar_snapshot()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare st signalchart_internal.sc_economic_feed%rowtype;
begin
 select * into st from signalchart_internal.sc_economic_feed
  where source='forex_factory_weekly';
 if st.source is null or st.last_good_at is null or
    st.last_good_at<now()-interval '90 minutes'
 then return jsonb_build_object('coverage','UNKNOWN','events','[]'::jsonb,
  'checkedAt',null,'sourceStatus','STALE_OR_UNAVAILABLE',
  'independentlyVerified',false);
 end if;
 return jsonb_build_object(
  'coverage','SINGLE_SOURCE_WEEKLY','checkedAt',st.last_good_at,
  'events',st.events,'sourceStatus','CURRENT',
  'source','Forex Factory weekly calendar via Supabase private feed',
  'independentlyVerified',false,
  'publicationApproved',false);
end $$;

revoke all on function signalchart_internal.sc_request_economic_feed() from public,anon,authenticated;
revoke all on function signalchart_internal.sc_ingest_economic_feed() from public,anon,authenticated;
revoke all on function public.sc_economic_calendar_snapshot() from public,anon,authenticated;
grant execute on function public.sc_economic_calendar_snapshot() to service_role;

-- Two bounded read-only cron jobs. They DO NOT execute signal generation.
-- pg_net is asynchronous: fetch occurs at :00, response processed at :02.
do $schedule$
begin
 if not exists(select 1 from cron.job where jobname='signalchart-calendar-fetch') then
  perform cron.schedule('signalchart-calendar-fetch','0 * * * *',
   'select signalchart_internal.sc_request_economic_feed()');
 end if;
 if not exists(select 1 from cron.job where jobname='signalchart-calendar-ingest') then
  perform cron.schedule('signalchart-calendar-ingest','2 * * * *',
   'select signalchart_internal.sc_ingest_economic_feed()');
 end if;
end $schedule$;
commit;
