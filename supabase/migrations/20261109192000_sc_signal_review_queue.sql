-- Administrator-only private review queue. Additive extension.
begin;
create or replace function public.sc_signal_proposal_queue(p_limit integer default 50)
returns jsonb language sql stable security definer set search_path=''
as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'proposalId',x.id,'signalKey',x.signal_key,'market',x.market,
   'asset',x.asset,'source',x.source,'candleClosedAt',x.candle_closed_at,
   'proposedAt',x.proposed_at,'analysis',x.analysis)
   order by x.proposed_at desc),'[]'::jsonb)
 from (
  select id,signal_key,market,asset,source,candle_closed_at,
    proposed_at,analysis
  from public.sc_signal_proposals
  where status='pending'
  order by proposed_at desc
  limit least(greatest(coalesce(p_limit,50),1),100)
 ) x;
$$;
revoke all on function public.sc_signal_proposal_queue(integer)
 from public,anon,authenticated;
grant execute on function public.sc_signal_proposal_queue(integer)
 to service_role;
commit;
