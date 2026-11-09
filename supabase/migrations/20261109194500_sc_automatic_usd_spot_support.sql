-- Preserve the already-applied original migration and add USD-spot exchange support.
begin;
create or replace function public.sc_publish_automatic_signal(
 p_signal_key text,p_market text,p_asset text,p_source text,
 p_closed_at timestamptz,p_analysis jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare policy_enabled boolean;
declare v_entry numeric;declare v_stop numeric;declare v_target numeric;
declare v_direction text;declare v_risk numeric;declare v_reward numeric;
declare v_expires_at timestamptz;declare v_same integer;declare v_today integer;
begin
 select enabled into policy_enabled from public.sc_auto_signal_control where key='global';
 if not coalesce(policy_enabled,false) then
  return jsonb_build_object('published',false,'reason','automation_disabled');
 end if;
 if p_market not in ('crypto','forex')
  or p_signal_key !~ '^((crypto)|(forex)):[A-Z0-9]{3,16}:[0-9]{12,16}:(long|short)$'
  or p_asset !~ '^[A-Z0-9]{3,16}$'
  or split_part(p_signal_key,':',1)<>p_market
  or split_part(p_signal_key,':',2)<>p_asset
 then raise exception 'Invalid automatic signal key' using errcode='22023';end if;
 if p_closed_at is null or p_closed_at>now()-interval '1 minute'
  or p_closed_at<now()-interval '30 minutes'
  or split_part(p_signal_key,':',3)<>(extract(epoch from p_closed_at)*1000)::bigint::text
 then return jsonb_build_object('published',false,'reason','stale_market_data');end if;
 if jsonb_typeof(p_analysis)<>'object'
  or jsonb_typeof(p_analysis->'entry')<>'number'
  or jsonb_typeof(p_analysis->'stopLoss')<>'number'
  or jsonb_typeof(p_analysis->'takeProfit')<>'number'
  or jsonb_typeof(p_analysis->'indicators')<>'object'
  or jsonb_typeof(p_analysis->'riskPercent')<>'number'
  or jsonb_typeof(p_analysis->'indicators'->'signalScore')<>'number'
  or jsonb_typeof(p_analysis->'indicators'->'atrPercent')<>'number'
 then raise exception 'Complete numeric research required' using errcode='22023';end if;
 if p_analysis->>'strategy'<>'sc-hourly-ema-breakout-v1'
  or p_analysis->>'timeframe'<>'1h'
  or p_analysis->>'auditStatus'<>'UNVERIFIED_LIVE_PERFORMANCE'
  or p_analysis->>'newsCoverage'<>'FULL_WEEK'
  or p_analysis->>'newsDecision'<>'CLEAR'
  or length(coalesce(p_analysis->>'research',''))<100
  or p_analysis->>'evidenceUrl' not like 'https://%'
  or (p_analysis->>'riskPercent')::numeric>0.5
  or (p_analysis->>'riskPercent')::numeric<=0
 then raise exception 'Research or news safety requirements not met' using errcode='22023';end if;
 if (p_analysis->'indicators'->>'signalScore')::numeric<8.5
  or (p_analysis->'indicators'->>'atrPercent')::numeric<=0
 then raise exception 'Unqualified technical strategy' using errcode='22023';end if;
 if p_market='crypto' and not (
   (p_source='Binance USD-M Futures'
    and p_analysis->>'executionBasis'='EXCHANGE_FUTURES_REFERENCE'
    and right(p_asset,4)='USDT')
   or (p_source in ('Kraken USD spot','Coinbase USD spot')
    and p_analysis->>'executionBasis'='EXCHANGE_SPOT_USD_REFERENCE'
    and right(p_asset,3)='USD' and right(p_asset,4)<>'USDT')
 ) then raise exception 'Exchange source or quote basis mismatch' using errcode='22023';end if;
 -- Yahoo Finance FX candles are INDICATIVE research, not broker executable.
 -- No automated actionable forex publication until a trusted broker feed exists.
 if p_market='forex' then
  return jsonb_build_object('published',false,'reason','verified_broker_feed_required');
 end if;

 v_direction:=p_analysis->>'direction';
 if v_direction not in ('LONG','SHORT')
  or split_part(p_signal_key,':',4)<>lower(v_direction)
 then raise exception 'Mismatched signal direction' using errcode='22023';end if;
 v_entry:=(p_analysis->>'entry')::numeric;
 v_stop:=(p_analysis->>'stopLoss')::numeric;
 v_target:=(p_analysis->>'takeProfit')::numeric;
 if v_entry<=0 or v_stop<=0 or v_target<=0 or v_stop=v_entry then
  raise exception 'Invalid trade price levels' using errcode='22023';end if;
 if (v_direction='LONG' and not(v_stop<v_entry and v_entry<v_target))
  or (v_direction='SHORT' and not(v_target<v_entry and v_entry<v_stop))
 then raise exception 'Invalid direction for price levels' using errcode='22023';end if;
 v_risk:=abs(v_entry-v_stop);v_reward:=abs(v_target-v_entry);
 if v_reward/v_risk<1.8 or v_reward/v_risk>4.0 then
  raise exception 'Unsafe risk/reward ratio' using errcode='22023';end if;

 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('scauto:'||p_market||':'||p_asset));
 if exists(select 1 from public.sc_premium_signals where signal_key=p_signal_key) then
  return jsonb_build_object('published',false,'reason','duplicate');
 end if;
 select count(*) into v_same from public.sc_premium_signals
  where market=p_market and asset=p_asset and visible=true and expires_at>now();
 if v_same>0 then
  return jsonb_build_object('published',false,'reason','existing_live_signal');
 end if;
 select count(*) into v_today from public.sc_premium_signals
  where published_at>now()-interval '24 hours'
    and public_meta->>'automation'='rules_based';
 if v_today>=12 then
  return jsonb_build_object('published',false,'reason','daily_publication_cap');
 end if;
 v_expires_at:=now()+interval '2 hours';
 insert into public.sc_premium_signals(
  signal_key,market,asset,public_meta,premium_data,published_at,visible,expires_at)
 values(p_signal_key,p_market,p_asset,
  jsonb_build_object('automation','rules_based','strategy','sc-hourly-ema-breakout-v1',
    'sourceBasis',p_source,'researchOnly',true),
  p_analysis||jsonb_build_object('publishedAutomatically',true,'publishedAt',now(),
    'expiresAt',v_expires_at),now(),true,v_expires_at);
 return jsonb_build_object('published',true,'reason','automated_rules_passed',
   'signalKey',p_signal_key,'expiresAt',v_expires_at);
end $$;
revoke all on function public.sc_publish_automatic_signal(text,text,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.sc_publish_automatic_signal(text,text,text,text,timestamptz,jsonb) to service_role;
commit;
