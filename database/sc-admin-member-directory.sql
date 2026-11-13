-- SignalChart owner-only full identity directory and safe profile reconciliation.
-- Does not create auth accounts, reset passwords, or grant subscriptions/trials.
BEGIN;
ALTER TABLE public.sc_admin_action_events
 DROP CONSTRAINT IF EXISTS sc_admin_action_events_action_check;
ALTER TABLE public.sc_admin_action_events
 ADD CONSTRAINT sc_admin_action_events_action_check
 CHECK (action IN ('payment_hold','payment_reject','grant_access','revoke_access','profile_reconcile'));

CREATE OR REPLACE FUNCTION public.sc_admin_member_directory(
 p_actor uuid,p_query text DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_query IS NOT NULL AND length(btrim(p_query)) NOT BETWEEN 0 AND 100
 THEN RAISE EXCEPTION 'Search is too long' USING ERRCODE='22023'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>75
 THEN RAISE EXCEPTION 'Invalid directory page size' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) INTO result
 FROM (
  SELECT a.id AS "userId",coalesce(a.email,'') AS "email",
    coalesce(m.display_name,'') AS "name",
    a.created_at AS "joinedAt",a.last_sign_in_at AS "lastSignInAt",
    a.email_confirmed_at IS NOT NULL AS "emailVerified",
    m.user_id IS NOT NULL AS "hasProfile",
    m.legacy_status AS "legacyStatus",
    CASE WHEN t.user_id IS NULL THEN 'not_activated'
         WHEN t.revoked_at IS NOT NULL THEN 'revoked'
         WHEN t.expires_at<=now() THEN 'expired'
         WHEN t.signals_consumed>=3 THEN 'exhausted'
         ELSE 'active' END AS "trialStatus",
    (SELECT max(pa.expires_at) FROM public.sc_paid_access pa
      WHERE pa.user_id=a.id AND pa.revoked_at IS NULL AND pa.expires_at>now())
      AS "paidUntil"
  FROM auth.users a
  LEFT JOIN public.sc_member_profiles m ON m.user_id=a.id
  LEFT JOIN public.sc_trials t ON t.user_id=a.id
  WHERE coalesce(btrim(p_query),'')=''
     OR a.id::text ILIKE '%'||btrim(p_query)||'%'
     OR coalesce(a.email,'') ILIKE '%'||
        replace(replace(btrim(p_query),'%','\%'),'_','\_')||'%' ESCAPE '\'
  ORDER BY a.created_at DESC,a.id DESC LIMIT p_limit
 ) u;
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION public.sc_admin_reconcile_member(
 p_actor uuid,p_user uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE linked_id uuid;
BEGIN
 PERFORM public.sc_check_private_admin(p_actor);
 IF p_user IS NULL OR p_user=p_actor
 THEN RAISE EXCEPTION 'Valid customer identity required' USING ERRCODE='22023'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 5 AND 500
 THEN RAISE EXCEPTION 'Audit reason is required' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id=p_user
    AND a.email_confirmed_at IS NOT NULL AND a.email IS NOT NULL)
 THEN RAISE EXCEPTION 'Account must have a verified email' USING ERRCODE='22023'; END IF;
 INSERT INTO public.sc_member_profiles(user_id,email,display_name)
 SELECT a.id,lower(a.email),''
 FROM auth.users a WHERE a.id=p_user
 ON CONFLICT(user_id) DO NOTHING
 RETURNING user_id INTO linked_id;
 IF linked_id IS NULL THEN
   RETURN jsonb_build_object('recorded',false,'alreadyLinked',true);
 END IF;
 INSERT INTO public.sc_admin_action_events(actor_id,target_user_id,action,reference_id,reason)
 VALUES(p_actor,p_user,'profile_reconcile',p_user,btrim(p_reason));
 RETURN jsonb_build_object('recorded',true,'userId',linked_id,'profileCreated',true,
  'paidAccessGranted',false,'trialGranted',false);
END $fn$;
REVOKE ALL ON FUNCTION public.sc_admin_member_directory(uuid,text,integer),
 public.sc_admin_reconcile_member(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sc_admin_member_directory(uuid,text,integer),
 public.sc_admin_reconcile_member(uuid,uuid,text) TO service_role;
COMMIT;
