-- SignalChart full-owner control-plane foundation. Non-destructive.
-- Only limited emergency/operational switches are writable. Payment approval
-- and signal publishing remain disabled independently of this table.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sc_admin_runtime_flags (
 key text PRIMARY KEY CHECK (key IN ('research_scans','support_intake')),
 enabled boolean NOT NULL DEFAULT true,
 changed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 reason text NOT NULL DEFAULT 'Initial staging policy',
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.sc_admin_runtime_flags(key,enabled)
VALUES ('research_scans',true),('support_intake',true)
ON CONFLICT (key) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.sc_admin_runtime_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 key text NOT NULL CHECK(key IN ('research_scans','support_intake')),
 old_enabled boolean NOT NULL,
 new_enabled boolean NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_admin_runtime_event_newest ON public.sc_admin_runtime_events(created_at DESC);
ALTER TABLE public.sc_admin_runtime_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sc_admin_runtime_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sc_admin_runtime_flags,public.sc_admin_runtime_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.sc_admin_runtime_flags TO service_role;
GRANT SELECT,INSERT ON public.sc_admin_runtime_events TO service_role;

CREATE OR REPLACE FUNCTION public.sc_admin_runtime_state()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT jsonb_build_object(
  'researchScans',coalesce((SELECT enabled FROM public.sc_admin_runtime_flags WHERE key='research_scans'),false),
  'supportIntake',coalesce((SELECT enabled FROM public.sc_admin_runtime_flags WHERE key='support_intake'),false),
  'premiumPublishing',false,'manualPaymentApproval',false);
$fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_runtime_toggle(
 p_actor uuid,p_key text,p_enabled boolean,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE previous boolean;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_key IS NULL OR p_key NOT IN ('research_scans','support_intake')
    OR p_enabled IS NULL
 THEN RAISE EXCEPTION 'Unsupported operational switch' USING ERRCODE='22023';END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
 THEN RAISE EXCEPTION 'Reason must be 5 to 500 characters' USING ERRCODE='22023';END IF;
 SELECT enabled INTO previous FROM public.sc_admin_runtime_flags WHERE key=p_key FOR UPDATE;
 IF previous IS NULL THEN RAISE EXCEPTION 'Operational switch unavailable' USING ERRCODE='P0002';END IF;
 IF previous IS DISTINCT FROM p_enabled THEN
   UPDATE public.sc_admin_runtime_flags
   SET enabled=p_enabled,changed_by=p_actor,reason=btrim(p_reason),changed_at=now()
   WHERE key=p_key;
   INSERT INTO public.sc_admin_runtime_events(actor_id,key,old_enabled,new_enabled,reason)
   VALUES(p_actor,p_key,previous,p_enabled,btrim(p_reason));
 END IF;
 RETURN jsonb_build_object('key',p_key,'enabled',p_enabled,
  'changed',previous IS DISTINCT FROM p_enabled);
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_control_report(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE state jsonb; recent_scans jsonb; overview jsonb;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 SELECT public.sc_admin_runtime_state() INTO state;
 SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) INTO recent_scans
 FROM (SELECT ran_at AS "ranAt",status AS "status",scanned AS "scanned",
  qualified AS "qualified",published AS "published",error_count AS "errors"
  FROM public.sc_auto_scan_runs ORDER BY ran_at DESC LIMIT 12) s;
 SELECT jsonb_build_object(
  'pendingProposals',(SELECT count(*) FROM public.sc_signal_proposals WHERE status='pending'),
  'publishedSignalRecords',(SELECT count(*) FROM public.sc_premium_signals),
  'revokedSignals',(SELECT count(*) FROM public.sc_signal_revocations),
  'trialActivations',(SELECT count(*) FROM public.sc_trials),
  'riskEventsLast30Days',(SELECT count(*) FROM public.sc_trial_risk_events WHERE
    risk_level IN ('review','restricted') AND created_at>now()-interval '30 days'),
  'complimentaryActive',(SELECT count(*) FROM public.sc_complimentary_grants g
   WHERE g.starts_at<=now() AND g.expires_at>now() AND NOT EXISTS
    (SELECT 1 FROM public.sc_complimentary_revocations rv WHERE rv.grant_id=g.id))
 ) INTO overview;
 RETURN jsonb_build_object('controls',state,'stats',overview,'recentScans',recent_scans,
  'publicationAvailable',false,'paymentApprovalsAvailable',false);
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_trial_revoke_owner(
 p_actor uuid,p_user uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_user IS NULL OR p_actor=p_user
 THEN RAISE EXCEPTION 'Invalid trial owner' USING ERRCODE='22023'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
 THEN RAISE EXCEPTION 'Trial revocation requires 5-500 characters' USING ERRCODE='22023'; END IF;
 RETURN public.sc_admin_trial_action(p_actor,'revoke',p_user,NULL,btrim(p_reason),NULL);
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_audit_feed(p_actor uuid,p_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE entries jsonb;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'Invalid audit page size' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) INTO entries
 FROM (
  SELECT kind,actor_id AS "actorId",subject_id AS "subjectId",action,reason,at AS "at"
  FROM (
   SELECT 'admin_action'::text kind, actor_id,target_user_id subject_id,action,reason,created_at at
    FROM public.sc_admin_action_events
   UNION ALL
   SELECT 'runtime'::text, actor_id,NULL::uuid,concat(key,' ',CASE WHEN new_enabled THEN 'enabled' ELSE 'disabled' END),
    reason,created_at FROM public.sc_admin_runtime_events
   UNION ALL
   SELECT 'trial_action'::text,actor_id,subject_id,action,reason,created_at
    FROM public.sc_trial_admin_audit
   UNION ALL
   SELECT 'support_review'::text,actor_id,NULL::uuid,action,reason,created_at
    FROM public.sc_payment_review_events
  ) entry ORDER BY at DESC LIMIT p_limit
 ) a;
 RETURN entries;
END $fn$;

REVOKE ALL ON FUNCTION public.sc_admin_runtime_state(),
 public.sc_admin_runtime_toggle(uuid,text,boolean,text),
 public.sc_admin_control_report(uuid),
 public.sc_admin_trial_revoke_owner(uuid,uuid,text),
 public.sc_admin_audit_feed(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sc_admin_runtime_state(),
 public.sc_admin_runtime_toggle(uuid,text,boolean,text),
 public.sc_admin_control_report(uuid),
 public.sc_admin_trial_revoke_owner(uuid,uuid,text),
 public.sc_admin_audit_feed(uuid,integer) TO service_role;
COMMIT;
